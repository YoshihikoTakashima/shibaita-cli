import { readFile } from "node:fs/promises";
import { mergeEntry, mergeRateLimitHits } from "../../merge.js";
import type { ParseResult, RateLimitHit, UsageEntry } from "../../types.js";
import { isLargeFile } from "../common/large-file.js";
import type { LargeFileCheckOptions } from "../common/large-file.js";
import { readJsonlLines } from "../common/jsonl-lines.js";
import type { JsonlLineReadOptions } from "../common/jsonl-lines.js";

/** 巨大ファイル判定(ファイル全体サイズ)と行ストリーム読み(1行の最大長)、両方のテスト注入オプション */
export type ParseFileOptions = LargeFileCheckOptions & JsonlLineReadOptions;

const PROVIDER = "anthropic";
const PRODUCT = "claude-code";

interface RawUsage {
  input_tokens?: unknown;
  output_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
}

interface RawMessage {
  id?: unknown;
  model?: unknown;
  usage?: unknown;
}

interface RawLine {
  type?: unknown;
  message?: unknown;
  requestId?: unknown;
  timestamp?: unknown;
  uuid?: unknown;
  error?: unknown;
}

/** 数値でない・負値は0にする */
function toNonNegativeNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

/**
 * 1件分の生JSON行を UsageEntry に変換する。採用条件を満たさない/必須情報が欠落している場合は null。
 */
function parseLine(raw: RawLine): UsageEntry | null {
  if (raw.type !== "assistant") return null;

  const message = raw.message as RawMessage | undefined;
  if (!message || typeof message !== "object") return null;
  if (message.usage === undefined || message.usage === null) return null;
  if (message.model === "<synthetic>") return null;

  if (typeof message.model !== "string") return null;
  const model = message.model;

  const messageId = typeof message.id === "string" ? message.id : undefined;
  const requestId = typeof raw.requestId === "string" ? raw.requestId : undefined;

  let key: string;
  if (messageId && requestId) {
    key = `${messageId}:${requestId}`;
  } else if (messageId) {
    key = messageId;
  } else if (typeof raw.uuid === "string") {
    key = raw.uuid;
  } else {
    return null;
  }

  if (typeof raw.timestamp !== "string") return null;
  const timestamp = new Date(raw.timestamp);
  if (Number.isNaN(timestamp.getTime())) return null;

  const usage = message.usage as RawUsage;

  return {
    key,
    provider: PROVIDER,
    product: PRODUCT,
    model,
    timestamp,
    inputTokens: toNonNegativeNumber(usage.input_tokens),
    outputTokens: toNonNegativeNumber(usage.output_tokens),
    cacheReadTokens: toNonNegativeNumber(usage.cache_read_input_tokens),
    cacheCreationTokens: toNonNegativeNumber(usage.cache_creation_input_tokens),
    requestId,
  };
}

/** raw.error が `rateLimits` フィールドを持つオブジェクトかどうか(値の中身は見ない・読まない)。 */
function hasRateLimitsField(error: unknown): error is Record<string, unknown> {
  return typeof error === "object" && error !== null && "rateLimits" in error;
}

/**
 * 1行分の生JSONからレート制限ヒットを検出する。type種別は問わない(assistant行の判定とは独立)。
 * timestampが無い/不正な行はskip(検出しない)。rateLimitsの値そのものは一切読まない・保持しない(検出のみ)。
 */
function detectRateLimitHit(raw: RawLine, rawLineText: string): RateLimitHit | null {
  if (!hasRateLimitsField(raw.error)) return null;

  if (typeof raw.timestamp !== "string") return null;
  const timestamp = new Date(raw.timestamp);
  if (Number.isNaN(timestamp.getTime())) return null;

  const key = typeof raw.uuid === "string" ? raw.uuid : rawLineText;

  return { key, provider: PROVIDER, timestamp };
}

/**
 * 1行分(トリム済み・空行ではない)をパースし、entries/rateLimitHitsに追記する。
 * skipした場合(壊れたJSON、または採用条件を満たさないassistant行)は true を返す。
 * 文字列一括読み込み経路(parseLogContent)・行ストリーム読み経路(parseLogFileStreaming)の
 * 両方から共有する(ロジックの二重管理を避ける)。
 */
function processTrimmedLine(
  trimmed: string,
  entries: UsageEntry[],
  rateLimitHits: RateLimitHit[],
): boolean {
  try {
    const raw = JSON.parse(trimmed) as RawLine;

    // usage集計とレート制限ヒット検出は同じスキャン(この1行のパース結果)で一緒に処理する(2度読みしない)。
    const rateLimitHit = detectRateLimitHit(raw, trimmed);
    if (rateLimitHit) {
      rateLimitHits.push(rateLimitHit);
    }

    if (raw.type === "assistant") {
      const entry = parseLine(raw);
      if (entry) {
        entries.push(entry);
        return false;
      }
      return true;
    }
    // type !== "assistant" の行は無視(スキップカウントしない)
    return false;
  } catch {
    return true;
  }
}

/** テスト用に文字列から直接パースする */
export function parseLogContent(content: string): ParseResult {
  const entries: UsageEntry[] = [];
  const rateLimitHits: RateLimitHit[] = [];
  let skippedLines = 0;

  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (processTrimmedLine(trimmed, entries, rateLimitHits)) skippedLines += 1;
  }

  return { entries, skippedLines, rateLimitHits };
}

/**
 * ファイル全体を1文字列で読み込まず、行ストリーム(共有の readJsonlLines)で処理する。
 * 巨大ファイル(目安256MB超)で `readFile(path, "utf-8")` が
 * `RangeError: Invalid string length` を投げるのを避けるための経路。
 * 1行ずつ独立して処理する(Claude Codeのusageエントリは行ごとに完結しており、
 * ファイル内で累積状態を保持する必要が無いため、ストリーム化してもdedup前の結果は変わらない)。
 * さらに、1行自体が異常に長い(例: 数百MB)場合に備え、readJsonlLines側で行長上限
 * (既定64MB)を超える行は本文を保持せず破棄する(skippedLinesに計上する)。
 */
async function parseLogFileStreaming(
  filePath: string,
  options: JsonlLineReadOptions,
): Promise<ParseResult> {
  const entries: UsageEntry[] = [];
  const rateLimitHits: RateLimitHit[] = [];
  let skippedLines = 0;

  for await (const event of readJsonlLines(filePath, options)) {
    if (event.kind === "oversized") {
      skippedLines += 1;
      continue;
    }

    const trimmed = event.line.trim();
    if (trimmed.length === 0) continue;
    if (processTrimmedLine(trimmed, entries, rateLimitHits)) skippedLines += 1;
  }

  return { entries, skippedLines, rateLimitHits };
}

/**
 * 単一ファイルをパースする。JSONL 1行ずつ処理する。
 * このファイル単体のdedupは行わない(dedupは呼び出し側で全ファイル横断して行う)。
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
    return parseLogFileStreaming(filePath, options);
  }

  const content = await readFile(filePath, "utf-8");
  return parseLogContent(content);
}

/**
 * 複数ファイルをパースし、全ファイル横断でdedupする。
 * - usageエントリ: 同一keyはフィールドごとにmaxマージ、timestampは最初に見たものを保持する。
 * - レート制限ヒット: 同一key(行のuuid、なければ検出行そのまま)は最初に見たものだけを1件として数える。
 */
export async function parseLogFiles(
  filePaths: string[],
  options: ParseFileOptions = {},
): Promise<ParseResult> {
  const merged = new Map<string, UsageEntry>();
  let rateLimitHits: RateLimitHit[] = [];
  let skippedLines = 0;

  for (const filePath of filePaths) {
    const result = await parseLogFile(filePath, options);
    skippedLines += result.skippedLines;

    for (const entry of result.entries) {
      mergeEntry(merged, entry);
    }

    rateLimitHits = mergeRateLimitHits([...rateLimitHits, ...result.rateLimitHits]);
  }

  return {
    entries: Array.from(merged.values()),
    skippedLines,
    rateLimitHits,
  };
}
