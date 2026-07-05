import { createInterface } from "node:readline/promises";
import pc from "picocolors";
import {
  aggregateUsage,
  discoverLogFiles,
  getOrCreateSourceId,
  getPrimaryLogRoot,
  parseLogFiles,
  totalTokens,
} from "@shibaita/core";
import type { DailyUsage, SourceIdFallback } from "@shibaita/core";
import { dayUsageSchema, submissionSchema } from "@shibaita/schema";
import type { DayUsagePayload, SubmissionPayload } from "@shibaita/schema";
import { ApiError, getApiUrl, submitUsage } from "../api.js";
import { readState, writeState, type ShibaitaState } from "../state.js";
import { getPackageVersion } from "../version.js";

export interface SubmitOptions {
  dryRun: boolean;
  yes: boolean;
  days: number;
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

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--yes") {
      yes = true;
    } else if (arg === "--days") {
      const value = args[i + 1];
      const n = value ? Number.parseInt(value, 10) : NaN;
      if (Number.isFinite(n) && n > 0) days = n;
      i++;
    }
  }

  return { dryRun, yes, days };
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

function buildPayload(daily: DailyUsage[], sourceId: string): SubmissionPayload {
  const days = daily.map((d) => {
    const day = toDayUsagePayload(d);
    // 個別行もstrict検証しておく(allowlist方式の徹底)
    return dayUsageSchema.parse(day);
  });

  return {
    adapterVersion: ADAPTER_VERSION,
    clientVersion: CLIENT_VERSION,
    sourceId,
    days,
  };
}

/**
 * state.json をフォールバック先とした SourceIdFallback。
 * 主要ログルート直下に `.shibaita-source-id` を作成できない環境(権限なし等)向け。
 */
function createStateFallback(state: ShibaitaState): SourceIdFallback {
  return {
    async read() {
      return state.fallbackSourceId;
    },
    async write(sourceId: string) {
      state.fallbackSourceId = sourceId;
      await writeState(state);
    },
  };
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
  const { entries } = await parseLogFiles(files);
  const daily = aggregateUsage(entries, { days: options.days });

  if (daily.length === 0) {
    console.log(pc.yellow("送信できる利用量データがありません。"));
    return 0;
  }

  const state = await readState();
  const sourceId = await getOrCreateSourceId(getPrimaryLogRoot(), createStateFallback(state));
  const payload = buildPayload(daily, sourceId);

  if (options.dryRun) {
    console.log(pc.bold("送信予定のデータ(dry-run、送信は行いません):"));
    console.log(JSON.stringify(payload, null, 2));
    return 0;
  }

  if (!state.deviceToken) {
    console.error(pc.red("エラー: デバイスが未登録です。"));
    console.error("まずスマートフォンで shibaita.ai にログインし「PCと接続」でペアリングコードを発行してください。");
    console.error("その後、以下を実行してください:");
    console.error("  shibaita pair <code>");
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
    if (response.profileUrl) {
      console.log(`プロフィール: ${response.profileUrl}`);
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
