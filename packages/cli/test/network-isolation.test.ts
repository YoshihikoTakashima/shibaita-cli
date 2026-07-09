import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runInspect } from "../src/commands/inspect.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const FORBIDDEN_PATTERN = /\bfetch\s*\(|\bhttp\.|\bhttps\.|\bnet\.|child_process/;

async function listTsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTsFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("ネットワーク遮断: ソースコード走査", () => {
  it("core パッケージの全ソースに fetch/http/https/net/child_process が含まれない", async () => {
    const coreSrcDir = join(__dirname, "..", "..", "core", "src");
    const files = await listTsFiles(coreSrcDir);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const content = await readFile(file, "utf-8");
      expect(FORBIDDEN_PATTERN.test(content), `${file} にネットワーク関連コードが含まれています`).toBe(false);
    }
  });

  it("schema パッケージの全ソースに fetch/http/https/net/child_process が含まれない", async () => {
    const schemaSrcDir = join(__dirname, "..", "..", "schema", "src");
    const files = await listTsFiles(schemaSrcDir);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const content = await readFile(file, "utf-8");
      expect(FORBIDDEN_PATTERN.test(content), `${file} にネットワーク関連コードが含まれています`).toBe(false);
    }
  });

  it("cli パッケージ内で fetch を使用しているのは api.ts のみ", async () => {
    const cliSrcDir = join(__dirname, "..", "src");
    const files = await listTsFiles(cliSrcDir);
    const fetchUsers: string[] = [];

    for (const file of files) {
      const content = await readFile(file, "utf-8");
      if (/\bfetch\s*\(/.test(content)) {
        fetchUsers.push(file);
      }
    }

    expect(fetchUsers).toEqual([join(cliSrcDir, "api.ts")]);
  });

  it("cli パッケージ内で child_process を使用しているのは browser-open.ts のみ", async () => {
    const cliSrcDir = join(__dirname, "..", "src");
    const files = await listTsFiles(cliSrcDir);
    const childProcessUsers: string[] = [];

    for (const file of files) {
      const content = await readFile(file, "utf-8");
      if (/child_process/.test(content)) {
        childProcessUsers.push(file);
      }
    }

    expect(childProcessUsers).toEqual([join(cliSrcDir, "browser-open.ts")]);
  });
});

describe("ネットワーク遮断: inspectコマンドの実行パス", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("inspect 実行中に globalThis.fetch が呼ばれない", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // CLAUDE_CONFIG_DIR を存在しないディレクトリに向けてログ探索を空にする(実ログに依存しない)
    const originalEnv = process.env.CLAUDE_CONFIG_DIR;
    const originalHome = process.env.HOME;
    process.env.CLAUDE_CONFIG_DIR = join(__dirname, "fixtures", "no-such-dir");

    try {
      await runInspect(["--days", "30"]);
    } finally {
      process.env.CLAUDE_CONFIG_DIR = originalEnv;
      process.env.HOME = originalHome;
      logSpy.mockRestore();
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
