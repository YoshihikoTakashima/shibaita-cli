#!/usr/bin/env node
import pc from "picocolors";
import { aggregateUsage, discoverLogFiles, parseLogFiles, totalTokens } from "@shibaita/core";
import { runInspect } from "./commands/inspect.js";
import { runLogin } from "./commands/login.js";
import { runPair } from "./commands/pair.js";
import { runSubmit } from "./commands/submit.js";
import { runLogout } from "./commands/logout.js";
import { runInstallSkill } from "./commands/install-skill.js";
import { renderBarChart } from "./render.js";

function currentMonthDays(): number {
  const now = new Date();
  return now.getDate();
}

/** `shibaita` (引数なし) : 今月の合計しばき量+直近7日のバー表示+案内 */
async function runDefault(): Promise<number> {
  const files = await discoverLogFiles();
  const { entries } = await parseLogFiles(files);

  const daily = aggregateUsage(entries, { days: currentMonthDays() });
  const monthTotal = daily.reduce((sum, d) => sum + totalTokens(d), 0);

  console.log(pc.bold("shibaita.ai - Claude Codeしばき量集計"));
  console.log();
  console.log(`今月の合計しばき量: ${pc.cyan(monthTotal.toLocaleString("en-US"))}`);
  console.log();
  console.log(pc.bold("直近7日"));

  const recent = aggregateUsage(entries, { days: 7 });
  console.log(renderBarChart(recent, 7));
  console.log();
  console.log(pc.dim("npx shibaita inspect で詳細を確認できます。"));
  console.log(pc.bold("ランキングに参加するには(2ステップ):"));
  console.log("  1. " + pc.cyan("npx shibaita login") + pc.dim("   初回のみ・ブラウザで1クリック連携"));
  console.log("  2. " + pc.cyan("npx shibaita submit") + pc.dim("  集計値を送信(これでランキングに載る)"));

  return 0;
}

function printHelp(): void {
  console.log(`shibaita - Claude Codeの利用量をローカルで集計するCLI

使い方:
  npx shibaita                今月の合計+直近7日のバー表示
  npx shibaita inspect        日別・モデル別の詳細集計を表示 [--days N=30]
  npx shibaita login          ブラウザでPCを連携(初回はこちら)
  npx shibaita pair <code>    スマホで発行したペアリングコードでデバイスを登録
  npx shibaita submit         集計結果を送信 [--dry-run] [--yes] [--days N=90] [--no-open]
  npx shibaita logout         ローカルの登録情報を削除
  npx shibaita install-skill  Claude Code用スキルをインストール [--api-url URL]
`);
}

/**
 * 全角スペース(U+3000)対策: 日本語入力のままコピペすると
 * `pair　CODE` が1引数として渡ってくるため、全角スペースを区切りとして分割する。
 */
function normalizeArgs(args: string[]): string[] {
  return args.flatMap((a) => a.split(/　+/)).filter((a) => a.length > 0);
}

async function main(): Promise<void> {
  const [command, ...rest] = normalizeArgs(process.argv.slice(2));

  try {
    let exitCode = 0;

    switch (command) {
      case undefined:
        exitCode = await runDefault();
        break;
      case "inspect":
        await runInspect(rest);
        break;
      case "login":
        exitCode = await runLogin();
        break;
      case "pair":
        exitCode = await runPair(rest);
        break;
      case "submit":
        exitCode = await runSubmit(rest);
        break;
      case "logout":
        exitCode = await runLogout();
        break;
      case "install-skill":
        exitCode = await runInstallSkill(rest);
        break;
      case "--help":
      case "-h":
      case "help":
        printHelp();
        break;
      default:
        console.error(pc.red(`不明なコマンドです: ${command}`));
        printHelp();
        exitCode = 1;
    }

    process.exitCode = exitCode;
  } catch (error) {
    console.error(pc.red(`エラーが発生しました: ${(error as Error).message}`));
    process.exitCode = 1;
  }
}

main();
