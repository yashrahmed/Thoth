import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { instance } from "@viz-js/viz";
import ts from "typescript";

const ROOT = process.cwd();
const OUTPUT_PATH = path.join(ROOT, "docs", "file-import-dependencies.svg");
const INCLUDE_ROOTS = ["packages", "scripts"];
const VALID_EXTENSIONS = new Set([".ts", ".tsx"]);
interface GraphNode {
  id: string;
  relPath: string;
  packageName: string;
  topLevelFolder: string;
  fileName: string;
}

const files = collectFiles();
const nodes = new Map(files.map((relPath) => [relPath, buildNode(relPath)]));
const edges = collectEdges(files, nodes);
const dot = buildDot(nodes, edges);
const viz = await instance();
const svg = viz.renderString(dot, { format: "svg", engine: "dot" });

mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, svg, "utf8");

console.log(`Wrote ${OUTPUT_PATH}`);
console.log(`Nodes: ${nodes.size}`);
console.log(`Edges: ${edges.length}`);

function collectFiles(): string[] {
  const relPaths: string[] = [];

  for (const relativeRoot of INCLUDE_ROOTS) {
    const absoluteRoot = path.join(ROOT, relativeRoot);

    if (!pathExists(absoluteRoot)) {
      continue;
    }

    walk(absoluteRoot, relPaths);
  }

  return relPaths.sort();
}

function walk(currentDir: string, relPaths: string[]): void {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    const fullPath = path.join(currentDir, entry.name);
    const relPath = path.relative(ROOT, fullPath).replaceAll(path.sep, "/");

    if (
      relPath.startsWith("node_modules/") ||
      relPath.startsWith("packages/web/dist/")
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      walk(fullPath, relPaths);
      continue;
    }

    if (!VALID_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }

    if (entry.name === "index.ts" || entry.name.endsWith(".d.ts")) {
      continue;
    }

    relPaths.push(relPath);
  }
}

function buildNode(relPath: string): GraphNode {
  const parts = relPath.split("/");

  return {
    id: relPath.replaceAll(/[^a-zA-Z0-9]+/g, "_"),
    relPath,
    packageName: packageNameFromPath(parts),
    topLevelFolder: topLevelFolderFromPath(parts),
    fileName: parts.at(-1) ?? relPath,
  };
}

function packageNameFromPath(parts: string[]): string {
  if (parts[0] === "packages") {
    if (parts[1] === "domain") {
      return `${parts[1]}/${parts[2]}`;
    }

    return parts[1] ?? "unknown";
  }

  return parts[0] ?? "unknown";
}

function topLevelFolderFromPath(parts: string[]): string {
  if (parts[0] === "packages") {
    const packageDepth = parts[1] === "domain" ? 3 : 2;
    const rest = parts.slice(packageDepth);

    if (rest[0] === "src") {
      return rest[1] ?? "(root)";
    }

    return rest[0] ?? "(root)";
  }

  return parts[1] ?? "(root)";
}

function collectEdges(
  relPaths: string[],
  graphNodes: Map<string, GraphNode>,
): Array<[string, string]> {
  const graphEdges: Array<[string, string]> = [];

  for (const relPath of relPaths) {
    const source = readFileSync(path.join(ROOT, relPath), "utf8");

    for (const specifier of collectModuleSpecifiers(relPath, source)) {
      if (!specifier?.startsWith(".")) {
        continue;
      }

      const resolved = resolveRelativeImport(relPath, specifier, graphNodes);

      if (!resolved) {
        continue;
      }

      graphEdges.push([relPath, resolved]);
    }
  }

  return graphEdges;
}

function resolveRelativeImport(
  fromRelPath: string,
  specifier: string,
  graphNodes: Map<string, GraphNode>,
): string | null {
  const normalized = path.posix.normalize(
    path.posix.join(path.posix.dirname(fromRelPath), specifier),
  );
  const candidates = [normalized, `${normalized}.ts`, `${normalized}.tsx`];

  for (const candidate of candidates) {
    if (graphNodes.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

function buildDot(
  graphNodes: Map<string, GraphNode>,
  graphEdges: Array<[string, string]>,
): string {
  const packageOrder = [
    "agents",
    "config",
    "domain/contracts",
    "domain/entities",
    "message-proxy",
    "web",
    "scripts",
  ];
  const packages = Array.from(
    new Set(Array.from(graphNodes.values()).map((node) => node.packageName)),
  ).sort((left, right) => {
    const leftIndex = packageOrder.indexOf(left);
    const rightIndex = packageOrder.indexOf(right);

    if (leftIndex !== -1 || rightIndex !== -1) {
      return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
    }

    return left.localeCompare(right);
  });

  const lines = [
    "digraph Imports {",
    '  graph [',
    '    rankdir=LR,',
    '    splines=ortho,',
    '    bgcolor="#fcfcfb",',
    '    pad="0.4",',
    '    nodesep="0.35",',
    '    ranksep="0.8",',
    '    labelloc="t",',
    '    label="File Import Dependencies\\nRepo-local file imports only. index.ts excluded.\\nEach node is package / top_level_folder / file_name."', 
    '  ];',
    '  node [',
    '    shape=box,',
    '    style="rounded,filled",',
    '    fillcolor="#ffffff",',
    '    color="#94a3b8",',
    '    fontname="Menlo",',
    '    fontsize="10",',
    '    margin="0.18,0.10"',
    '  ];',
    '  edge [',
    '    color="#64748b",',
    '    penwidth="1.2",',
    '    arrowsize="0.7"',
    '  ];',
  ];

  for (const packageName of packages) {
    const packageNodes = Array.from(graphNodes.values())
      .filter((node) => node.packageName === packageName)
      .sort((left, right) => {
        return (
          left.topLevelFolder.localeCompare(right.topLevelFolder) ||
          left.fileName.localeCompare(right.fileName)
        );
      });

    lines.push(`  subgraph "cluster_${sanitize(packageName)}" {`);
    lines.push(`    label="${escapeDot(packageName)}";`);
    lines.push('    color="#d1d5db";');
    lines.push('    style="rounded";');

    for (const node of packageNodes) {
      lines.push(
        `    "${node.id}" [label="${escapeDot(node.packageName)}\\n${escapeDot(node.topLevelFolder)}\\n${escapeDot(node.fileName)}"];`,
      );
    }

    lines.push("  }");
  }

  for (const [from, to] of graphEdges) {
    const fromNode = graphNodes.get(from);
    const toNode = graphNodes.get(to);

    if (!fromNode || !toNode) {
      continue;
    }

    lines.push(`  "${fromNode.id}" -> "${toNode.id}";`);
  }

  lines.push("}");

  return `${lines.join("\n")}\n`;
}

function sanitize(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9]+/g, "_");
}

function escapeDot(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function collectModuleSpecifiers(relPath: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(relPath, source, ts.ScriptTarget.Latest, true);
  const specifiers = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.add(node.moduleSpecifier.text);
    }

    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.add(node.moduleSpecifier.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return Array.from(specifiers);
}

function pathExists(targetPath: string): boolean {
  return existsSync(targetPath);
}
