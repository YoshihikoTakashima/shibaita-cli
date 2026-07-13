import { z } from "zod";

/** 送信元プロバイダ。アダプタ追加時はここに追加する(現状: Claude Code / Codex)。 */
export const providerSchema = z.enum(["anthropic", "openai"]);

/** 送信元プロダクト。アダプタ追加時はここに追加する(現状: Claude Code / Codex)。 */
export const productSchema = z.enum(["claude-code", "codex"]);

/** 送信JSONの1日×1provider×1product×1モデル分。公開契約(サーバと共有)。 */
export const dayUsageSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    provider: providerSchema,
    product: productSchema,
    model: z.string().min(1).max(100),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative(),
    cacheWriteTokens: z.number().int().nonnegative(),
    requestCount: z.number().int().nonnegative(),
    messageCount: z.number().int().nonnegative(),
  })
  .strict();

/**
 * レート制限ヒットの日別×provider別件数(表示なし・将来用)。rateLimitsフィールドの中身の値は
 * 一切含まない・保持しない。含めるのは日付・provider・検出件数のみ。
 * (上限93件はprovider毎ではなく全体の件数のまま: submissionSchemaのlimitHits配列全体に適用)
 */
export const limitHitSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    provider: providerSchema,
    count: z.number().int().nonnegative(),
  })
  .strict();

/** submit時の送信ボディ全体 */
export const submissionSchema = z
  .object({
    adapterVersion: z.string(),
    clientVersion: z.string(),
    /** ログ置き場(主要ログルート)単位の識別子。同期された複数PCからの二重計上対策 */
    sourceId: z.string().uuid(),
    /** 送信元OS種別。端末別内訳の表示に利用。ホスト名・マシン名等は含まない */
    os: z.enum(["macos", "windows", "linux", "other"]),
    days: z.array(dayUsageSchema).min(1).max(2000),
    /** 期間内にレート制限ヒットが無い場合は省略する(送らない) */
    limitHits: z.array(limitHitSchema).max(93).optional(),
  })
  .strict();

export type Provider = z.infer<typeof providerSchema>;
export type Product = z.infer<typeof productSchema>;
export type DayUsagePayload = z.infer<typeof dayUsageSchema>;
export type LimitHitPayload = z.infer<typeof limitHitSchema>;
export type SubmissionPayload = z.infer<typeof submissionSchema>;
