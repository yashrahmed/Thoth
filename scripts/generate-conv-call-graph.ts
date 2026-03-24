import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

type Layer = "flow" | "domainService" | "adapter";

type Component = {
  readonly name: string;
  readonly filePath: string;
  readonly layer: Layer;
};

type Edge = {
  readonly from: string;
  readonly to: string;
  readonly reason: "runtime" | "methodParameter";
};

type ReachableGraph = {
  readonly nodes: ReadonlyArray<Component>;
  readonly edges: ReadonlyArray<Edge>;
  readonly roots: ReadonlyArray<string>;
};

type RuntimeGraph = {
  readonly edges: ReadonlyArray<Edge>;
  readonly encounteredComponentNames: ReadonlySet<string>;
};

type PositionedNode = Component & {
  readonly level: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

const NODE_WIDTH = 250;
const NODE_HEIGHT = 64;
const HORIZONTAL_GAP = 40;
const VERTICAL_GAP = 90;
const MARGIN_X = 40;
const MARGIN_TOP = 96;
const EDGE_ARROW_CLEARANCE = 10;

const ROOT_DIR = path.resolve(import.meta.dir, "..");
const CONV_AGENT_SRC_DIR = path.join(ROOT_DIR, "packages/conv-agent/src");
const CONV_SETUP_PATH = path.join(CONV_AGENT_SRC_DIR, "conv-setup.ts");
const OUTPUT_DIR = path.join(ROOT_DIR, "docs/flow-grpahs");
const OUTPUT_BASE = path.join(OUTPUT_DIR, "conv-agent-call-graph");

async function main(): Promise<void> {
  const components = await scanComponents(CONV_AGENT_SRC_DIR);
  const runtimeGraph = await scanRuntimeGraph(CONV_SETUP_PATH, components);
  const methodParameterEdges = await scanMethodParameterEdges(CONV_AGENT_SRC_DIR, components);
  const graph = buildReachableGraph(components, runtimeGraph, methodParameterEdges);
  const levels = assignLevels(graph);
  const positionedNodes = positionNodes(graph, levels);
  const dot = renderDot(graph, levels);
  const svg = renderSvg(graph, positionedNodes);
  const json = JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      roots: graph.roots,
      nodes: graph.nodes.map((node) => ({
        ...node,
        level: levels.get(node.name),
      })),
      edges: graph.edges,
    },
    null,
    2,
  );

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(`${OUTPUT_BASE}.json`, `${json}\n`, "utf8");
  await writeFile(`${OUTPUT_BASE}.dot`, dot, "utf8");
  await writeFile(`${OUTPUT_BASE}.svg`, svg, "utf8");

  console.log(`Wrote ${path.relative(ROOT_DIR, `${OUTPUT_BASE}.json`)}`);
  console.log(`Wrote ${path.relative(ROOT_DIR, `${OUTPUT_BASE}.dot`)}`);
  console.log(`Wrote ${path.relative(ROOT_DIR, `${OUTPUT_BASE}.svg`)}`);
}

async function scanComponents(srcDir: string): Promise<Map<string, Component>> {
  const filePaths = await listSourceFiles(srcDir);
  const components = new Map<string, Component>();

  for (const filePath of filePaths) {
    const relativePath = path.relative(ROOT_DIR, filePath);
    const layer = classifyComponentLayer(relativePath);

    if (!layer) {
      continue;
    }

    const sourceFile = ts.createSourceFile(filePath, await readFile(filePath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    for (const statement of sourceFile.statements) {
      if (!ts.isClassDeclaration(statement) || !statement.name || !hasExportModifier(statement)) {
        continue;
      }

      if (!isComponentClassName(statement.name.text, layer)) {
        continue;
      }

      components.set(statement.name.text, {
        name: statement.name.text,
        filePath: relativePath,
        layer,
      });
    }
  }

  return components;
}

async function scanMethodParameterEdges(srcDir: string, components: ReadonlyMap<string, Component>): Promise<ReadonlyArray<Edge>> {
  const filePaths = await listSourceFiles(srcDir);
  const edges = new Map<string, Edge>();

  for (const filePath of filePaths) {
    const relativePath = path.relative(ROOT_DIR, filePath);

    if (!classifyComponentLayer(relativePath)) {
      continue;
    }

    const sourceFile = ts.createSourceFile(filePath, await readFile(filePath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    for (const statement of sourceFile.statements) {
      if (!ts.isClassDeclaration(statement) || !statement.name || !hasExportModifier(statement)) {
        continue;
      }

      const ownerName = statement.name.text;

      if (!components.has(ownerName)) {
        continue;
      }

      for (const member of statement.members) {
        if (!ts.isMethodDeclaration(member)) {
          continue;
        }

        for (const parameter of member.parameters) {
          const dependencyName = getTypeReferenceName(parameter.type);

          if (!dependencyName || !components.has(dependencyName) || dependencyName === ownerName) {
            continue;
          }

          edges.set(`${ownerName}->${dependencyName}`, {
            from: ownerName,
            to: dependencyName,
            reason: "methodParameter",
          });
        }
      }
    }
  }

  return [...edges.values()];
}

async function scanRuntimeGraph(setupPath: string, components: ReadonlyMap<string, Component>): Promise<RuntimeGraph> {
  const sourceFile = ts.createSourceFile(setupPath, await readFile(setupPath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const convSetupFunction = sourceFile.statements.find(
    (statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === "convSetup",
  );

  if (!convSetupFunction?.body) {
    throw new Error(`Could not find convSetup in ${path.relative(ROOT_DIR, setupPath)}.`);
  }

  const variableToComponent = new Map<string, string>();
  collectVariableComponentMappings(convSetupFunction.body, variableToComponent, components);

  const edges = new Map<string, Edge>();
  const encounteredComponentNames = new Set<string>();

  for (const statement of convSetupFunction.body.statements) {
    walkRuntimeExpression(statement, undefined, variableToComponent, components, edges, encounteredComponentNames);
  }

  return {
    edges: [...edges.values()],
    encounteredComponentNames,
  };
}

function walkRuntimeExpression(
  node: ts.Node,
  parentComponentName: string | undefined,
  variableToComponent: ReadonlyMap<string, string>,
  components: ReadonlyMap<string, Component>,
  edges: Map<string, Edge>,
  encounteredComponentNames: Set<string>,
): void {
  if (ts.isExpressionStatement(node)) {
    walkRuntimeExpression(node.expression, parentComponentName, variableToComponent, components, edges, encounteredComponentNames);
    return;
  }

  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      if (declaration.initializer) {
        walkRuntimeExpression(declaration.initializer, parentComponentName, variableToComponent, components, edges, encounteredComponentNames);
      }
    }

    return;
  }

  if (ts.isReturnStatement(node) && node.expression) {
    walkRuntimeExpression(node.expression, parentComponentName, variableToComponent, components, edges, encounteredComponentNames);
    return;
  }

  if (ts.isAwaitExpression(node) || ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) {
    walkRuntimeExpression(node.expression, parentComponentName, variableToComponent, components, edges, encounteredComponentNames);
    return;
  }

  if (ts.isIdentifier(node)) {
    if (!parentComponentName) {
      return;
    }

    const dependencyName = variableToComponent.get(node.text);

    if (dependencyName) {
      addEdge(edges, {
        from: parentComponentName,
        to: dependencyName,
        reason: "runtime",
      });
    }

    return;
  }

  if (ts.isNewExpression(node)) {
    const componentName = getDirectComponentClassName(node, components);

    if (componentName) {
      encounteredComponentNames.add(componentName);

      if (parentComponentName) {
        addEdge(edges, {
          from: parentComponentName,
          to: componentName,
          reason: "runtime",
        });
      }

      for (const argument of node.arguments ?? []) {
        walkRuntimeExpression(argument, componentName, variableToComponent, components, edges, encounteredComponentNames);
      }

      return;
    }

    for (const argument of node.arguments ?? []) {
      walkRuntimeExpression(argument, parentComponentName, variableToComponent, components, edges, encounteredComponentNames);
    }

    return;
  }

  if (ts.isCallExpression(node)) {
    for (const argument of node.arguments) {
      walkRuntimeExpression(argument, parentComponentName, variableToComponent, components, edges, encounteredComponentNames);
    }

    return;
  }

  if (ts.isObjectLiteralExpression(node)) {
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property)) {
        walkRuntimeExpression(property.initializer, parentComponentName, variableToComponent, components, edges, encounteredComponentNames);
      } else if (ts.isShorthandPropertyAssignment(property)) {
        walkRuntimeExpression(property.name, parentComponentName, variableToComponent, components, edges, encounteredComponentNames);
      } else if (ts.isMethodDeclaration(property)) {
        walkRuntimeExpression(property.body ?? property, parentComponentName, variableToComponent, components, edges, encounteredComponentNames);
      }
    }

    return;
  }

  if (ts.isArrayLiteralExpression(node)) {
    for (const element of node.elements) {
      walkRuntimeExpression(element, parentComponentName, variableToComponent, components, edges, encounteredComponentNames);
    }

    return;
  }

  ts.forEachChild(node, (child) => walkRuntimeExpression(child, parentComponentName, variableToComponent, components, edges, encounteredComponentNames));
}

function buildReachableGraph(components: ReadonlyMap<string, Component>, runtimeGraph: RuntimeGraph, methodParameterEdges: ReadonlyArray<Edge>): ReachableGraph {
  const allEdges = dedupeEdges([...runtimeGraph.edges, ...methodParameterEdges]);
  const flowRoots = [...runtimeGraph.encounteredComponentNames]
    .map((name) => components.get(name))
    .filter((component): component is Component => Boolean(component) && component.layer === "flow")
    .map((component) => component.name)
    .sort();
  const adjacency = new Map<string, string[]>();

  for (const edge of allEdges) {
    const bucket = adjacency.get(edge.from) ?? [];
    bucket.push(edge.to);
    adjacency.set(edge.from, bucket);
  }

  const reachable = new Set<string>();
  const stack = [...flowRoots];

  while (stack.length > 0) {
    const current = stack.pop();

    if (!current || reachable.has(current)) {
      continue;
    }

    reachable.add(current);

    for (const dependencyName of adjacency.get(current) ?? []) {
      stack.push(dependencyName);
    }
  }

  const nodes = [...reachable]
    .map((name) => components.get(name))
    .filter((component): component is Component => Boolean(component))
    .sort(compareComponents);
  const edges = allEdges.filter((edge) => reachable.has(edge.from) && reachable.has(edge.to)).sort(compareEdges);

  return {
    nodes,
    edges,
    roots: flowRoots,
  };
}

function assignLevels(graph: ReachableGraph): ReadonlyMap<string, number> {
  const nodeNames = new Set(graph.nodes.map((node) => node.name));
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  const levels = new Map<string, number>();

  for (const node of graph.nodes) {
    indegree.set(node.name, 0);
    levels.set(node.name, graph.roots.includes(node.name) ? 0 : 0);
  }

  for (const edge of graph.edges) {
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    const bucket = adjacency.get(edge.from) ?? [];
    bucket.push(edge.to);
    adjacency.set(edge.from, bucket);
  }

  const queue = [...graph.nodes.map((node) => node.name).filter((name) => (indegree.get(name) ?? 0) === 0)].sort(compareNames);
  const ordered: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current) {
      break;
    }

    ordered.push(current);

    for (const dependencyName of (adjacency.get(current) ?? []).sort(compareNames)) {
      levels.set(dependencyName, Math.max(levels.get(dependencyName) ?? 0, (levels.get(current) ?? 0) + 1));
      indegree.set(dependencyName, (indegree.get(dependencyName) ?? 0) - 1);

      if ((indegree.get(dependencyName) ?? 0) === 0) {
        queue.push(dependencyName);
        queue.sort(compareNames);
      }
    }
  }

  if (ordered.length !== nodeNames.size) {
    throw new Error("The conv-agent component graph contains a cycle and cannot be topologically layered.");
  }

  return levels;
}

function positionNodes(graph: ReachableGraph, levels: ReadonlyMap<string, number>): ReadonlyArray<PositionedNode> {
  const grouped = new Map<number, Component[]>();

  for (const node of graph.nodes) {
    const level = levels.get(node.name) ?? 0;
    const bucket = grouped.get(level) ?? [];
    bucket.push(node);
    grouped.set(level, bucket);
  }

  const incomingByNode = new Map<string, string[]>();

  for (const edge of graph.edges) {
    const bucket = incomingByNode.get(edge.to) ?? [];
    bucket.push(edge.from);
    incomingByNode.set(edge.to, bucket);
  }

  const sortedLevels = [...grouped.keys()].sort((left, right) => left - right);
  const orderedByLevel = new Map<number, Component[]>();
  const orderByNodeName = new Map<string, number>();

  for (const level of sortedLevels) {
    const rowNodes = [...(grouped.get(level) ?? [])];

    if (level === 0) {
      rowNodes.sort(compareComponents);
    } else {
      rowNodes.sort((left, right) => {
        const leftScore = getBarycenterScore(left.name, incomingByNode, orderByNodeName);
        const rightScore = getBarycenterScore(right.name, incomingByNode, orderByNodeName);

        if (leftScore !== rightScore) {
          return leftScore - rightScore;
        }

        const leftParentCount = incomingByNode.get(left.name)?.length ?? 0;
        const rightParentCount = incomingByNode.get(right.name)?.length ?? 0;

        if (leftParentCount !== rightParentCount) {
          return rightParentCount - leftParentCount;
        }

        return compareComponents(left, right);
      });
    }

    orderedByLevel.set(level, rowNodes);

    rowNodes.forEach((node, index) => {
      orderByNodeName.set(node.name, index);
    });
  }

  const rowWidths = sortedLevels.map((level) => (orderedByLevel.get(level)?.length ?? 0) * NODE_WIDTH + Math.max((orderedByLevel.get(level)?.length ?? 1) - 1, 0) * HORIZONTAL_GAP);
  const maxRowWidth = Math.max(...rowWidths, NODE_WIDTH);

  return sortedLevels.flatMap((level) => {
    const rowNodes = orderedByLevel.get(level) ?? [];
    const rowWidth = rowNodes.length * NODE_WIDTH + Math.max(rowNodes.length - 1, 0) * HORIZONTAL_GAP;
    const rowStartX = MARGIN_X + Math.round((maxRowWidth - rowWidth) / 2);

    return rowNodes.map((node, index) => ({
      ...node,
      level,
      x: rowStartX + index * (NODE_WIDTH + HORIZONTAL_GAP),
      y: MARGIN_TOP + level * (NODE_HEIGHT + VERTICAL_GAP),
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    }));
  });
}

function getBarycenterScore(nodeName: string, incomingByNode: ReadonlyMap<string, ReadonlyArray<string>>, orderByNodeName: ReadonlyMap<string, number>): number {
  const parentNames = incomingByNode.get(nodeName) ?? [];
  const parentOrders = parentNames.map((name) => orderByNodeName.get(name)).filter((value): value is number => value !== undefined);

  if (parentOrders.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return parentOrders.reduce((sum, value) => sum + value, 0) / parentOrders.length;
}

function renderDot(graph: ReachableGraph, levels: ReadonlyMap<string, number>): string {
  const lines = [
    "digraph ConvAgentCallGraph {",
    "  rankdir=TB;",
    '  graph [pad="0.25", ranksep="1.0", nodesep="0.5", splines="spline"];',
    '  node [shape="box", style="rounded,filled", fontname="Helvetica", color="#0f172a", penwidth="1.1"];',
    '  edge [color="#475569", arrowsize="0.7"];',
  ];
  const nodesByLevel = new Map<number, Component[]>();

  for (const node of graph.nodes) {
    const level = levels.get(node.name) ?? 0;
    const bucket = nodesByLevel.get(level) ?? [];
    bucket.push(node);
    nodesByLevel.set(level, bucket);
  }

  for (const node of graph.nodes) {
    lines.push(`  "${node.name}" [fillcolor="${getFillColor(node.layer)}", label="${node.name}\\n${getLayerLabel(node.layer)}"];`);
  }

  for (const level of [...nodesByLevel.keys()].sort((left, right) => left - right)) {
    const names = (nodesByLevel.get(level) ?? [])
      .sort(compareComponents)
      .map((node) => `"${node.name}"`)
      .join("; ");
    lines.push(`  { rank=same; ${names}; }`);
  }

  for (const edge of graph.edges) {
    lines.push(`  "${edge.from}" -> "${edge.to}";`);
  }

  lines.push("}");
  return `${lines.join("\n")}\n`;
}

function renderSvg(graph: ReachableGraph, positionedNodes: ReadonlyArray<PositionedNode>): string {
  const markerHeight = 10;
  const legendHeight = 70;
  const margin = 40;
  const width = Math.max(...positionedNodes.map((node) => node.x + node.width), 640) + margin;
  const height = Math.max(...positionedNodes.map((node) => node.y + node.height), 200) + legendHeight + margin;
  const positions = new Map(positionedNodes.map((node) => [node.name, node]));
  const edgeMarkup = graph.edges
    .map((edge) => {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);

      if (!from || !to) {
        return "";
      }

      const startX = from.x + from.width / 2;
      const startY = from.y + from.height;
      const endX = to.x + to.width / 2;
      const endY = to.y - EDGE_ARROW_CLEARANCE;
      const controlOffset = Math.max(28, Math.floor((endY - startY) / 2));

      return `<path d="M ${startX} ${startY} C ${startX} ${startY + controlOffset}, ${endX} ${endY - controlOffset}, ${endX} ${endY}" fill="none" stroke="#475569" stroke-width="1.6" marker-end="url(#arrow)" />`;
    })
    .filter((line) => line.length > 0)
    .join("\n    ");
  const nodeMarkup = positionedNodes
    .map((node) => {
      const subtitleY = node.y + 43;
      const titleY = node.y + 26;

      return [
        `<g id="${escapeXml(node.name)}">`,
        `  <rect x="${node.x}" y="${node.y}" rx="12" ry="12" width="${node.width}" height="${node.height}" fill="${getFillColor(node.layer)}" stroke="#0f172a" stroke-width="1.1" />`,
        `  <text x="${node.x + node.width / 2}" y="${titleY}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="700" fill="#0f172a">${escapeXml(node.name)}</text>`,
        `  <text x="${node.x + node.width / 2}" y="${subtitleY}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="12" fill="#334155">${escapeXml(getLayerLabel(node.layer))}</text>`,
        `</g>`,
      ].join("\n    ");
    })
    .join("\n    ");
  const legendItems = [
    renderLegendItem(40, height - 34, "Flow", "flow"),
    renderLegendItem(170, height - 34, "Domain Service", "domainService"),
    renderLegendItem(354, height - 34, "Adapter", "adapter"),
  ].join("\n    ");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    "  <defs>",
    `    <marker id="arrow" markerWidth="12" markerHeight="${markerHeight}" refX="10" refY="${markerHeight / 2}" orient="auto" markerUnits="strokeWidth">`,
    '      <path d="M 0 0 L 12 5 L 0 10 z" fill="#475569" />',
    "    </marker>",
    "  </defs>",
    '  <rect width="100%" height="100%" fill="#f8fafc" />',
    '  <text x="40" y="40" font-family="Helvetica, Arial, sans-serif" font-size="24" font-weight="700" fill="#0f172a">conv-agent Call Graph</text>',
    '  <text x="40" y="64" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="#475569">Dependencies are drawn below the component that uses them. Levels are assigned by topological order.</text>',
    `  <g id="edges">\n    ${edgeMarkup}\n  </g>`,
    `  <g id="nodes">\n    ${nodeMarkup}\n  </g>`,
    `  <g id="legend">\n    ${legendItems}\n  </g>`,
    "</svg>",
    "",
  ].join("\n");
}

function renderLegendItem(x: number, y: number, label: string, layer: Layer): string {
  return [
    `<rect x="${x}" y="${y - 12}" rx="8" ry="8" width="26" height="18" fill="${getFillColor(layer)}" stroke="#0f172a" stroke-width="1.0" />`,
    `<text x="${x + 38}" y="${y + 1}" font-family="Helvetica, Arial, sans-serif" font-size="12" fill="#334155">${escapeXml(label)}</text>`,
  ].join("\n    ");
}

function dedupeEdges(edges: ReadonlyArray<Edge>): ReadonlyArray<Edge> {
  const deduped = new Map<string, Edge>();

  for (const edge of edges) {
    const key = `${edge.from}->${edge.to}`;
    const existing = deduped.get(key);

    if (!existing || existing.reason === "methodParameter") {
      deduped.set(key, edge);
    }
  }

  return [...deduped.values()];
}

function addEdge(edges: Map<string, Edge>, edge: Edge): void {
  if (edge.from === edge.to) {
    return;
  }

  const key = `${edge.from}->${edge.to}`;
  const existing = edges.get(key);

  if (!existing || existing.reason === "methodParameter") {
    edges.set(key, edge);
  }
}

function getDirectComponentClassName(expression: ts.Expression, components: ReadonlyMap<string, Component>): string | null {
  const resolvedExpression = unwrapExpression(expression);

  if (!ts.isNewExpression(resolvedExpression) || !ts.isIdentifier(resolvedExpression.expression)) {
    return null;
  }

  return components.has(resolvedExpression.expression.text) ? resolvedExpression.expression.text : null;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  if (ts.isAsExpression(expression) || ts.isParenthesizedExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isNonNullExpression(expression)) {
    return unwrapExpression(expression.expression);
  }

  return expression;
}

function getTypeReferenceName(typeNode: ts.TypeNode | undefined): string | null {
  if (!typeNode || !ts.isTypeReferenceNode(typeNode)) {
    return null;
  }

  return ts.isIdentifier(typeNode.typeName) ? typeNode.typeName.text : null;
}

function collectVariableComponentMappings(node: ts.Node, variableToComponent: Map<string, string>, components: ReadonlyMap<string, Component>): void {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    const componentName = getDirectComponentClassName(node.initializer, components);

    if (componentName) {
      variableToComponent.set(node.name.text, componentName);
    }
  }

  ts.forEachChild(node, (child) => collectVariableComponentMappings(child, variableToComponent, components));
}

function classifyComponentLayer(relativePath: string): Layer | null {
  if (relativePath.startsWith("packages/conv-agent/src/application/")) {
    return "flow";
  }

  if (relativePath.startsWith("packages/conv-agent/src/domain/services/")) {
    return "domainService";
  }

  if (relativePath.startsWith("packages/conv-agent/src/adapter/") && !relativePath.startsWith("packages/conv-agent/src/adapter/inbound/")) {
    return "adapter";
  }

  return null;
}

function isComponentClassName(className: string, layer: Layer): boolean {
  switch (layer) {
    case "flow":
      return className.endsWith("Flow");
    case "domainService":
      return className.endsWith("DomainService");
    case "adapter":
      return className.endsWith("Repository") || className.endsWith("Service");
  }
}

function hasExportModifier(node: { readonly modifiers?: ts.NodeArray<ts.ModifierLike> }): boolean {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

async function listSourceFiles(dirPath: string): Promise<ReadonlyArray<string>> {
  const entries = await readdir(dirPath, {
    withFileTypes: true,
  });
  const filePaths: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "integration") {
        continue;
      }

      filePaths.push(...(await listSourceFiles(entryPath)));
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) {
      continue;
    }

    filePaths.push(entryPath);
  }

  return filePaths;
}

function compareComponents(left: Component, right: Component): number {
  return compareNames(left.name, right.name);
}

function compareEdges(left: Edge, right: Edge): number {
  return `${left.from}->${left.to}`.localeCompare(`${right.from}->${right.to}`);
}

function compareNames(left: string, right: string): number {
  return left.localeCompare(right);
}

function getFillColor(layer: Layer): string {
  switch (layer) {
    case "flow":
      return "#fee2e2";
    case "domainService":
      return "#dbeafe";
    case "adapter":
      return "#dcfce7";
  }
}

function getLayerLabel(layer: Layer): string {
  switch (layer) {
    case "flow":
      return "Flow";
    case "domainService":
      return "Domain Service";
    case "adapter":
      return "Adapter";
  }
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

await main();
