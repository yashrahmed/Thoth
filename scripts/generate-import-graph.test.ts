import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildMermaid,
  buildInjectionGraph,
  type InjectionGraph,
} from "./generate-import-graph";

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("generate-import-graph", () => {
  test("collects declared edges for injected classes and ignores interfaces", () => {
    const rootDir = createWorkspace({
      "packages/app/package.json": packageJson("@app/main"),
      "packages/app/src/application/service.ts": `
        import {
          type Repo,
        } from "../domain/deps";
        import { Helper } from "../outbound/helper";

        export class Service {
          public constructor(
            private readonly repo: Repo,
            private readonly helper: Helper,
          ) {}
        }
      `,
      "packages/app/src/domain/deps.ts": `
        export interface Repo {}
      `,
      "packages/app/src/outbound/helper.ts": `
        export class Helper {}
      `,
    });
    const graph = buildInjectionGraph(rootDir);
    const edges = edgeSet(graph, "declared");

    expect(edges).toContain(
      "declared:@app/main::application/service::Service->@app/main::outbound/helper::Helper",
    );
    expect(
      graph.nodes.some((node) => node.fqName === "@app/main::domain/deps::Repo"),
    ).toBe(false);
  });

  test("creates external nodes for imported external types", () => {
    const rootDir = createWorkspace({
      "packages/app/package.json": packageJson("@app/main"),
      "packages/app/src/outbound/client.ts": `
        import type { Pool } from "pg";

        export class Client {
          public constructor(private readonly pool: Pool) {}
        }
      `,
    });
    const graph = buildInjectionGraph(rootDir);

    expect(
      graph.nodes.some((node) => node.fqName === "pg::Pool" && node.kind === "external"),
    ).toBe(true);
    expect(edgeSet(graph, "declared")).toContain(
      "declared:@app/main::outbound/client::Client->pg::Pool",
    );
  });

  test("includes class symbols from one file and excludes index.ts nodes", () => {
    const rootDir = createWorkspace({
      "packages/app/package.json": packageJson("@app/main"),
      "packages/app/src/outbound/multi.ts": `
        export interface Repo {}
        export class Impl {}
        export class Service {
          public constructor(
            private readonly repo: Repo,
            private readonly impl: Impl,
          ) {}
        }
      `,
      "packages/app/src/index.ts": `
        export class IgnoredIndexClass {}
      `,
    });
    const graph = buildInjectionGraph(rootDir);

    expect(
      graph.nodes.some((node) => node.fqName === "@app/main::outbound/multi::Impl"),
    ).toBe(true);
    expect(
      graph.nodes.some((node) => node.fqName === "@app/main::outbound/multi::Service"),
    ).toBe(true);
    expect(
      graph.nodes.some((node) => node.fqName.includes("IgnoredIndexClass")),
    ).toBe(false);
  });

  test("ignores scripts when building the graph", () => {
    const rootDir = createWorkspace({
      "packages/app/package.json": packageJson("@app/main"),
      "packages/app/src/application/service.ts": `
        export class Service {}
      `,
      "scripts/helper.ts": `
        export class ScriptHelper {}
      `,
    });
    const graph = buildInjectionGraph(rootDir);

    expect(
      graph.nodes.some((node) => node.fqName.includes("ScriptHelper")),
    ).toBe(false);
  });

  test("infers runtime edges from direct new expressions and earlier bindings", () => {
    const rootDir = createWorkspace({
      "packages/app/package.json": packageJson("@app/main"),
      "packages/app/src/application/service.ts": `
        import { Helper, RepoImpl } from "../outbound/deps";

        export class Service {
          public constructor(
            private readonly repo: RepoImpl,
            private readonly helper: Helper,
          ) {}
        }
      `,
      "packages/app/src/outbound/deps.ts": `
        export class RepoImpl {}
        export class Helper {}
      `,
      "packages/app/src/bootstrap/workflow.ts": `
        import { Helper, RepoImpl } from "../outbound/deps";
        import { Service } from "../application/service";

        const repo = new RepoImpl();
        new Service(repo, new Helper());

        const unresolved = makeHelper();
        new Service(repo, unresolved);

        function makeHelper(): Helper {
          return new Helper();
        }
      `,
    });
    const graph = buildInjectionGraph(rootDir);
    const edges = edgeSet(graph, "runtime");

    expect(edges).toContain(
      "runtime:@app/main::application/service::Service->@app/main::outbound/deps::RepoImpl",
    );
    expect(edges).toContain(
      "runtime:@app/main::application/service::Service->@app/main::outbound/deps::Helper",
    );
    expect(
      Array.from(edges).filter((edge) => edge.includes("Helper")).length,
    ).toBe(1);
  });

  test("buildMermaid renders fully qualified labels, layer subgraphs, and edge styles", () => {
    const rootDir = createWorkspace({
      "packages/app/package.json": packageJson("@app/main"),
      "packages/app/src/outbound/client.ts": `
        import type { Pool } from "pg";

        export class Client {
          public constructor(private readonly pool: Pool) {}
        }
      `,
      "packages/app/src/application/service.ts": `
        import { Helper } from "../outbound/helper";

        export class Service {
          public constructor(private readonly helper: Helper) {}
        }
      `,
      "packages/app/src/outbound/helper.ts": `
        export class Helper {}
      `,
      "packages/app/src/bootstrap/workflow.ts": `
        import { Client } from "../outbound/client";
        import { Pool } from "pg";
        import { Helper } from "../outbound/helper";
        import { Service } from "../application/service";

        const pool = new Pool();
        const helper = new Helper();
        new Client(pool);
        new Service(helper);
      `,
    });
    const graph = buildInjectionGraph(rootDir);
    const mermaid = buildMermaid(graph);

    expect(mermaid).toContain("flowchart LR");
    expect(mermaid).toContain("-.->");
    expect(mermaid).toContain('subgraph External["External"]');
    expect(mermaid).toContain('subgraph App_services["App services"]');
    expect(mermaid).toContain('subgraph Repository_Adapter["Repository / Adapter"]');
    expect(mermaid).toContain("@app/main::outbound/client::Client");
    expect(mermaid).toContain("pg::Pool");
  });

  test("resolves runtime wiring edges in the real repo", () => {
    const graph = buildInjectionGraph(process.cwd());
    const edges = edgeSet(graph, "runtime");

    expect(
      graph.nodes.some(
        (node) =>
          node.fqName ===
          "@thoth/agents::conversations/inbound/http/conversations-controller::ConversationsController",
      ),
    ).toBe(true);
    expect(
      graph.nodes.some(
        (node) =>
          node.fqName ===
          "@thoth/agents::conversations/application/conversations-service::ConversationsService",
      ),
    ).toBe(true);
    expect(edges).toContain(
      "runtime:@thoth/agents::conversations/inbound/http/conversations-controller::ConversationsController->@thoth/agents::conversations/application/conversations-service::ConversationsService",
    );
    expect(edges).toContain(
      "runtime:@thoth/agents::conversations/application/conversations-service::ConversationsService->@thoth/agents::conversations/outbound/postgres/postgres-conversation-repository::PostgresConversationRepository",
    );
    expect(edges).toContain(
      "runtime:@thoth/agents::conversations/application/conversations-service::ConversationsService->@thoth/agents::conversations/outbound/blob/r2-blob-store::R2BlobStore",
    );
    expect(
      graph.nodes.some((node) => node.packageName === "@thoth/entities"),
    ).toBe(false);
    expect(
      graph.nodes.some((node) => node.packageName === "@thoth/contracts"),
    ).toBe(false);
  });
});

function createWorkspace(files: Record<string, string>): string {
  const rootDir = mkdtempSync(path.join(tmpdir(), "thoth-graph-"));

  tempDirs.push(rootDir);

  writeFixtureFile(
    rootDir,
    "tsconfig.json",
    JSON.stringify(
      {
        compilerOptions: {
          target: "ESNext",
          module: "ESNext",
          moduleResolution: "bundler",
          strict: true,
          skipLibCheck: true,
        },
      },
      null,
      2,
    ),
  );

  for (const [relPath, content] of Object.entries(files)) {
    writeFixtureFile(rootDir, relPath, content);
  }

  return rootDir;
}

function writeFixtureFile(rootDir: string, relPath: string, content: string): void {
  const absPath = path.join(rootDir, relPath);

  mkdirSync(path.dirname(absPath), { recursive: true });
  writeFileSync(absPath, `${content.trim()}\n`, "utf8");
}

function packageJson(name: string): string {
  return JSON.stringify({ name, private: true, type: "module" }, null, 2);
}

function edgeSet(
  graph: InjectionGraph,
  kind: "declared" | "runtime",
): Set<string> {
  return new Set(
    graph.edges
      .filter((edge) => edge.kind === kind)
      .map((edge) => `${edge.kind}:${edge.from}->${edge.to}`),
  );
}
