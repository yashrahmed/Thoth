import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { resolveConfigFilePath } from "./index";

describe("resolveConfigFilePath", () => {
  test("returns an absolute path unchanged", () => {
    const absolutePath = "/tmp/thoth-config.yaml";

    expect(resolveConfigFilePath(absolutePath, "/tmp")).toBe(absolutePath);
  });

  test("finds a relative config path in a parent directory", () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), "thoth-config-"));
    const nestedDirectory = join(rootDirectory, "packages", "conv-agent");
    const configPath = join(rootDirectory, "config", "launch.yaml");

    mkdirSync(join(rootDirectory, "config"), { recursive: true });
    mkdirSync(nestedDirectory, { recursive: true });
    writeFileSync(configPath, "proxy:\n  port: 3000\n");

    try {
      expect(resolveConfigFilePath("config/launch.yaml", nestedDirectory)).toBe(configPath);
    } finally {
      rmSync(rootDirectory, { force: true, recursive: true });
    }
  });
});
