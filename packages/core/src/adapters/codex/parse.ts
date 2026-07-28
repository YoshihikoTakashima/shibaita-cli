import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { mergeEntry } from "../../merge.js";
import type { ParseResult, RateLimitHit, UsageEntry } from "../../types.js";
import { isLargeFile } from "../common/large-file.js";
import type { LargeFileCheckOptions } from "../common/large-file.js";
import { readJsonlLines } from "../common/jsonl-lines.js";
import type { JsonlLineReadOptions } from "../common/jsonl-lines.js";

/** 巨大ファイル判定(ファイル全体サイズ)と行ストリーム読み(1行の最大長)、両方のテスト注入オプション */
export type ParseFileOptions = LargeFileCheckOptions & JsonlLineReadOptions;

const PROVIDER = "openai";
const PRODUCT = "codex";

interface RawTokenUsage {
  input_tokens?: unknown;
  cached_input_tokens?: unknown;
  output_tokens?: unknown;
  reasoning_output_tokens?: unknown;
  total_tokens?: unknown;
}

interface RawPayload {
  type?: unknown;
  model?: unknown;
  session_id?: unknown;
  id?: unknown;
  info?: unknown;
}

interface RawLine {
  type?: unknown;
  timestamp?: unknown;
  payload?: unknown;
}

/** 数値でない・負値は0にする */
function toNonNegativeNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

/**
 * ファイル名(`rollout-YYYY-MM-DDTHH-MM-SS-<uuid>.jsonl`、実ログで確認済みの形式)から
 * ローカル壁時計のDateを復元する(最初のtimestamp行が無い場合のフォールバック用)。
 * ファイル名中の時刻は既にローカル時刻表記のため、Dateのローカルコンストラクタでそのまま組み立てる
 * (UTCとして解釈し直すTZ変換をしない)。
 */
function parseTimestampFromFilename(filePath: string): Date | null {
  const name = basename(filePath);
  const m = name.match(/^rollout-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m as unknown as [string, string, string, string, string, string, string];
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * parseCodexSessionContent/parseCodexSessionFileStreaming が共有する、
 * 1セッション分のJSONLを先頭から1行ずつ畳み込む(fold)ための可変状態。
 * 「累積スナップショットのうち最後(=最大)の1件だけを採用する」というアルゴリズムは
 * 本質的に単一パスの畳み込みであり、ファイル全体をメモリに保持する必要が無いため、
 * 文字列一括読み込み経路・行ストリーム読み経路の両方から同じ状態機械を再利用できる。
 */
interface CodexFoldState {
  skippedLines: number;
  sessionIdentifier: string | undefined;
  firstTimestamp: Date | undefined;
  currentModel: string | undefined;
  bestTotal: RawTokenUsage | undefined;
  bestModel: string | undefined;
}

function createCodexFoldState(): CodexFoldState {
  return {
    skippedLines: 0,
    sessionIdentifier: undefined,
    firstTimestamp: undefined,
    currentModel: undefined,
    bestTotal: undefined,
    bestModel: undefined,
  };
}

/** 1行分(トリム済み・空行ではない)を畳み込み状態に反映する。 */
function ingestCodexLine(state: CodexFoldState, trimmed: string): void {
  let raw: RawLine;
  try {
    raw = JSON.parse(trimmed) as RawLine;
  } catch {
    state.skippedLines += 1;
    return;
  }

  if (state.firstTimestamp === undefined && typeof raw.timestamp === "string") {
    const ts = new Date(raw.timestamp);
    if (!Number.isNaN(ts.getTime())) state.firstTimestamp = ts;
  }

  const payload = raw.payload as RawPayload | undefined;
  if (!payload || typeof payload !== "object") return;

  if (raw.type === "session_meta" && state.sessionIdentifier === undefined) {
    if (typeof payload.session_id === "string") {
      state.sessionIdentifier = payload.session_id;
    } else if (typeof payload.id === "string") {
      state.sessionIdentifier = payload.id;
    }
  }

  if (typeof payload.model === "string") {
    state.currentModel = payload.model;
  }

  if (raw.type === "event_msg" && payload.type === "token_count") {
    const info = payload.info as { total_token_usage?: unknown } | undefined;
    const totalUsage = info?.total_token_usage;
    if (totalUsage && typeof totalUsage === "object") {
      state.bestTotal = totalUsage as RawTokenUsage;
      state.bestModel = state.currentModel;
    }
  }
}

/** 畳み込み状態から最終的な ParseResult を組み立てる。 */
function finalizeCodexFoldState(state: CodexFoldState, filePath: string): ParseResult {
  // レート制限ヒット検出について:
  // 実端末の ~/.codex/sessions (426セッション分)を全数調査したが、token_count イベントの
  // payload.rate_limits.rate_limit_reached_type は常に null であり、「実際に制限に当たった」
  // ケースのサンプルが1件も観測できなかった。非null時にどのような値(文字列/配列/オブジェクト等)
  // が入るかを実ログで検証できないため、誤検出のリスクを避けて検出処理は実装せず、常に0件を返す
  // (方針: 誤検出より無検出)。将来、実際に制限に当たったログが確認できた時点で実装を追加する。
  const rateLimitHits: RateLimitHit[] = [];

  if (!state.bestTotal) {
    return { entries: [], skippedLines: state.skippedLines, rateLimitHits };
  }

  const timestamp = state.firstTimestamp ?? parseTimestampFromFilename(filePath) ?? undefined;
  if (!timestamp) {
    // 日付が全く復元できない場合は集計対象にできない
    return { entries: [], skippedLines: state.skippedLines, rateLimitHits };
  }

  const model = state.bestModel ?? "unknown";
  const identifier = state.sessionIdentifier ?? basename(filePath);

  const inputTokensRaw = toNonNegativeNumber(state.bestTotal.input_tokens);
  const cachedTokens = toNonNegativeNumber(state.bestTotal.cached_input_tokens);
  const inputTokens = Math.max(0, inputTokensRaw - cachedTokens);

  const entry: UsageEntry = {
    key: `${identifier}:${model}`,
    provider: PROVIDER,
    product: PRODUCT,
    model,
    timestamp,
    inputTokens,
    outputTokens: toNonNegativeNumber(state.bestTotal.output_tokens),
    cacheReadTokens: cachedTokens,
    cacheCreationTokens: 0,
  };

  return { entries: [entry], skippedLines: state.skippedLines, rateLimitHits };
}

/**
 * Codex CLI の1セッション分のJSONLを解析し、セッション累積の最終usageスナップショットを
 * 1件のUsageEntryとして返す(1ファイル = 1エントリ。実ログ調査(実端末の ~/.codex/sessions、
 * 426セッション分)により以下を確認済み:
 *
 * - `event_msg` かつ `payload.type === "token_count"` の行の `payload.info.total_token_usage` は
 *   セッション開始からの累積値であり、単調非減少(監視した全セッションで確認)。
 *   複数行をそのまま合算すると二重計上になるため、最後(=最大)の1件だけを採用する。
 * - モデル名は `turn_context.payload.model` (例: "gpt-5.5")。セッション中にモデルが
 *   切り替わった場合、累積usageはモデル別に分離できないため、採用したtoken_countスナップショット
 *   時点で直近に観測されていたモデルに寄せる。モデルが一度も見つからない場合は "unknown"。
 * - 日付はセッション開始基準(最初の行のtop-level timestamp。無ければファイル名)のローカルTZ日付。
 *   token_countイベント自体の(累積後の)timestampではない。
 *
 * dedupキー = セッションファイル識別子(session_id、無ければファイル名、それも無ければ絶対パス)
 * + ":" + model。呼び出し側(parseLogFiles)で複数ファイル横断のmax mergeに使う
 * (通常は1ファイル1エントリのため実質no-opだが、念のため共通のmergeEntryを再利用する)。
 */
export function parseCodexSessionContent(content: string, filePath: string): ParseResult {
  const state = createCodexFoldState();

  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    ingestCodexLine(state, trimmed);
  }

  return finalizeCodexFoldState(state, filePath);
}

/**
 * ファイル全体を1文字列で読み込まず、行ストリーム(共有の readJsonlLines)で処理する。
 * 巨大ファイル(目安256MB超。実際にCodexの累積セッションログで1.0GB/588MB/577MBの
 * 報告あり)で `readFile(path, "utf-8")` が `RangeError: Invalid string length` を
 * 投げるのを避けるための経路。「累積スナップショットの最後の1件だけを採用する」という
 * 畳み込みは前から1回なめれば良いアルゴリズムのため、ファイル全体をメモリに保持しなくても
 * 既存ロジックと完全に同じ結果になる(先頭からの単一パスで、保持する状態は
 * CodexFoldStateの小さな値のみ)。
 * さらに、1行自体が異常に長い(例: 数百MB)場合に備え、readJsonlLines側で行長上限
 * (既定64MB)を超える行は本文を保持せず破棄する(skippedLinesに計上する)。
 */
async function parseCodexSessionFileStreaming(
  filePath: string,
  options: JsonlLineReadOptions,
): Promise<ParseResult> {
  const state = createCodexFoldState();

  for await (const event of readJsonlLines(filePath, options)) {
    if (event.kind === "oversized") {
      state.skippedLines += 1;
      continue;
    }

    const trimmed = event.line.trim();
    if (trimmed.length === 0) continue;
    ingestCodexLine(state, trimmed);
  }

  return finalizeCodexFoldState(state, filePath);
}

/**
 * 単一ファイルをパースする。
 *
 * ファイルサイズが閾値(既定256MB、`options.largeFileThresholdBytes`で注入可能)を超える場合は
 * 行ストリーム読みに切り替え、`readFile(path, "utf-8")` の一括読み込みによる
 * `RangeError: Invalid string length` を回避する。閾値以下の通常サイズのファイルは
 * 従来通り一括読み込みのままにし、挙動・パフォーマンスへの影響を最小化する。
 */
export async function parseLogFile(
  filePath: string,
  options: ParseFileOptions = {},
): Promise<ParseResult> {
  if (await isLargeFile(filePath, options)) {
    return parseCodexSessionFileStreaming(filePath, options);
  }

  const content = await readFile(filePath, "utf-8");
  return parseCodexSessionContent(content, filePath);
}

/**
 * 複数ファイルをパースし、全ファイル横断でdedupする。
 * 通常は1ファイル1エントリ(セッション単位)のため実質no-opだが、共通のmergeEntryを再利用して
 * 万一のkey衝突(同一identifier+modelの重複)にも安全なフィールド別maxマージを適用する。
 */
export async function parseLogFiles(
  filePaths: string[],
  options: ParseFileOptions = {},
): Promise<ParseResult> {
  const merged = new Map<string, UsageEntry>();
  let skippedLines = 0;
  // レート制限ヒットは常に空(検出未実装。parseCodexSessionContent内のコメント参照)。
  const rateLimitHits: RateLimitHit[] = [];

  for (const filePath of filePaths) {
    const result = await parseLogFile(filePath, options);
    skippedLines += result.skippedLines;

    for (const entry of result.entries) {
      mergeEntry(merged, entry);
    }
  }

  return {
    entries: Array.from(merged.values()),
    skippedLines,
    rateLimitHits,
  };
}
