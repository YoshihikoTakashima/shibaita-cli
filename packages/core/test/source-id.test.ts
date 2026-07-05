import { chmod, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { platform } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getOrCreateSourceId, getPrimaryLogRoot, type SourceIdFallback } from "../src/source-id.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCE_ID_FILENAME = ".shibaita-source-id";

function createMemoryFallback(initial?: string): SourceIdFallback & { value: string | undefined } {
  const state = { value: initial };
  return {
    get value() {
      return state.value;
    },
    async read() {
      return state.value;
    },
    async write(sourceId: string) {
      state.value = sourceId;
    },
  };
}

describe("getPrimaryLogRoot", () => {
  it("CLAUDE_CONFIG_DIRが設定されていればその先頭ディレクトリを返す", () => {
    const root = getPrimaryLogRoot({ CLAUDE_CONFIG_DIR: "/foo/dir1,/bar/dir2" } as NodeJS.ProcessEnv);
    expect(root).toBe("/foo/dir1");
  });

  it("CLAUDE_CONFIG_DIRが空文字なら~/.claudeを返す", () => {
    const root = getPrimaryLogRoot({ CLAUDE_CONFIG_DIR: "", HOME: "/home/user" } as NodeJS.ProcessEnv);
    expect(root.endsWith(".claude")).toBe(true);
  });

  it("CLAUDE_CONFIG_DIRが未設定なら~/.claudeを返す", () => {
    const root = getPrimaryLogRoot({} as NodeJS.ProcessEnv);
    expect(root.endsWith(".claude")).toBe(true);
  });
});

describe("getOrCreateSourceId", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "shibaita-source-id-"));
  });

  afterEach(async () => {
    // chmodで書き込み不可にしたディレクトリのテストがある場合に備え、削除前に権限を戻す
    await chmod(tempDir, 0o700).catch(() => {});
    await rm(tempDir, { recursive: true, force: true });
  });

  it("ファイルが存在しない場合は新規UUIDを生成しファイルに書き込む", async () => {
    const fallback = createMemoryFallback();
    const sourceId = await getOrCreateSourceId(tempDir, fallback);

    expect(sourceId).toMatch(UUID_PATTERN);

    const filePath = join(tempDir, SOURCE_ID_FILENAME);
    const content = await readFile(filePath, "utf-8");
    expect(content.trim()).toBe(sourceId);
    // fallbackは使われない
    expect(fallback.value).toBeUndefined();
  });

  it("既存ファイルがあればその内容を再利用する(再実行しても同じID)", async () => {
    const fallback = createMemoryFallback();
    const first = await getOrCreateSourceId(tempDir, fallback);
    const second = await getOrCreateSourceId(tempDir, fallback);

    expect(second).toBe(first);
  });

  it("ファイル作成時のパーミッションは0600(所有者のみ読み書き可)", async () => {
    if (platform() === "win32") return; // Windowsはpermission bit概念が異なるためスキップ

    const fallback = createMemoryFallback();
    await getOrCreateSourceId(tempDir, fallback);

    const filePath = join(tempDir, SOURCE_ID_FILENAME);
    const stat = await import("node:fs/promises").then((fs) => fs.stat(filePath));
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("ログルートへの書き込みが失敗する場合はフォールバックへ新規生成する", async () => {
    // ディレクトリ自体を存在しないパスにして読み書きを常に失敗させる
    const missingRoot = join(tempDir, "does-not-exist", "nested");
    const fallback = createMemoryFallback();

    const sourceId = await getOrCreateSourceId(missingRoot, fallback);

    expect(sourceId).toMatch(UUID_PATTERN);
    expect(fallback.value).toBe(sourceId);
  });

  it("フォールバックに既存IDがあればそれを再利用する", async () => {
    const missingRoot = join(tempDir, "does-not-exist", "nested");
    const existingId = "11111111-1111-4111-8111-111111111111";
    const fallback = createMemoryFallback(existingId);

    const sourceId = await getOrCreateSourceId(missingRoot, fallback);

    expect(sourceId).toBe(existingId);
  });

  it("ディレクトリが読み書き不可な場合もフォールバックへ新規生成する", async () => {
    if (platform() === "win32") return; // Windowsはchmodの意味が異なるためスキップ
    if (process.getuid && process.getuid() === 0) return; // rootは権限チェックを無視するためスキップ

    await mkdir(join(tempDir, "readonly-root"));
    const readonlyRoot = join(tempDir, "readonly-root");
    await chmod(readonlyRoot, 0o500); // 書き込み不可

    const fallback = createMemoryFallback();
    const sourceId = await getOrCreateSourceId(readonlyRoot, fallback);

    expect(sourceId).toMatch(UUID_PATTERN);
    expect(fallback.value).toBe(sourceId);

    await chmod(readonlyRoot, 0o700); // クリーンアップ用に権限を戻す
  });
});
