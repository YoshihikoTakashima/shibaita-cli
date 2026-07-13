import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCodexSessionContent, parseLogFiles } from "../src/adapters/codex/parse.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures", "codex");

async function loadFixture(name: string): Promise<string> {
  return readFile(join(fixturesDir, name), "utf-8");
}

/**
 * Codexアダプタのパーサテスト。
 * フィクスチャは実端末の ~/.codex/sessions/**\/rollout-*.jsonl を実地調査した実フォーマットに
 * 基づく(session_meta / turn_context / event_msg(token_count) の構造、total_token_usageが
 * セッション累積であること、rate_limits.rate_limit_reached_type が常にnullであったこと等)。
 */
describe("parseCodexSessionContent", () => {
  it("複数のtoken_countイベント(累積)から最終(最大)スナップショットのみを1件のUsageEntryとして採用する", async () => {
    const content = await loadFixture("session-basic.jsonl");
    const { entries, skippedLines, rateLimitHits } = parseCodexSessionContent(
      content,
      "session-basic.jsonl",
    );

    expect(skippedLines).toBe(0);
    expect(entries).toHaveLength(1);
    // レート制限ヒットは実ログで判別不能だったため常に0件(誤検出より無検出の方針)
    expect(rateLimitHits).toHaveLength(0);

    const entry = entries[0]!;
    expect(entry.key).toBe("sess-codex-basic-1:gpt-5.5");
    expect(entry.provider).toBe("openai");
    expect(entry.product).toBe("codex");
    expect(entry.model).toBe("gpt-5.5");
    // 最終スナップショット(input=5000, cached=800): inputTokens = input - cached
    expect(entry.inputTokens).toBe(4200);
    expect(entry.cacheReadTokens).toBe(800);
    expect(entry.outputTokens).toBe(600);
    expect(entry.cacheCreationTokens).toBe(0);
    // input+cacheRead+outputの総和がtotal_tokens(5600)と一致する(整合性チェック)
    expect(entry.inputTokens + entry.cacheReadTokens + entry.outputTokens).toBe(5600);
    // 日付はセッション開始(最初の行のtimestamp)基準
    expect(entry.timestamp.toISOString()).toBe("2026-06-01T00:10:00.000Z");
  });

  it("セッション中にモデルが切り替わった場合、採用したtoken_countスナップショット時点の直近モデルを使う", async () => {
    const content = await loadFixture("session-model-switch.jsonl");
    const { entries } = parseCodexSessionContent(content, "session-model-switch.jsonl");

    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.model).toBe("model-b");
    expect(entry.key).toBe("sess-codex-switch-1:model-b");
    expect(entry.inputTokens).toBe(250); // 300 - 50
    expect(entry.cacheReadTokens).toBe(50);
    expect(entry.outputTokens).toBe(40);
  });

  it("モデル名が一度も見つからない場合はunknownにフォールバックする", async () => {
    const content = await loadFixture("session-no-model.jsonl");
    const { entries } = parseCodexSessionContent(content, "session-no-model.jsonl");

    expect(entries).toHaveLength(1);
    expect(entries[0]!.model).toBe("unknown");
    expect(entries[0]!.key).toBe("sess-codex-nomodel-1:unknown");
  });

  it("壊れたJSON行はスキップし、以降の正常行は処理を続ける", async () => {
    const content = await loadFixture("session-broken-json.jsonl");
    const { entries, skippedLines } = parseCodexSessionContent(content, "session-broken-json.jsonl");

    expect(skippedLines).toBe(1);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.model).toBe("gpt-5.5");
  });

  it("token_countイベントが1件も無いセッションは集計対象0件になる", async () => {
    const content = await loadFixture("session-no-usage.jsonl");
    const { entries } = parseCodexSessionContent(content, "session-no-usage.jsonl");

    expect(entries).toHaveLength(0);
  });

  it("timestamp行が無い場合はファイル名(ローカル壁時計表記)からセッション開始日時を復元する", () => {
    const content = [
      '{"type":"session_meta","payload":{"session_id":"sess-no-ts-1"}}',
      '{"type":"turn_context","payload":{"model":"gpt-5.5"}}',
      '{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":5,"reasoning_output_tokens":0,"total_tokens":15}}}}',
    ].join("\n");

    const { entries } = parseCodexSessionContent(
      content,
      "/fake/sessions/2026/06/07/rollout-2026-06-07T09-30-00-abc123.jsonl",
    );

    expect(entries).toHaveLength(1);
    // ファイル名の時刻はローカル壁時計表記のためそのままローカルDateとして復元される
    const ts = entries[0]!.timestamp;
    expect(ts.getFullYear()).toBe(2026);
    expect(ts.getMonth()).toBe(5); // 0-indexed: 6月
    expect(ts.getDate()).toBe(7);
    expect(ts.getHours()).toBe(9);
    expect(ts.getMinutes()).toBe(30);
  });
});

describe("parseLogFiles (Codex, 複数ファイル横断)", () => {
  it("複数セッションファイルをそれぞれ1件ずつのエントリとして集約する", async () => {
    const basicPath = join(fixturesDir, "session-basic.jsonl");
    const switchPath = join(fixturesDir, "session-model-switch.jsonl");

    const { entries, skippedLines } = await parseLogFiles([basicPath, switchPath]);

    expect(skippedLines).toBe(0);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.model).sort()).toEqual(["gpt-5.5", "model-b"]);
    expect(entries.every((e) => e.provider === "openai" && e.product === "codex")).toBe(true);
  });

  it("同一ファイルを2回渡しても二重計上しない(累積セッション値のため重要)", async () => {
    const basicPath = join(fixturesDir, "session-basic.jsonl");
    const { entries } = await parseLogFiles([basicPath, basicPath]);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.inputTokens).toBe(4200);
  });

  it("レート制限ヒットは常に空配列(検出未実装)", async () => {
    const basicPath = join(fixturesDir, "session-basic.jsonl");
    const { rateLimitHits } = await parseLogFiles([basicPath]);
    expect(rateLimitHits).toEqual([]);
  });
});
