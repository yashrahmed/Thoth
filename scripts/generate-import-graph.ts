import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import ts from "typescript";

const DEFAULT_INCLUDE_ROOTS = ["packages"];
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".d.ts"];
const DEFAULT_OUTPUT_PATH = path.join(
  process.cwd(),
  "docs",
  "class-injection-dependencies.mmd",
);

export type GraphNodeKind = "class" | "abstract-class" | "external";
export type GraphEdgeKind = "declared" | "runtime";
export type GraphLayer =
  | "Controller/Workflow"
  | "App services"
  | "Domain services"
  | "Repository / Adapter"
  | "External";

export interface GraphNode {
  id: string;
  fqName: string;
  kind: GraphNodeKind;
  layer: GraphLayer;
  packageName: string;
  modulePath: string;
  symbolName: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: GraphEdgeKind;
}

export interface InjectionGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  outputPath: string;
  repoSymbolCount: number;
  externalSymbolCount: number;
  declaredEdgeCount: number;
  runtimeEdgeCount: number;
}

interface GenerateGraphOptions {
  rootDir?: string;
  outputPath?: string;
}

interface WorkspacePackage {
  name: string;
  relDir: string;
}

interface SourceDocument {
  relPath: string;
  canonicalAbsPath: string;
  packageName: string;
  modulePath: string;
  sourceFile: ts.SourceFile;
  importBindings: Map<string, ImportBinding>;
  shouldAnalyze: boolean;
}

interface ImportBinding {
  moduleSpecifier: string;
  exportedName: string;
  namespace: boolean;
}

interface GraphContext {
  rootDir: string;
  checker: ts.TypeChecker;
  documentsByCanonicalPath: Map<string, SourceDocument>;
  repoNodesByKey: Map<string, GraphNode>;
  allNodesByFqName: Map<string, GraphNode>;
  allEdgesByKey: Map<string, GraphEdge>;
}

type Scope = Map<string, string>;

export async function generateInjectionGraph(
  options: GenerateGraphOptions = {},
): Promise<InjectionGraph> {
  const rootDir = options.rootDir ?? process.cwd();
  const outputPath = options.outputPath ?? path.join(
    rootDir,
    "docs",
    "class-injection-dependencies.mmd",
  );
  const graph = buildInjectionGraph(rootDir, outputPath);
  const mermaid = buildMermaid(graph);

  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, mermaid, "utf8");

  return graph;
}

export function buildInjectionGraph(
  rootDir: string,
  outputPath = path.join(rootDir, "docs", "class-injection-dependencies.mmd"),
): InjectionGraph {
  const workspacePackages = collectWorkspacePackages(rootDir);
  const relPaths = collectSourcePaths(rootDir);
  const compilerOptions = readCompilerOptions(rootDir);
  const absPaths = relPaths.map((relPath) => path.join(rootDir, relPath));
  const program = ts.createProgram({
    rootNames: absPaths,
    options: compilerOptions,
  });
  const checker = program.getTypeChecker();
  const documents = buildDocuments(rootDir, relPaths, workspacePackages, program);
  const documentsByCanonicalPath = new Map(
    documents.map((document) => [document.canonicalAbsPath, document]),
  );
  const repoNodesByKey = new Map<string, GraphNode>();
  const allNodesByFqName = new Map<string, GraphNode>();
  const allEdgesByKey = new Map<string, GraphEdge>();
  const context: GraphContext = {
    rootDir,
    checker,
    documentsByCanonicalPath,
    repoNodesByKey,
    allNodesByFqName,
    allEdgesByKey,
  };

  for (const document of documents) {
    if (!document.shouldAnalyze) {
      continue;
    }

    collectRepoNodes(document, context);
  }

  for (const document of documents) {
    if (!document.shouldAnalyze) {
      continue;
    }

    collectDeclaredEdges(document, context);
    collectRuntimeEdges(document, context);
  }

  const nodes = Array.from(allNodesByFqName.values()).sort((left, right) =>
    left.fqName.localeCompare(right.fqName),
  );
  const edges = Array.from(allEdgesByKey.values()).sort((left, right) => {
    return (
      left.kind.localeCompare(right.kind) ||
      left.from.localeCompare(right.from) ||
      left.to.localeCompare(right.to)
    );
  });

  return {
    nodes,
    edges,
    outputPath,
    repoSymbolCount: nodes.filter((node) => node.kind !== "external").length,
    externalSymbolCount: nodes.filter((node) => node.kind === "external").length,
    declaredEdgeCount: edges.filter((edge) => edge.kind === "declared").length,
    runtimeEdgeCount: edges.filter((edge) => edge.kind === "runtime").length,
  };
}

export function buildMermaid(graph: InjectionGraph): string {
  const layerOrder = [
    "Controller/Workflow",
    "App services",
    "Domain services",
    "Repository / Adapter",
    "External",
  ];
  const nodeGroups = new Map<string, GraphNode[]>();

  for (const node of graph.nodes) {
    const groupName = node.layer;
    const group = nodeGroups.get(groupName) ?? [];

    group.push(node);
    nodeGroups.set(groupName, group);
  }

  const orderedGroups = Array.from(nodeGroups.entries()).sort(
    ([leftName], [rightName]) => {
      const leftIndex = layerOrder.indexOf(leftName);
      const rightIndex = layerOrder.indexOf(rightName);

      if (leftIndex !== -1 || rightIndex !== -1) {
        return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
      }

      return leftName.localeCompare(rightName);
    },
  );
  const lines = [
    "---",
    "title: Class Injection Dependencies",
    "---",
    "flowchart LR",
    "%% Nodes are fully qualified class names only.",
    "%% Contracts, entities, data types, and scripts are excluded.",
    "%% Solid edges = declared injection. Dashed edges = runtime wiring.",
  ];

  for (const [groupName, groupNodes] of orderedGroups) {
    lines.push(`  subgraph ${sanitize(groupName)}["${escapeMermaid(groupName)}"]`);

    for (const node of groupNodes.sort((left, right) => left.fqName.localeCompare(right.fqName))) {
      lines.push(
        `    ${node.id}["${escapeMermaid(node.fqName)}"]`,
      );
    }

    lines.push("  end");
  }

  for (const edge of graph.edges) {
    const connector = edge.kind === "declared" ? "-->" : "-.->";

    lines.push(
      `  ${sanitize(edge.from)} ${connector} ${sanitize(edge.to)}`,
    );
  }

  lines.push(
    `  classDef default fill:#ffffff,stroke:#94a3b8,color:#0f172a`,
  );
  lines.push(
    `  classDef abstract fill:#fff7ed,stroke:#94a3b8,color:#0f172a`,
  );
  lines.push(
    `  classDef external fill:#f1f5f9,stroke:#94a3b8,color:#0f172a`,
  );

  for (const node of graph.nodes) {
    const className =
      node.kind === "external"
        ? "external"
        : node.kind === "abstract-class"
          ? "abstract"
          : "default";

    lines.push(`  class ${node.id} ${className}`);
  }

  return `${lines.join("\n")}\n`;
}

function collectWorkspacePackages(rootDir: string): WorkspacePackage[] {
  const packagesDir = path.join(rootDir, "packages");

  if (!existsSync(packagesDir)) {
    return [];
  }

  const packageDirs = findPackageDirs(packagesDir).sort((left, right) => {
    return right.length - left.length;
  });

  return packageDirs.flatMap((absDir) => {
    const packageJsonPath = path.join(absDir, "package.json");

    if (!existsSync(packageJsonPath)) {
      return [];
    }

    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      name?: unknown;
    };

    if (typeof packageJson.name !== "string") {
      return [];
    }

    return [
      {
        name: packageJson.name,
        relDir: toPosix(path.relative(rootDir, absDir)),
      },
    ];
  });
}

function findPackageDirs(rootDir: string): string[] {
  const dirs: string[] = [];

  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "node_modules") {
      continue;
    }

    const fullPath = path.join(rootDir, entry.name);

    if (existsSync(path.join(fullPath, "package.json"))) {
      dirs.push(fullPath);
      continue;
    }

    dirs.push(...findPackageDirs(fullPath));
  }

  return dirs;
}

function collectSourcePaths(rootDir: string): string[] {
  const relPaths: string[] = [];

  for (const includeRoot of DEFAULT_INCLUDE_ROOTS) {
    const absRoot = path.join(rootDir, includeRoot);

    if (!existsSync(absRoot)) {
      continue;
    }

    walkSourceTree(rootDir, absRoot, relPaths);
  }

  return relPaths.sort();
}

function walkSourceTree(
  rootDir: string,
  currentDir: string,
  relPaths: string[],
): void {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    const fullPath = path.join(currentDir, entry.name);
    const relPath = toPosix(path.relative(rootDir, fullPath));

    if (
      relPath.startsWith("node_modules/") ||
      relPath.startsWith("packages/web/dist/")
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      walkSourceTree(rootDir, fullPath, relPaths);
      continue;
    }

    if (!SOURCE_EXTENSIONS.some((extension) => relPath.endsWith(extension))) {
      continue;
    }

    relPaths.push(relPath);
  }
}

function readCompilerOptions(rootDir: string): ts.CompilerOptions {
  const configPath = path.join(rootDir, "tsconfig.json");

  if (!existsSync(configPath)) {
    return {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
    };
  }

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);

  if (configFile.error) {
    throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
  }

  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    rootDir,
  );

  return parsedConfig.options;
}

function buildDocuments(
  rootDir: string,
  relPaths: string[],
  workspacePackages: WorkspacePackage[],
  program: ts.Program,
): SourceDocument[] {
  return relPaths.flatMap((relPath) => {
    const absPath = path.join(rootDir, relPath);
    const sourceFile = program.getSourceFile(absPath);

    if (!sourceFile) {
      return [];
    }

    const workspacePackage = findWorkspacePackage(relPath, workspacePackages);
    const packageName = workspacePackage?.name ?? "scripts";
    const modulePath = buildModulePath(relPath, workspacePackage?.relDir ?? "scripts");

    return [
      {
        relPath,
        canonicalAbsPath: canonicalizePath(absPath),
        packageName,
        modulePath,
        sourceFile,
        importBindings: collectImportBindings(sourceFile),
        shouldAnalyze: shouldAnalyzePath(relPath),
      },
    ];
  });
}

function findWorkspacePackage(
  relPath: string,
  workspacePackages: WorkspacePackage[],
): WorkspacePackage | undefined {
  return workspacePackages.find((workspacePackage) => {
    return (
      relPath === workspacePackage.relDir ||
      relPath.startsWith(`${workspacePackage.relDir}/`)
    );
  });
}

function buildModulePath(relPath: string, packageRelDir: string): string {
  let moduleRelPath = relPath;

  if (moduleRelPath.startsWith(`${packageRelDir}/`)) {
    moduleRelPath = moduleRelPath.slice(packageRelDir.length + 1);
  }

  if (moduleRelPath.startsWith("src/")) {
    moduleRelPath = moduleRelPath.slice(4);
  }

  return moduleRelPath.replace(/\.d?\.tsx?$/, "").replace(/\.tsx?$/, "");
}

function shouldAnalyzePath(relPath: string): boolean {
  return (
    !relPath.endsWith(".d.ts") &&
    path.basename(relPath) !== "index.ts" &&
    !relPath.endsWith(".test.ts") &&
    !relPath.endsWith(".integration.test.ts")
  );
}

function collectImportBindings(sourceFile: ts.SourceFile): Map<string, ImportBinding> {
  const bindings = new Map<string, ImportBinding>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) {
      continue;
    }

    const moduleSpecifier = getStringLiteralText(statement.moduleSpecifier);

    if (!moduleSpecifier) {
      continue;
    }

    const { importClause } = statement;

    if (importClause.name) {
      bindings.set(importClause.name.text, {
        moduleSpecifier,
        exportedName: "default",
        namespace: false,
      });
    }

    if (!importClause.namedBindings) {
      continue;
    }

    if (ts.isNamespaceImport(importClause.namedBindings)) {
      bindings.set(importClause.namedBindings.name.text, {
        moduleSpecifier,
        exportedName: "*",
        namespace: true,
      });
      continue;
    }

    for (const element of importClause.namedBindings.elements) {
      bindings.set(element.name.text, {
        moduleSpecifier,
        exportedName: element.propertyName?.text ?? element.name.text,
        namespace: false,
      });
    }
  }

  return bindings;
}

function collectRepoNodes(document: SourceDocument, context: GraphContext): void {
  const visit = (node: ts.Node): void => {
    if (!ts.isClassDeclaration(node) || !node.name) {
      ts.forEachChild(node, visit);
      return;
    }

    const graphNode = createRepoNode(document, node);

    if (!graphNode) {
      ts.forEachChild(node, visit);
      return;
    }

    context.repoNodesByKey.set(getDeclarationKey(node), graphNode);
    context.allNodesByFqName.set(graphNode.fqName, graphNode);

    ts.forEachChild(node, visit);
  };

  visit(document.sourceFile);
}

function collectDeclaredEdges(document: SourceDocument, context: GraphContext): void {
  const visit = (node: ts.Node): void => {
    if (!ts.isClassDeclaration(node) || !node.name) {
      ts.forEachChild(node, visit);
      return;
    }

    const sourceNode = context.repoNodesByKey.get(getDeclarationKey(node));

    if (!sourceNode) {
      ts.forEachChild(node, visit);
      return;
    }

    const dependencies = new Set<string>();

    for (const member of node.members) {
      if (ts.isConstructorDeclaration(member)) {
        for (const parameter of member.parameters) {
          if (!parameter.type) {
            continue;
          }

          for (const dependency of resolveDependencyTypes(
            parameter.type,
            document,
            context,
          )) {
            dependencies.add(dependency);
          }
        }
      }
    }

    for (const dependency of dependencies) {
      addEdge(sourceNode.fqName, dependency, "declared", context);
    }

    ts.forEachChild(node, visit);
  };

  visit(document.sourceFile);
}

function collectRuntimeEdges(document: SourceDocument, context: GraphContext): void {
  walkStatements(document.sourceFile.statements, new Map(), document, context);
}

function walkStatements(
  statements: readonly ts.Statement[],
  scope: Scope,
  document: SourceDocument,
  context: GraphContext,
): void {
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!declaration.initializer) {
          continue;
        }

        const constructedClass = analyzeRuntimeExpression(
          declaration.initializer,
          scope,
          document,
          context,
        );

        if (constructedClass && ts.isIdentifier(declaration.name)) {
          scope.set(declaration.name.text, constructedClass);
        }
      }

      continue;
    }

    if (ts.isExpressionStatement(statement)) {
      analyzeRuntimeExpression(statement.expression, scope, document, context);
      continue;
    }

    if (ts.isBlock(statement)) {
      walkStatements(statement.statements, new Map(scope), document, context);
      continue;
    }

    if (ts.isIfStatement(statement)) {
      analyzeRuntimeExpression(statement.expression, scope, document, context);
      walkNestedStatement(statement.thenStatement, scope, document, context);

      if (statement.elseStatement) {
        walkNestedStatement(statement.elseStatement, scope, document, context);
      }

      continue;
    }

    if (ts.isReturnStatement(statement) && statement.expression) {
      analyzeRuntimeExpression(statement.expression, scope, document, context);
      continue;
    }

    ts.forEachChild(statement, (child) => {
      if (ts.isExpression(child)) {
        analyzeRuntimeExpression(child, scope, document, context);
      }
    });
  }
}

function walkNestedStatement(
  statement: ts.Statement,
  parentScope: Scope,
  document: SourceDocument,
  context: GraphContext,
): void {
  if (ts.isBlock(statement)) {
    walkStatements(statement.statements, new Map(parentScope), document, context);
    return;
  }

  walkStatements([statement], new Map(parentScope), document, context);
}

function analyzeRuntimeExpression(
  expression: ts.Expression,
  scope: Scope,
  document: SourceDocument,
  context: GraphContext,
): string | null {
  if (ts.isParenthesizedExpression(expression)) {
    return analyzeRuntimeExpression(expression.expression, scope, document, context);
  }

  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
    return analyzeRuntimeExpression(expression.expression, scope, document, context);
  }

  if (ts.isNonNullExpression(expression)) {
    return analyzeRuntimeExpression(expression.expression, scope, document, context);
  }

  if (ts.isIdentifier(expression)) {
    return scope.get(expression.text) ?? null;
  }

  if (!ts.isNewExpression(expression)) {
    return null;
  }

  const target = resolveConstructedClass(expression.expression, document, context);

  if (!target) {
    return null;
  }

  for (const argument of expression.arguments ?? []) {
    const concreteDependency = resolveRuntimeArgument(argument, scope, document, context);

    if (concreteDependency) {
      addEdge(target, concreteDependency, "runtime", context);
    }
  }

  return target;
}

function resolveRuntimeArgument(
  expression: ts.Expression,
  scope: Scope,
  document: SourceDocument,
  context: GraphContext,
): string | null {
  if (ts.isIdentifier(expression)) {
    return scope.get(expression.text) ?? null;
  }

  return analyzeRuntimeExpression(expression, scope, document, context);
}

function resolveConstructedClass(
  expression: ts.Expression,
  document: SourceDocument,
  context: GraphContext,
): string | null {
  if (ts.isIdentifier(expression)) {
    return resolveIdentifierReference(expression, document, context, true);
  }

  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression)
  ) {
    const binding = document.importBindings.get(expression.expression.text);

    if (binding?.namespace && isExternalModuleSpecifier(binding.moduleSpecifier)) {
      return ensureExternalNode(
        `${binding.moduleSpecifier}::${expression.name.text}`,
        context,
      ).fqName;
    }
  }

  return null;
}

function resolveDependencyTypes(
  typeNode: ts.TypeNode,
  document: SourceDocument,
  context: GraphContext,
): string[] {
  const dependencies = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const dependency = resolveIdentifierReference(node, document, context, false);

      if (dependency) {
        dependencies.add(dependency);
      }
    } else if (
      ts.isQualifiedName(node) &&
      ts.isIdentifier(node.left)
    ) {
      const binding = document.importBindings.get(node.left.text);

      if (binding?.namespace && isExternalModuleSpecifier(binding.moduleSpecifier)) {
        const externalDependency = resolveExternalReference(
          `${binding.moduleSpecifier}::${node.right.text}`,
          node.right,
          context,
        );

        if (externalDependency) {
          dependencies.add(externalDependency);
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(typeNode);

  return Array.from(dependencies);
}

function resolveIdentifierReference(
  identifier: ts.Identifier,
  document: SourceDocument,
  context: GraphContext,
  classesOnly: boolean,
): string | null {
  const importBinding = document.importBindings.get(identifier.text);
  const symbol = context.checker.getSymbolAtLocation(identifier);

  if (importBinding && isExternalModuleSpecifier(importBinding.moduleSpecifier)) {
    return resolveExternalReference(
      `${importBinding.moduleSpecifier}::${importBinding.exportedName}`,
      identifier,
      context,
      symbol,
      classesOnly,
    );
  }

  if (!symbol) {
    return importBinding ? fallbackWorkspaceResolution(importBinding, context, classesOnly) : null;
  }

  const resolvedSymbol =
    symbol.flags & ts.SymbolFlags.Alias
      ? context.checker.getAliasedSymbol(symbol)
      : symbol;
  const declarations = resolvedSymbol.getDeclarations() ?? [];

  for (const declaration of declarations) {
    const node = context.repoNodesByKey.get(getDeclarationKey(declaration));

    if (!node) {
      continue;
    }

    return node.fqName;
  }

  return importBinding
    ? fallbackWorkspaceResolution(importBinding, context, classesOnly)
    : null;
}

function fallbackWorkspaceResolution(
  importBinding: ImportBinding,
  context: GraphContext,
  classesOnly: boolean,
): string | null {
  if (!isWorkspaceModuleSpecifier(importBinding.moduleSpecifier)) {
    return null;
  }

  const candidates = Array.from(context.allNodesByFqName.values()).filter((node) => {
    return (
      node.packageName === importBinding.moduleSpecifier &&
      node.symbolName === importBinding.exportedName &&
      (!classesOnly || node.kind !== "interface")
    );
  });

  return candidates.length === 1 ? candidates[0].fqName : null;
}

function createRepoNode(
  document: SourceDocument,
  declaration: ts.ClassDeclaration,
): GraphNode | null {
  const layer = classifyLayer(document.relPath);

  if (!layer) {
    return null;
  }

  const symbolName = declaration.name?.text ?? "anonymous";
  const fqName = `${document.packageName}::${document.modulePath}::${symbolName}`;

  return {
    id: sanitize(fqName),
    fqName,
    kind: hasModifier(declaration, ts.SyntaxKind.AbstractKeyword)
      ? "abstract-class"
      : "class",
    layer,
    packageName: document.packageName,
    modulePath: document.modulePath,
    symbolName,
  };
}

function ensureExternalNode(fqName: string, context: GraphContext): GraphNode {
  const existingNode = context.allNodesByFqName.get(fqName);

  if (existingNode) {
    return existingNode;
  }

  const [, symbolName = fqName] = fqName.split("::");
  const node: GraphNode = {
    id: sanitize(fqName),
    fqName,
    kind: "external",
    layer: "External",
    packageName: "external",
    modulePath: "external",
    symbolName,
  };

  context.allNodesByFqName.set(fqName, node);

  return node;
}

function addEdge(
  from: string,
  to: string,
  kind: GraphEdgeKind,
  context: GraphContext,
): void {
  if (from === to) {
    return;
  }

  if (!context.allNodesByFqName.has(from)) {
    return;
  }

  if (!context.allNodesByFqName.has(to)) {
    return;
  }

  const key = `${kind}:${from}->${to}`;

  if (context.allEdgesByKey.has(key)) {
    return;
  }

  context.allEdgesByKey.set(key, { from, to, kind });
}

function hasModifier(
  node: ts.Node,
  kind: ts.SyntaxKind,
): boolean {
  return !!node.modifiers?.some((modifier) => modifier.kind === kind);
}

function isWorkspaceModuleSpecifier(moduleSpecifier: string): boolean {
  return moduleSpecifier.startsWith("@thoth/");
}

function isExternalModuleSpecifier(moduleSpecifier: string): boolean {
  return !moduleSpecifier.startsWith(".") && !isWorkspaceModuleSpecifier(moduleSpecifier);
}

function classifyLayer(relPath: string): GraphLayer | null {
  if (
    relPath.startsWith("packages/domain/") ||
    relPath.startsWith("packages/config/") ||
    relPath.startsWith("packages/message-proxy/") ||
    relPath.startsWith("packages/web/") ||
    relPath.startsWith("packages/mobile/")
  ) {
    return null;
  }

  if (relPath.includes("/inbound/") || relPath.includes("/bootstrap/")) {
    return "Controller/Workflow";
  }

  if (relPath.includes("/application/")) {
    return "App services";
  }

  if (relPath.includes("/domain/")) {
    return "Domain services";
  }

  if (relPath.includes("/outbound/")) {
    return "Repository / Adapter";
  }

  return null;
}

function resolveExternalReference(
  fqName: string,
  referenceNode: ts.Node,
  context: GraphContext,
  symbol = context.checker.getSymbolAtLocation(referenceNode),
  classesOnly = true,
): string | null {
  if (!symbol) {
    return classesOnly ? null : ensureExternalNode(fqName, context).fqName;
  }

  const resolvedSymbol =
    symbol.flags & ts.SymbolFlags.Alias
      ? context.checker.getAliasedSymbol(symbol)
      : symbol;
  const declarations = resolvedSymbol.getDeclarations() ?? [];

  if (classesOnly) {
    const isClassReference = declarations.some((declaration) =>
      ts.isClassDeclaration(declaration),
    );

    if (!isClassReference) {
      return null;
    }
  }

  return ensureExternalNode(fqName, context).fqName;
}

function getDeclarationKey(node: ts.Node): string {
  return `${canonicalizePath(node.getSourceFile().fileName)}::${getNodeName(node)}`;
}

function getNodeName(node: ts.Node): string {
  if (ts.isClassDeclaration(node) && node.name) {
    return node.name.text;
  }

  return "";
}

function getStringLiteralText(node: ts.Expression): string | null {
  return ts.isStringLiteral(node) ? node.text : null;
}

function canonicalizePath(inputPath: string): string {
  try {
    return toPosix(realpathSync(inputPath));
  } catch {
    return toPosix(path.resolve(inputPath));
  }
}

function toPosix(value: string): string {
  return value.replaceAll(path.sep, "/");
}

function sanitize(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9]+/g, "_");
}

function escapeMermaid(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', "&quot;");
}

if (import.meta.main) {
  const graph = await generateInjectionGraph({
    rootDir: process.cwd(),
    outputPath: DEFAULT_OUTPUT_PATH,
  });

  console.log(`Wrote ${graph.outputPath}`);
  console.log(`Repo symbols: ${graph.repoSymbolCount}`);
  console.log(`External symbols: ${graph.externalSymbolCount}`);
  console.log(`Declared edges: ${graph.declaredEdgeCount}`);
  console.log(`Runtime edges: ${graph.runtimeEdgeCount}`);
}
