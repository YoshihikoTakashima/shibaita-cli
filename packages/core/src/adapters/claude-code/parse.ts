import { readFile } from "node:fs/promises";
import { mergeEntry, mergeRateLimitHits } from "../../merge.js";
import type { ParseResult, RateLimitHit, UsageEntry } from "../../types.js";

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
 * 単一ファイルをパースする。JSONL 1行ずつ処理(ファイル全体を1文字列で読んでsplitする。ただし1行ずつtry/catch)。
 * このファイル単体のdedupは行わない(dedupは呼び出し側で全ファイル横断して行う)。
 */
export async function parseLogFile(filePath: string): Promise<ParseResult> {
  const content = await readFile(filePath, "utf-8");
  return parseLogContent(content);
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
        } else {
          skippedLines += 1;
        }
      }
      // type !== "assistant" の行は無視(スキップカウントしない)
    } catch {
      skippedLines += 1;
    }
  }

  return { entries, skippedLines, rateLimitHits };
}

/**
 * 複数ファイルをパースし、全ファイル横断でdedupする。
 * - usageエントリ: 同一keyはフィールドごとにmaxマージ、timestampは最初に見たものを保持する。
 * - レート制限ヒット: 同一key(行のuuid、なければ検出行そのまま)は最初に見たものだけを1件として数える。
 */
export async function parseLogFiles(filePaths: string[]): Promise<ParseResult> {
  const merged = new Map<string, UsageEntry>();
  let rateLimitHits: RateLimitHit[] = [];
  let skippedLines = 0;

  for (const filePath of filePaths) {
    const result = await parseLogFile(filePath);
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
