import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseLogContent, parseLogFiles } from "../src/adapters/claude-code/parse.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures");

async function loadFixture(name: string): Promise<string> {
  return readFile(join(fixturesDir, name), "utf-8");
}

describe("parseLogContent", () => {
  it("正常行を1件のUsageEntryとして抽出する", async () => {
    const content = await loadFixture("normal.jsonl");
    const { entries, skippedLines } = parseLogContent(content);

    expect(entries).toHaveLength(1);
    expect(skippedLines).toBe(0);

    const entry = entries[0]!;
    expect(entry.key).toBe("msg-normal-1:req-normal-1");
    expect(entry.model).toBe("claude-opus-4");
    expect(entry.inputTokens).toBe(100);
    expect(entry.outputTokens).toBe(50);
    expect(entry.cacheReadTokens).toBe(10);
    expect(entry.cacheCreationTokens).toBe(5);
    expect(entry.requestId).toBe("req-normal-1");
    expect(entry.timestamp.toISOString()).toBe("2026-06-01T10:00:00.000Z");
  });

  it("ストリーミング途中スナップショット(同一key3行)をフィールド別maxでマージする", async () => {
    const content = await loadFixture("streaming-duplicate.jsonl");
    const { entries } = parseLogContent(content);

    // dedupは呼び出し側(parseLogFiles相当)で行うため、ここでは3行そのまま出る
    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.key === "msg-stream-1:req-stream-1")).toBe(true);
  });

  it("<synthetic> モデルの行はスキップする", async () => {
    const content = await loadFixture("synthetic.jsonl");
    const { entries, skippedLines } = parseLogContent(content);

    expect(entries).toHaveLength(0);
    expect(skippedLines).toBe(1);
  });

  it("usage欠落のassistant行はスキップする", async () => {
    const content = await loadFixture("missing-usage.jsonl");
    const { entries, skippedLines } = parseLogContent(content);

    expect(entries).toHaveLength(0);
    expect(skippedLines).toBe(1);
  });

  it("壊れたJSON行はスキップし、以降の正常行は処理を続ける", async () => {
    const content = await loadFixture("broken-json.jsonl");
    const { entries, skippedLines } = parseLogContent(content);

    expect(skippedLines).toBe(1);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.key).toBe("msg-broken-2:req-broken-2");
  });

  it("isSidechain: true の行も通常どおり計上する", async () => {
    const content = await loadFixture("sidechain.jsonl");
    const { entries, skippedLines } = parseLogContent(content);

    expect(entries).toHaveLength(1);
    expect(skippedLines).toBe(0);
    expect(entries[0]!.model).toBe("claude-haiku-4");
  });

  it("requestId欠落時はmessage.idのみをkeyとして採用する", async () => {
    const content = await loadFixture("missing-requestid.jsonl");
    const { entries, skippedLines } = parseLogContent(content);

    expect(entries).toHaveLength(1);
    expect(skippedLines).toBe(0);
    expect(entries[0]!.key).toBe("msg-missing-reqid-1");
    expect(entries[0]!.requestId).toBeUndefined();
  });
});

describe("parseLogFiles (dedup)", () => {
  it("同一keyの複数行(ストリーミング)をフィールドごとにmaxマージし、timestampは最初に見たものを保持する", async () => {
    const filePath = join(fixturesDir, "streaming-duplicate.jsonl");
    const { entries, skippedLines } = await parseLogFiles([filePath]);

    expect(skippedLines).toBe(0);
    expect(entries).toHaveLength(1);

    const merged = entries[0]!;
    expect(merged.inputTokens).toBe(10);
    expect(merged.outputTokens).toBe(42); // max(5, 30, 42)
    expect(merged.cacheReadTokens).toBe(2); // max(0, 2, 2)
    expect(merged.cacheCreationTokens).toBe(1); // max(0, 0, 1)
    expect(merged.timestamp.toISOString()).toBe("2026-06-02T09:00:00.000Z"); // 最初に見たもの
  });

  it("複数ファイル横断でdedupする(同一メッセージが2ファイルに存在しても1回のみ計上)", async () => {
    const filePath = join(fixturesDir, "normal.jsonl");
    const { entries } = await parseLogFiles([filePath, filePath]);

    expect(entries).toHaveLength(1);
  });
});
