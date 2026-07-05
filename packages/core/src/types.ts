/**
 * Claude Code のログJSONLから抽出した1メッセージ分の利用量エントリ。
 * dedup(同一key複数行のフィールド別maxマージ)後の形。
 */
export interface UsageEntry {
  /** message.id + ":" + requestId (requestId欠落時はmessage.id、message.id欠落時は行のuuid) */
  key: string;
  model: string;
  /** ISO文字列由来のDate。同一keyの複数行では最初に見たものを保持する */
  timestamp: Date;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  requestId?: string;
}

/** 日別×モデル別の集計結果 */
export interface DailyUsage {
  /** YYYY-MM-DD (ローカルTZ) */
  date: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** distinct requestId 数 */
  requestCount: number;
  /** dedup後エントリ数 */
  messageCount: number;
}

/** parse.ts の結果 */
export interface ParseResult {
  entries: UsageEntry[];
  skippedLines: number;
}

export interface AggregateOptions {
  /** 直近N日フィルタ(ローカルTZ基準)。省略時は全期間 */
  days?: number;
}
