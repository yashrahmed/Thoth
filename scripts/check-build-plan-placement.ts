import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

export type PlanActionSets = {
  readonly appActions: ReadonlyArray<string>;
  readonly domainActions: ReadonlyArray<string>;
  readonly infraActions: ReadonlyArray<string>;
};

export type Layer = "application" | "domainService" | "domainContract" | "outboundAdapter" | "inboundAdapter" | "other";

export type ScannedSymbol = {
  readonly name: string;
  readonly kind: "class" | "method";
  readonly layer: Layer;
  readonly filePath: string;
  readonly ownerName: string;
};

export type PlacementFinding = {
  readonly group: "App" | "Domain" | "Infra";
  readonly actionName: string;
  readonly expectedSymbolName: string;
  readonly message: string;
  readonly matches: ReadonlyArray<ScannedSymbol>;
};

type PlacementCheckResult = {
  readonly findings: ReadonlyArray<PlacementFinding>;
  readonly appActionCount: number;
  readonly domainActionCount: number;
  readonly infraActionCount: number;
};

const ROOT_DIR = path.resolve(import.meta.dir, "..");
const BUILD_PLAN_PATH = path.join(ROOT_DIR, "docs/plans/build_plan.md");
const CONV_AGENT_SRC_DIR = path.join(ROOT_DIR, "packages/conv-agent/src");

export function parsePlanActions(markdown: string): PlanActionSets {
  const appActions: string[] = [];
  const domainActions: string[] = [];
  const infraActions: string[] = [];
  let section: "none" | "legacyActions" | "applicationActions" | "domainActions" | "infra" = "none";

  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith("## ")) {
      if (line === "## Actions") {
        section = "legacyActions";
        continue;
      }

      if (line === "## Application Flow Actions") {
        section = "applicationActions";
        continue;
      }

      if (line === "## Domain Service Actions") {
        section = "domainActions";
        continue;
      }

      if (line === "## Infra Actions") {
        section = "infra";
        continue;
      }

      section = "none";
      continue;
    }

    if (!line.startsWith("### ")) {
      continue;
    }

    const actionName = extractHeadingActionName(line);

    if (!actionName) {
      continue;
    }

    if (section === "legacyActions") {
      if (actionName.startsWith("App.")) {
        appActions.push(actionName);
      } else if (!actionName.startsWith("Infra.")) {
        domainActions.push(actionName);
      }

      continue;
    }

    if (section === "infra") {
      infraActions.push(actionName);
    }

    if (section === "applicationActions") {
      appActions.push(actionName);
      continue;
    }

    if (section === "domainActions") {
      domainActions.push(actionName);
    }
  }

  return {
    appActions,
    domainActions,
    infraActions,
  };
}

export function normalizeAppActionName(actionName: string): string {
  const qualifiedName = extractQualifiedMemberName(actionName);

  if (qualifiedName) {
    return qualifiedName.ownerName;
  }

  return `${stripPrefix(actionName, "App.")}Flow`;
}

export function normalizeDomainActionName(actionName: string): string {
  const qualifiedName = extractQualifiedMemberName(actionName);

  if (qualifiedName) {
    return qualifiedName.memberName;
  }

  return lowerFirst(stripPrefix(actionName, "App."));
}

export function normalizeInfraActionName(actionName: string): string {
  return lowerFirst(stripPrefix(actionName, "Infra."));
}

export async function scanConvAgentSymbols(srcDir: string): Promise<ReadonlyArray<ScannedSymbol>> {
  const filePaths = await listSourceFiles(srcDir);
  const symbols: ScannedSymbol[] = [];

  for (const filePath of filePaths) {
    const relativePath = path.relative(ROOT_DIR, filePath);
    const layer = classifyLayer(relativePath);
    const sourceText = await readFile(filePath, "utf8");
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    for (const statement of sourceFile.statements) {
      if (ts.isClassDeclaration(statement) && statement.name && hasExportModifier(statement)) {
        symbols.push({
          name: statement.name.text,
          kind: "class",
          layer,
          filePath: relativePath,
          ownerName: statement.name.text,
        });

        for (const member of statement.members) {
          if (!isPublicInstanceMethod(member)) {
            continue;
          }

          symbols.push({
            name: member.name.text,
            kind: "method",
            layer,
            filePath: relativePath,
            ownerName: statement.name.text,
          });
        }
      }

      if (ts.isInterfaceDeclaration(statement) && hasExportModifier(statement)) {
        for (const member of statement.members) {
          if (!ts.isMethodSignature(member) || !ts.isIdentifier(member.name)) {
            continue;
          }

          symbols.push({
            name: member.name.text,
            kind: "method",
            layer,
            filePath: relativePath,
            ownerName: statement.name.text,
          });
        }
      }
    }
  }

  return symbols;
}

export function evaluatePlacement(planActions: PlanActionSets, symbols: ReadonlyArray<ScannedSymbol>): PlacementCheckResult {
  const findings: PlacementFinding[] = [];

  for (const actionName of planActions.appActions) {
    const expectedSymbolName = normalizeAppActionName(actionName);
    const targetMatches = findSymbols(symbols, {
      name: expectedSymbolName,
      kind: "class",
      layers: ["application"],
    });
    const wrongLayerMatches = findSymbols(symbols, {
      name: expectedSymbolName,
      kind: "class",
      layers: ["domainService", "domainContract", "outboundAdapter", "inboundAdapter", "other"],
    });

    addFindingsForSingleTarget(findings, {
      group: "App",
      actionName,
      expectedSymbolName,
      targetMatches,
      wrongLayerMatches,
      expectedDescription: "application flow class",
    });
  }

  for (const actionName of planActions.domainActions) {
    const expectedSymbolName = normalizeDomainActionName(actionName);
    const targetMatches = findSymbols(symbols, {
      name: expectedSymbolName,
      kind: "method",
      layers: ["domainService"],
    });
    const wrongLayerMatches = findSymbols(symbols, {
      name: expectedSymbolName,
      kind: "method",
      layers: ["application", "domainContract", "outboundAdapter", "inboundAdapter", "other"],
    });

    addFindingsForSingleTarget(findings, {
      group: "Domain",
      actionName,
      expectedSymbolName,
      targetMatches,
      wrongLayerMatches,
      expectedDescription: "domain service method",
    });
  }

  for (const actionName of planActions.infraActions) {
    const expectedSymbolName = normalizeInfraActionName(actionName);
    const contractMatches = findSymbols(symbols, {
      name: expectedSymbolName,
      kind: "method",
      layers: ["domainContract"],
    });
    const adapterMatches = findSymbols(symbols, {
      name: expectedSymbolName,
      kind: "method",
      layers: ["outboundAdapter"],
    });
    const wrongLayerMatches = findSymbols(symbols, {
      name: expectedSymbolName,
      kind: "method",
      layers: ["application", "domainService", "inboundAdapter", "other"],
    });

    if (contractMatches.length === 1 && adapterMatches.length > 0) {
      continue;
    }

    if (contractMatches.length > 1) {
      findings.push({
        group: "Infra",
        actionName,
        expectedSymbolName,
        message: `Expected exactly one domain contract method named ${expectedSymbolName}, but found ${contractMatches.length}.`,
        matches: contractMatches,
      });
    }

    if (contractMatches.length === 0) {
      findings.push({
        group: "Infra",
        actionName,
        expectedSymbolName,
        message:
          wrongLayerMatches.length > 0
            ? `Expected a domain contract method named ${expectedSymbolName}, but matching methods exist only in the wrong layer.`
            : `Expected a domain contract method named ${expectedSymbolName}, but none was found.`,
        matches: wrongLayerMatches,
      });
    }

    if (adapterMatches.length === 0) {
      findings.push({
        group: "Infra",
        actionName,
        expectedSymbolName,
        message:
          wrongLayerMatches.length > 0
            ? `Expected an outbound adapter method named ${expectedSymbolName}, but matching methods exist only in the wrong layer.`
            : `Expected an outbound adapter method named ${expectedSymbolName}, but none was found.`,
        matches: contractMatches.length === 1 ? contractMatches : [],
      });
    }
  }

  return {
    findings,
    appActionCount: planActions.appActions.length,
    domainActionCount: planActions.domainActions.length,
    infraActionCount: planActions.infraActions.length,
  };
}

export function formatPlacementReport(result: PlacementCheckResult): string {
  if (result.findings.length === 0) {
    return `Placement check passed: ${result.appActionCount} App actions, ${result.domainActionCount} Domain actions, ${result.infraActionCount} Infra actions.`;
  }

  const lines: string[] = [];
  const groups: ReadonlyArray<PlacementFinding["group"]> = ["App", "Domain", "Infra"];
  let index = 1;

  for (const group of groups) {
    const groupFindings = result.findings.filter((finding) => finding.group === group);

    if (groupFindings.length === 0) {
      continue;
    }

    lines.push(`${group} Findings`);

    for (const finding of groupFindings) {
      lines.push(`${index}. ${finding.actionName} -> ${finding.message}`);

      if (finding.matches.length > 0) {
        lines.push(`   Matches: ${formatMatches(finding.matches)}`);
      }

      index += 1;
    }
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const markdown = await readFile(BUILD_PLAN_PATH, "utf8");
  const planActions = parsePlanActions(markdown);
  const symbols = await scanConvAgentSymbols(CONV_AGENT_SRC_DIR);
  const result = evaluatePlacement(planActions, symbols);
  const report = formatPlacementReport(result);

  if (result.findings.length > 0) {
    console.error(report);
    process.exit(1);
  }

  console.log(report);
}

function extractHeadingActionName(line: string): string | null {
  const match = /^###\s+([^:(]+?)\s*(?:\(|:|$)/.exec(line);
  return match?.[1] ?? null;
}

function extractQualifiedMemberName(actionName: string): { readonly ownerName: string; readonly memberName: string } | null {
  const separatorIndex = actionName.lastIndexOf(".");

  if (separatorIndex <= 0 || separatorIndex === actionName.length - 1) {
    return null;
  }

  return {
    ownerName: actionName.slice(0, separatorIndex),
    memberName: actionName.slice(separatorIndex + 1),
  };
}

function stripPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function lowerFirst(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toLowerCase() ?? ""}${value.slice(1)}`;
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

function classifyLayer(relativePath: string): Layer {
  if (relativePath.startsWith("packages/conv-agent/src/application/")) {
    return "application";
  }

  if (relativePath.startsWith("packages/conv-agent/src/domain/services/")) {
    return "domainService";
  }

  if (relativePath.startsWith("packages/conv-agent/src/domain/contracts/")) {
    return "domainContract";
  }

  if (relativePath.startsWith("packages/conv-agent/src/adapter/inbound/")) {
    return "inboundAdapter";
  }

  if (relativePath.startsWith("packages/conv-agent/src/adapter/")) {
    return "outboundAdapter";
  }

  return "other";
}

function hasExportModifier(node: { readonly modifiers?: ts.NodeArray<ts.ModifierLike> }): boolean {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function hasModifier(node: { readonly modifiers?: ts.NodeArray<ts.ModifierLike> }, kind: ts.SyntaxKind): boolean {
  return node.modifiers?.some((modifier) => modifier.kind === kind) ?? false;
}

function isPublicInstanceMethod(member: ts.ClassElement): member is ts.MethodDeclaration & { readonly name: ts.Identifier } {
  return (
    ts.isMethodDeclaration(member) &&
    ts.isIdentifier(member.name) &&
    !hasModifier(member, ts.SyntaxKind.PrivateKeyword) &&
    !hasModifier(member, ts.SyntaxKind.ProtectedKeyword) &&
    !hasModifier(member, ts.SyntaxKind.StaticKeyword)
  );
}

function findSymbols(
  symbols: ReadonlyArray<ScannedSymbol>,
  input: {
    readonly name: string;
    readonly kind: ScannedSymbol["kind"];
    readonly layers: ReadonlyArray<Layer>;
  },
): ReadonlyArray<ScannedSymbol> {
  return symbols.filter((symbol) => symbol.name === input.name && symbol.kind === input.kind && input.layers.includes(symbol.layer));
}

function addFindingsForSingleTarget(
  findings: PlacementFinding[],
  input: {
    readonly group: PlacementFinding["group"];
    readonly actionName: string;
    readonly expectedSymbolName: string;
    readonly targetMatches: ReadonlyArray<ScannedSymbol>;
    readonly wrongLayerMatches: ReadonlyArray<ScannedSymbol>;
    readonly expectedDescription: string;
  },
): void {
  if (input.targetMatches.length === 1) {
    return;
  }

  if (input.targetMatches.length > 1) {
    findings.push({
      group: input.group,
      actionName: input.actionName,
      expectedSymbolName: input.expectedSymbolName,
      message: `Expected exactly one ${input.expectedDescription} named ${input.expectedSymbolName}, but found ${input.targetMatches.length}.`,
      matches: input.targetMatches,
    });
    return;
  }

  findings.push({
    group: input.group,
    actionName: input.actionName,
    expectedSymbolName: input.expectedSymbolName,
    message:
      input.wrongLayerMatches.length > 0
        ? `Expected ${input.expectedDescription} named ${input.expectedSymbolName}, but matching symbols exist only in the wrong layer.`
        : `Expected ${input.expectedDescription} named ${input.expectedSymbolName}, but none was found.`,
    matches: input.wrongLayerMatches,
  });
}

function formatMatches(matches: ReadonlyArray<ScannedSymbol>): string {
  return matches.map((match) => `${match.ownerName}.${match.name} (${match.layer}, ${match.filePath})`).join("; ");
}

if (import.meta.main) {
  await main();
}
