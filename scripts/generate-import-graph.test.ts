import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildDot,
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
  test("collects declared edges for relative class and interface imports", () => {
    const rootDir = createWorkspace({
      "packages/app/package.json": packageJson("@app/main"),
      "packages/app/src/service.ts": `
        import {
          type Repo,
          Helper,
        } from "./deps";

        export class Service {
          public constructor(
            private readonly repo: Repo,
            private readonly helper: Helper,
          ) {}
        }
      `,
      "packages/app/src/deps.ts": `
        export interface Repo {}
        export class Helper {}
      `,
    });
    const graph = buildInjectionGraph(rootDir);
    const edges = edgeSet(graph, "declared");

    expect(edges).toContain(
      "declared:@app/main::service::Service->@app/main::deps::Repo",
    );
    expect(edges).toContain(
      "declared:@app/main::service::Service->@app/main::deps::Helper",
    );
  });

  test("creates external nodes for imported external types", () => {
    const rootDir = createWorkspace({
      "packages/app/package.json": packageJson("@app/main"),
      "packages/app/src/client.ts": `
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
      "declared:@app/main::client::Client->pg::Pool",
    );
  });

  test("includes multiple symbols from one file and excludes index.ts nodes", () => {
    const rootDir = createWorkspace({
      "packages/app/package.json": packageJson("@app/main"),
      "packages/app/src/multi.ts": `
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
      graph.nodes.some((node) => node.fqName === "@app/main::multi::Repo"),
    ).toBe(true);
    expect(
      graph.nodes.some((node) => node.fqName === "@app/main::multi::Impl"),
    ).toBe(true);
    expect(
      graph.nodes.some((node) => node.fqName === "@app/main::multi::Service"),
    ).toBe(true);
    expect(
      graph.nodes.some((node) => node.fqName.includes("IgnoredIndexClass")),
    ).toBe(false);
  });

  test("infers runtime edges from direct new expressions and earlier bindings", () => {
    const rootDir = createWorkspace({
      "packages/app/package.json": packageJson("@app/main"),
      "packages/app/src/service.ts": `
        import { Helper, RepoImpl } from "./deps";

        export class Service {
          public constructor(
            private readonly repo: RepoImpl,
            private readonly helper: Helper,
          ) {}
        }
      `,
      "packages/app/src/deps.ts": `
        export class RepoImpl {}
        export class Helper {}
      `,
      "packages/app/src/bootstrap.ts": `
        import { Helper, RepoImpl } from "./deps";
        import { Service } from "./service";

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
      "runtime:@app/main::service::Service->@app/main::deps::RepoImpl",
    );
    expect(edges).toContain(
      "runtime:@app/main::service::Service->@app/main::deps::Helper",
    );
    expect(
      Array.from(edges).filter((edge) => edge.includes("Helper")).length,
    ).toBe(1);
  });

  test("buildDot renders fully qualified labels, orthogonal edges, and external cluster", () => {
    const rootDir = createWorkspace({
      "packages/app/package.json": packageJson("@app/main"),
      "packages/app/src/client.ts": `
        import type { Pool } from "pg";

        export class Client {
          public constructor(private readonly pool: Pool) {}
        }
      `,
      "packages/app/src/bootstrap.ts": `
        import { Client } from "./client";
        import { Pool } from "pg";

        const pool = new Pool();
        new Client(pool);
      `,
    });
    const graph = buildInjectionGraph(rootDir);
    const dot = buildDot(graph);

    expect(dot).toContain("splines=ortho");
    expect(dot).toContain('style="dashed"');
    expect(dot).toContain('cluster_external');
    expect(dot).toContain("@app/main::client::Client");
    expect(dot).toContain("pg::Pool");
  });

  test("resolves workspace package imports in the real repo", () => {
    const graph = buildInjectionGraph(process.cwd());
    const edges = edgeSet(graph, "declared");

    expect(
      graph.nodes.some(
        (node) =>
          node.fqName ===
          "@thoth/agents::conversations/application/conversations-service::ConversationsService",
      ),
    ).toBe(true);
    expect(edges).toContain(
      "declared:@thoth/agents::conversations/application/conversations-service::ConversationsService->@thoth/entities::ports::ConversationRepository",
    );
    expect(edges).toContain(
      "declared:@thoth/agents::conversations/application/conversations-service::ConversationsService->@thoth/entities::ports::BlobStore",
    );
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
