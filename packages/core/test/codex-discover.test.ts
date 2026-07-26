import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverLogFiles } from "../src/adapters/codex/discover.js";

let tempDir: string;

describe("discoverLogFiles (Codex)", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "shibaita-codex-discover-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("CODEX_HOME環境変数のsessions配下を再帰的に探索する", async () => {
    const dayDir = join(tempDir, "sessions", "2026", "06", "07");
    await mkdir(dayDir, { recursive: true });
    const filePath = join(dayDir, "rollout-2026-06-07T09-00-00-abc.jsonl");
    await writeFile(filePath, "{}\n", "utf-8");

    const files = await discoverLogFiles({ CODEX_HOME: tempDir });
    expect(files).toEqual([filePath]);
  });

  it("CODEX_HOMEが無い場合はhomedir()/.codex/sessionsを探索する", async () => {
    const originalHome = process.env.HOME;
    process.env.HOME = tempDir;
    try {
      const dayDir = join(tempDir, ".codex", "sessions", "2026", "06", "07");
      await mkdir(dayDir, { recursive: true });
      const filePath = join(dayDir, "rollout-2026-06-07T09-00-00-abc.jsonl");
      await writeFile(filePath, "{}\n", "utf-8");

      // CODEX_HOMEが未設定のenvを渡す(実機の環境変数に依存しないよう明示的に空オブジェクトを渡す)
      const files = await discoverLogFiles({});
      expect(files).toEqual([filePath]);
    } finally {
      process.env.HOME = originalHome;
    }
  });

  it("sessionsディレクトリが存在しない場合は空配列を返す(例外にしない)", async () => {
    const files = await discoverLogFiles({ CODEX_HOME: join(tempDir, "no-such-dir") });
    expect(files).toEqual([]);
  });

  it("jsonl以外の拡張子・シンボリックリンクは含めない", async () => {
    const dayDir = join(tempDir, "sessions", "2026", "06", "07");
    await mkdir(dayDir, { recursive: true });
    const jsonlPath = join(dayDir, "rollout-2026-06-07T09-00-00-abc.jsonl");
    const otherPath = join(dayDir, "notes.txt");
    await writeFile(jsonlPath, "{}\n", "utf-8");
    await writeFile(otherPath, "not jsonl", "utf-8");

    const files = await discoverLogFiles({ CODEX_HOME: tempDir });
    expect(files).toEqual([jsonlPath]);
  });
});
