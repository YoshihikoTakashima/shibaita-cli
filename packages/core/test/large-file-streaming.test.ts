import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isLargeFile } from "../src/adapters/common/large-file.js";
import {
  parseLogContent as parseClaudeCodeContent,
  parseLogFile as parseClaudeCodeFile,
  parseLogFiles as parseClaudeCodeFiles,
} from "../src/adapters/claude-code/parse.js";
import {
  parseCodexSessionContent,
  parseLogFile as parseCodexFile,
  parseLogFiles as parseCodexFiles,
} from "../src/adapters/codex/parse.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const claudeFixturesDir = join(__dirname, "fixtures");
const codexFixturesDir = join(__dirname, "fixtures", "codex");

/**
 * 実際に512MB超のファイルをテストで作るのは非現実的なため(CI/開発機に負荷をかける)、
 * `largeFileThresholdBytes` をテストから小さい値(例: 1バイト)に注入することで
 * どんなサイズの通常フィクスチャでも「巨大ファイル」経路(行ストリーム読み)を
 * 強制的に通過させ、通常経路(一括readFile)と同じ結果になることを検証する。
 *
 * 背景: `readFile(path, "utf-8")` は環境依存のNode/V8文字列長上限(64bit環境で目安約512MB)を
 * 超えるファイルに対して `RangeError: Invalid string length` を投げる
 * (実機Node v24.12.0、600MBのファイルで確認済み)。Claude Code/Codexのセッションログは
 * ローテーションされず肥大化することがあるため、この上限超えは実際に起こりうる。
 */

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "shibaita-large-file-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("isLargeFile", () => {
  it("既定閾値以下のファイルはfalse", async () => {
    const filePath = join(tempDir, "small.jsonl");
    await writeFile(filePath, "hello\n", "utf-8");
    expect(await isLargeFile(filePath)).toBe(false);
  });

  it("注入した閾値を超えるファイルはtrue", async () => {
    const filePath = join(tempDir, "small.jsonl");
    await writeFile(filePath, "hello\n", "utf-8");
    expect(await isLargeFile(filePath, { largeFileThresholdBytes: 3 })).toBe(true);
  });

  it("注入した閾値以下ならfalse", async () => {
    const filePath = join(tempDir, "small.jsonl");
    await writeFile(filePath, "hello\n", "utf-8");
    expect(await isLargeFile(filePath, { largeFileThresholdBytes: 1024 })).toBe(false);
  });

  it("存在しないファイルはfalse(通常経路へのフォールバック)", async () => {
    expect(await isLargeFile(join(tempDir, "does-not-exist.jsonl"))).toBe(false);
  });
});

describe("Claude Codeアダプタ: 閾値超え時の行ストリーム読み経路", () => {
  it("通常経路(一括readFile)とストリーム経路で同じ結果になる(normal.jsonl)", async () => {
    const filePath = join(claudeFixturesDir, "normal.jsonl");

    const normalResult = await parseClaudeCodeFile(filePath);
    const streamedResult = await parseClaudeCodeFile(filePath, { largeFileThresholdBytes: 0 });

    expect(streamedResult.skippedLines).toBe(normalResult.skippedLines);
    expect(streamedResult.entries).toEqual(normalResult.entries);
    expect(streamedResult.rateLimitHits).toEqual(normalResult.rateLimitHits);
  });

  it("ストリーム経路でも同一key複数行のフィールド別maxマージが変わらない(streaming-duplicate.jsonl)", async () => {
    const filePath = join(claudeFixturesDir, "streaming-duplicate.jsonl");

    const { entries } = await parseClaudeCodeFiles([filePath], { largeFileThresholdBytes: 0 });

    expect(entries).toHaveLength(1);
    const merged = entries[0]!;
    expect(merged.inputTokens).toBe(10);
    expect(merged.outputTokens).toBe(42);
    expect(merged.cacheReadTokens).toBe(2);
    expect(merged.cacheCreationTokens).toBe(1);
  });

  it("ストリーム経路でも壊れたJSON行はスキップし、以降の正常行を処理する(broken-json.jsonl)", async () => {
    const filePath = join(claudeFixturesDir, "broken-json.jsonl");

    const { entries, skippedLines } = await parseClaudeCodeFile(filePath, { largeFileThresholdBytes: 0 });

    expect(skippedLines).toBe(1);
    expect(entries).toHaveLength(1);
  });

  it("大量行(数万行)のファイルでもストリーム経路がクラッシュせず全件処理する", async () => {
    const lineCount = 20_000;
    const lines: string[] = [];
    for (let i = 0; i < lineCount; i++) {
      lines.push(
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-07-01T00:00:00.000Z",
          requestId: `req-${i}`,
          message: {
            id: `msg-${i}`,
            model: "claude-opus-4",
            usage: {
              input_tokens: 1,
              output_tokens: 1,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
          },
        }),
      );
    }
    const filePath = join(tempDir, "big.jsonl");
    await writeFile(filePath, `${lines.join("\n")}\n`, "utf-8");

    // largeFileThresholdBytes: 0 でストリーム経路を強制する(実ファイルは数MB程度で512MBには遠く及ばないが、
    // 「閾値を超えたら必ずストリーム経路を通る」という分岐そのものをこのサイズで検証する)。
    const streamed = await parseClaudeCodeFile(filePath, { largeFileThresholdBytes: 0 });
    expect(streamed.entries).toHaveLength(lineCount);
    expect(streamed.skippedLines).toBe(0);

    const content = lines.join("\n") + "\n";
    const normal = parseClaudeCodeContent(content);
    expect(streamed.entries).toEqual(normal.entries);
  });

  it("1行が異常に長い(maxLineBytes超)場合はその行だけスキップし、他の行は処理を続ける", async () => {
    const hugeModelName = "x".repeat(5000);
    const oversizedLine = JSON.stringify({
      type: "assistant",
      timestamp: "2026-07-01T00:00:00.000Z",
      requestId: "req-huge",
      message: {
        id: "msg-huge",
        model: hugeModelName,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });
    const normalLine = JSON.stringify({
      type: "assistant",
      timestamp: "2026-07-01T00:00:01.000Z",
      requestId: "req-ok",
      message: {
        id: "msg-ok",
        model: "claude-opus-4",
        usage: { input_tokens: 10, output_tokens: 20 },
      },
    });
    const filePath = join(tempDir, "with-oversized-line.jsonl");
    await writeFile(filePath, `${oversizedLine}\n${normalLine}\n`, "utf-8");

    // largeFileThresholdBytes:0でストリーム経路を強制し、maxLineBytesを小さく(300バイト)
    // 注入することで「oversizedLineだけがmaxLineBytesを超える行」という状況を小さなフィクスチャで
    // 再現する(normalLineは177バイト程度なので300バイトの閾値には収まる)。
    const result = await parseClaudeCodeFile(filePath, {
      largeFileThresholdBytes: 0,
      maxLineBytes: 300,
    });

    // 巨大行はスキップされ(skippedLinesに計上)、正常行だけがentriesに残る
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.key).toBe("msg-ok:req-ok");
    expect(result.skippedLines).toBe(1);
  });
});

describe("Codexアダプタ: 閾値超え時の行ストリーム読み経路", () => {
  it("通常経路とストリーム経路で同じ結果になる(session-basic.jsonl、累積スナップショットの最後の1件採用)", async () => {
    const filePath = join(codexFixturesDir, "session-basic.jsonl");

    const normalResult = await parseCodexFile(filePath);
    const streamedResult = await parseCodexFile(filePath, { largeFileThresholdBytes: 0 });

    expect(streamedResult).toEqual(normalResult);
    expect(streamedResult.entries).toHaveLength(1);
    expect(streamedResult.entries[0]!.inputTokens).toBe(4200);
  });

  it("ストリーム経路でもモデル切り替えセッションで直近モデルを採用する(session-model-switch.jsonl)", async () => {
    const filePath = join(codexFixturesDir, "session-model-switch.jsonl");

    const { entries } = await parseCodexFile(filePath, { largeFileThresholdBytes: 0 });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.model).toBe("model-b");
    expect(entries[0]!.inputTokens).toBe(250);
  });

  it("ストリーム経路でも同一ファイル2回渡しで二重計上しない(累積セッション値のため重要)", async () => {
    const filePath = join(codexFixturesDir, "session-basic.jsonl");

    const { entries } = await parseCodexFiles([filePath, filePath], { largeFileThresholdBytes: 0 });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.inputTokens).toBe(4200);
  });

  it("大量のtoken_countスナップショット行があっても最後の1件だけを採用する(ストリーム経路)", async () => {
    const lines: string[] = [
      '{"type":"session_meta","timestamp":"2026-07-01T00:00:00.000Z","payload":{"session_id":"sess-big-1"}}',
      '{"type":"turn_context","payload":{"model":"gpt-5.5"}}',
    ];
    const snapshotCount = 5_000;
    for (let i = 1; i <= snapshotCount; i++) {
      lines.push(
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: i,
                cached_input_tokens: 0,
                output_tokens: i,
                reasoning_output_tokens: 0,
                total_tokens: i * 2,
              },
            },
          },
        }),
      );
    }
    const filePath = join(tempDir, "big-session.jsonl");
    await writeFile(filePath, `${lines.join("\n")}\n`, "utf-8");

    const streamed = await parseCodexFile(filePath, { largeFileThresholdBytes: 0 });
    expect(streamed.entries).toHaveLength(1);
    // 最後(最大)のスナップショットのみ採用: input_tokens = snapshotCount
    expect(streamed.entries[0]!.inputTokens).toBe(snapshotCount);
    expect(streamed.entries[0]!.outputTokens).toBe(snapshotCount);

    const content = `${lines.join("\n")}\n`;
    const normal = parseCodexSessionContent(content, filePath);
    expect(streamed.entries).toEqual(normal.entries);
  });

  it("1行が異常に長い(maxLineBytes超)snapshot行はスキップし、それより前の正常なsnapshotを採用する", async () => {
    const hugeReasoning = "z".repeat(5000);
    const lines = [
      '{"type":"session_meta","timestamp":"2026-07-01T00:00:00.000Z","payload":{"session_id":"sess-oversized-1"}}',
      '{"type":"turn_context","payload":{"model":"gpt-5.5"}}',
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 100,
              cached_input_tokens: 0,
              output_tokens: 50,
              reasoning_output_tokens: 0,
              total_tokens: 150,
            },
          },
        },
      }),
      // 巨大な1行(閾値超): この行自体は壊れたJSONではないが行長ガードでスキップされる想定
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 999,
              cached_input_tokens: 0,
              output_tokens: 999,
              reasoning_output_tokens: 0,
              total_tokens: 1998,
              // 巨大なpaddingフィールドで1行を膨らませる(実データには無いが行長超のシミュレーション用)
              _padding: hugeReasoning,
            },
          },
        },
      }),
    ];
    const filePath = join(tempDir, "codex-oversized-line.jsonl");
    await writeFile(filePath, `${lines.join("\n")}\n`, "utf-8");

    const result = await parseCodexFile(filePath, {
      largeFileThresholdBytes: 0,
      maxLineBytes: 200,
    });

    expect(result.entries).toHaveLength(1);
    // 巨大行(input_tokens=999)はスキップされ、その手前の正常snapshot(input_tokens=100)が採用される
    expect(result.entries[0]!.inputTokens).toBe(100);
    expect(result.entries[0]!.outputTokens).toBe(50);
    expect(result.skippedLines).toBe(1);
  });
});
