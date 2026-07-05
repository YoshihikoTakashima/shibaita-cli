import { z } from "zod";

/** 送信JSONの1日×1モデル分。公開契約(サーバと共有)。 */
export const dayUsageSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    provider: z.literal("anthropic"),
    product: z.literal("claude-code"),
    model: z.string().min(1).max(100),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative(),
    cacheWriteTokens: z.number().int().nonnegative(),
    requestCount: z.number().int().nonnegative(),
    messageCount: z.number().int().nonnegative(),
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
  })
  .strict();

export type DayUsagePayload = z.infer<typeof dayUsageSchema>;
export type SubmissionPayload = z.infer<typeof submissionSchema>;
