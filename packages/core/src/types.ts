/**
 * アダプタ(Claude Code / Codex等)のログJSONLから抽出した1メッセージ(またはセッション)分の
 * 利用量エントリ。dedup(同一key複数行のフィールド別maxマージ)後の形。
 */
export interface UsageEntry {
  /**
   * アダプタ内で一意なkey。
   * Claude Code: message.id + ":" + requestId (requestId欠落時はmessage.id、message.id欠落時は行のuuid)
   * Codex: セッションファイル識別子 + ":" + model
   * 複数アダプタを横断してマージする際は provider プレフィックス付きの内部キーで衝突を防ぐ(merge.ts参照)。
   */
  key: string;
  /** 送信元プロバイダ("anthropic" | "openai" 等。schema側でenum検証する) */
  provider: string;
  /** 送信元プロダクト("claude-code" | "codex" 等。schema側でenum検証する) */
  product: string;
  model: string;
  /** ISO文字列由来のDate。同一keyの複数行では最初に見たものを保持する */
  timestamp: Date;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  requestId?: string;
}

/** 日別×provider×product×モデル別の集計結果 */
export interface DailyUsage {
  /** YYYY-MM-DD (ローカルTZ) */
  date: string;
  provider: string;
  product: string;
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

/**
 * レート制限ヒット1件分の検出結果。
 * 表示・保存するのは日別件数のみであり、rateLimitsフィールドの中身(値)は一切読まない・保持しない。
 */
export interface RateLimitHit {
  /** dedupキー: 行のuuid。なければ検出行(トリム済み生テキスト)そのもの */
  key: string;
  /** 送信元プロバイダ("anthropic" | "openai" 等) */
  provider: string;
  /** ISO文字列由来のDate。日別集計の基準(行のtimestampが無い/不正な行はそもそも検出しない) */
  timestamp: Date;
}

/** 日別×provider別のレート制限ヒット件数集計結果 */
export interface DailyLimitHits {
  /** YYYY-MM-DD (ローカルTZ) */
  date: string;
  provider: string;
  count: number;
}

/** parse.ts の結果 */
export interface ParseResult {
  entries: UsageEntry[];
  skippedLines: number;
  /** dedup前の検出済みレート制限ヒット。dedupは呼び出し側(parseLogFiles)で全ファイル横断して行う */
  rateLimitHits: RateLimitHit[];
}

export interface AggregateOptions {
  /** 直近N日フィルタ(ローカルTZ基準)。省略時は全期間 */
  days?: number;
}
