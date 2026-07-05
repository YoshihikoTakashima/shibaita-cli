import { readFile } from "node:fs/promises";
import type { ParseResult, UsageEntry } from "../../types.js";

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
    model,
    timestamp,
    inputTokens: toNonNegativeNumber(usage.input_tokens),
    outputTokens: toNonNegativeNumber(usage.output_tokens),
    cacheReadTokens: toNonNegativeNumber(usage.cache_read_input_tokens),
    cacheCreationTokens: toNonNegativeNumber(usage.cache_creation_input_tokens),
    requestId,
  };
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
  let skippedLines = 0;

  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    try {
      const raw = JSON.parse(trimmed) as RawLine;
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

  return { entries, skippedLines };
}

/**
 * 複数ファイルをパースし、全ファイル横断でdedup(同一keyはフィールドごとにmaxマージ、timestampは最初に見たものを保持)する。
 */
export async function parseLogFiles(filePaths: string[]): Promise<ParseResult> {
  const merged = new Map<string, UsageEntry>();
  let skippedLines = 0;

  for (const filePath of filePaths) {
    const result = await parseLogFile(filePath);
    skippedLines += result.skippedLines;

    for (const entry of result.entries) {
      mergeEntry(merged, entry);
    }
  }

  return { entries: Array.from(merged.values()), skippedLines };
}

/** dedupマージ本体: 同一keyのエントリをフィールドごとにmaxで統合する。timestampは最初に見たものを保持。 */
export function mergeEntry(map: Map<string, UsageEntry>, entry: UsageEntry): void {
  const existing = map.get(entry.key);
  if (!existing) {
    map.set(entry.key, entry);
    return;
  }

  map.set(entry.key, {
    key: existing.key,
    model: existing.model,
    timestamp: existing.timestamp, // 最初に見たものを保持
    inputTokens: Math.max(existing.inputTokens, entry.inputTokens),
    outputTokens: Math.max(existing.outputTokens, entry.outputTokens),
    cacheReadTokens: Math.max(existing.cacheReadTokens, entry.cacheReadTokens),
    cacheCreationTokens: Math.max(existing.cacheCreationTokens, entry.cacheCreationTokens),
    requestId: existing.requestId ?? entry.requestId,
  });
}
