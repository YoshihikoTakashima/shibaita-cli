import { createInterface } from "node:readline/promises";
import pc from "picocolors";
import {
  aggregateRateLimitHits,
  aggregateUsage,
  discoverLogFiles,
  getOrCreateSourceId,
  getPrimaryLogRoot,
  parseLogFiles,
  totalTokens,
} from "@shibaita/core";
import type { DailyLimitHits, DailyUsage } from "@shibaita/core";
import { dayUsageSchema, limitHitSchema, submissionSchema } from "@shibaita/schema";
import type { DayUsagePayload, LimitHitPayload, SubmissionPayload } from "@shibaita/schema";
import { ApiError, getApiUrl, submitUsage } from "../api.js";
import { openInBrowser } from "../browser-open.js";
import { createStateFallback, readState, writeState } from "../state.js";
import { getPackageVersion } from "../version.js";

export interface SubmitOptions {
  dryRun: boolean;
  yes: boolean;
  days: number;
  noOpen: boolean;
}

const DEFAULT_DAYS = 90;
// ADAPTER_VERSION: 送信ペイロードスキーマ(packages/schema)自体のバージョン。
// パッケージのバージョン(CLIENT_VERSION)とは別概念のため固定値のまま管理する。
const ADAPTER_VERSION = "1.0.0";
// CLIENT_VERSION: packages/cli/package.json の "version" を唯一のソースとする。
const CLIENT_VERSION = getPackageVersion();

export function parseSubmitArgs(args: string[]): SubmitOptions {
  let dryRun = false;
  let yes = false;
  let days = DEFAULT_DAYS;
  let noOpen = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--yes") {
      yes = true;
    } else if (arg === "--no-open") {
      noOpen = true;
    } else if (arg === "--days") {
      const value = args[i + 1];
      const n = value ? Number.parseInt(value, 10) : NaN;
      if (Number.isFinite(n) && n > 0) days = n;
      i++;
    }
  }

  return { dryRun, yes, days, noOpen };
}

export type OsType = "macos" | "windows" | "linux" | "other";

/** process.platform から送信用OS種別へマップする。ホスト名・マシン名は含めない。 */
export function detectOs(platform: NodeJS.Platform = process.platform): OsType {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  if (platform === "linux") return "linux";
  return "other";
}

/** allowlist方式: DailyUsageから明示的にフィールドを1つずつ写してpayload要素を構築する */
function toDayUsagePayload(usage: DailyUsage): DayUsagePayload {
  return {
    date: usage.date,
    provider: "anthropic",
    product: "claude-code",
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    requestCount: usage.requestCount,
    messageCount: usage.messageCount,
  };
}

/** allowlist方式: DailyLimitHitsから明示的にフィールドを1つずつ写してpayload要素を構築する */
function toLimitHitPayload(hit: DailyLimitHits): LimitHitPayload {
  return {
    date: hit.date,
    count: hit.count,
  };
}

function buildPayload(
  daily: DailyUsage[],
  limitHits: DailyLimitHits[],
  sourceId: string,
): SubmissionPayload {
  const days = daily.map((d) => {
    const day = toDayUsagePayload(d);
    // 個別行もstrict検証しておく(allowlist方式の徹底)
    return dayUsageSchema.parse(day);
  });

  const payload: SubmissionPayload = {
    adapterVersion: ADAPTER_VERSION,
    clientVersion: CLIENT_VERSION,
    sourceId,
    os: detectOs(),
    days,
  };

  // 期間内のヒットが無ければpayloadに含めない(0件なら省略)。
  if (limitHits.length > 0) {
    payload.limitHits = limitHits.map((h) => limitHitSchema.parse(toLimitHitPayload(h)));
  }

  return payload;
}

function lastSubmittedKey(date: string, model: string): string {
  return `${date}:${model}`;
}

type SubmitStatusLabel = "新規" | "更新" | "送信済み";

function classifyStatus(
  usage: DailyUsage,
  lastSubmitted: Record<string, number> | undefined,
): SubmitStatusLabel {
  const key = lastSubmittedKey(usage.date, usage.model);
  const previous = lastSubmitted?.[key];
  if (previous === undefined) return "新規";
  const current = totalTokens(usage);
  return previous === current ? "送信済み" : "更新";
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/** `shibaita submit` : 集計→確認→送信。dry-runは整形JSON表示のみ(通信なし)。 */
export async function runSubmit(args: string[]): Promise<number> {
  const options = parseSubmitArgs(args);

  const files = await discoverLogFiles();
  const { entries, rateLimitHits } = await parseLogFiles(files);
  const daily = aggregateUsage(entries, { days: options.days });
  const dailyLimitHits = aggregateRateLimitHits(rateLimitHits, { days: options.days });

  if (daily.length === 0) {
    console.log(pc.yellow("送信できる利用量データがありません。"));
    return 0;
  }

  const state = await readState();
  const sourceId = await getOrCreateSourceId(getPrimaryLogRoot(), createStateFallback(state));
  const payload = buildPayload(daily, dailyLimitHits, sourceId);

  if (options.dryRun) {
    console.log(pc.bold("送信予定のデータ(dry-run、送信は行いません):"));
    console.log(JSON.stringify(payload, null, 2));
    return 0;
  }

  if (!state.deviceToken) {
    console.error(pc.red("エラー: デバイスが未登録です。"));
    console.error("npx shibaita login を実行してブラウザで連携してください。");
    console.error("(スマホで発行したコードがある場合は npx shibaita pair <code>)");
    return 1;
  }

  let apiUrl: string;
  try {
    apiUrl = getApiUrl();
  } catch (error) {
    console.error(pc.red(`エラー: ${(error as Error).message}`));
    return 1;
  }

  console.log(pc.bold("送信先:"), apiUrl);
  console.log(pc.bold("対象期間:"), `直近${options.days}日`);
  console.log();
  console.log(pc.bold("日別サマリ:"));
  for (const d of daily) {
    const status = classifyStatus(d, state.lastSubmitted);
    const statusColor =
      status === "新規" ? pc.green(status) : status === "更新" ? pc.yellow(status) : pc.dim(status);
    console.log(`  ${d.date}  ${d.model.padEnd(24)}  ${formatNumber(totalTokens(d)).padStart(14)}  ${statusColor}`);
  }
  console.log();
  if (dailyLimitHits.length > 0) {
    const totalHits = dailyLimitHits.reduce((sum, h) => sum + h.count, 0);
    console.log(pc.bold("リミットヒット:"), `${dailyLimitHits.length}日/合計${totalHits}回`);
  }
  console.log(pc.dim("送信するのは上記の日別集計値のみです。"));

  if (!options.yes) {
    const confirmed = await promptYesNo("送信しますか? (y/N): ");
    if (!confirmed) {
      console.log("送信をキャンセルしました。");
      return 0;
    }
  }

  try {
    const validated = submissionSchema.parse(payload);
    const response = await submitUsage(validated, state.deviceToken, apiUrl);

    const lastSubmitted = state.lastSubmitted ?? {};
    for (const d of daily) {
      lastSubmitted[lastSubmittedKey(d.date, d.model)] = totalTokens(d);
    }
    state.lastSubmitted = lastSubmitted;
    await writeState(state);

    console.log(pc.green(`送信が完了しました。(受理: ${response.accepted}件)`));
    // 結果ページはサーバ応答のURLではなく自前組立(getApiUrl()+/me)を開く(login同様の方針)。
    const meUrl = `${apiUrl}/me`;
    console.log(`マイページ: ${meUrl}`);
    if (!options.noOpen) {
      openInBrowser(meUrl);
      console.log(pc.dim("ブラウザで結果を開きました。(--no-open で抑止できます)"));
    }
    return 0;
  } catch (error) {
    if (error instanceof ApiError) {
      console.error(pc.red(`エラー: ${error.message}`));
    } else {
      console.error(pc.red("エラー: 送信データの検証に失敗しました。"));
    }
    return 1;
  }
}

async function promptYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question);
    const normalized = answer.trim().toLowerCase();
    return normalized === "y" || normalized === "yes";
  } finally {
    rl.close();
  }
}
