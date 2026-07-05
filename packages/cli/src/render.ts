import pc from "picocolors";
import type { DailyUsage } from "@shibaita/core";
import { totalTokens } from "@shibaita/core";

/** トークン数を桁区切りの読みやすい文字列にする(例: 1234567 -> "1,234,567") */
export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/** 日別データを日付単位で合算する(モデル別内訳を畳んで日合計にする) */
export function sumByDate(daily: DailyUsage[]): Map<string, number> {
  const byDate = new Map<string, number>();
  for (const d of daily) {
    const current = byDate.get(d.date) ?? 0;
    byDate.set(d.date, current + totalTokens(d));
  }
  return byDate;
}

/** 直近N日の簡易バー表示を組み立てる(ターミナル出力用の文字列を返す) */
export function renderBarChart(daily: DailyUsage[], days: number): string {
  const byDate = sumByDate(daily);
  const dates = buildRecentDates(days);

  const max = Math.max(1, ...dates.map((d) => byDate.get(d) ?? 0));
  const barWidth = 30;

  const lines = dates.map((date) => {
    const value = byDate.get(date) ?? 0;
    const filled = value === 0 ? 0 : Math.max(1, Math.round((value / max) * barWidth));
    const bar = pc.cyan("#".repeat(filled)) + " ".repeat(Math.max(0, barWidth - filled));
    return `${date}  ${bar}  ${formatNumber(value)}`;
  });

  return lines.join("\n");
}

/** 今日から遡ってN日分の YYYY-MM-DD (ローカルTZ) を古い順に返す */
function buildRecentDates(days: number): string[] {
  const result: string[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    d.setDate(d.getDate() - i);
    result.push(toLocalDateString(d));
  }
  return result;
}

function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** inspect用: 日別テーブル(date, しばき量, 内訳4種, req数) */
export function renderDailyTable(daily: DailyUsage[]): string {
  if (daily.length === 0) {
    return pc.dim("  (データがありません)");
  }

  const header = [
    pad("日付", 10),
    pad("モデル", 24),
    padNum("しばき量", 14),
    padNum("input", 12),
    padNum("output", 12),
    padNum("cache読", 12),
    padNum("cache書", 12),
    padNum("req数", 8),
  ].join(" ");

  const separator = "-".repeat(header.length);

  const rows = daily.map((d) => {
    return [
      pad(d.date, 10),
      pad(d.model, 24),
      padNum(formatNumber(totalTokens(d)), 14),
      padNum(formatNumber(d.inputTokens), 12),
      padNum(formatNumber(d.outputTokens), 12),
      padNum(formatNumber(d.cacheReadTokens), 12),
      padNum(formatNumber(d.cacheWriteTokens), 12),
      padNum(String(d.requestCount), 8),
    ].join(" ");
  });

  return [pc.bold(header), separator, ...rows].join("\n");
}

/** inspect用: モデル別合計 */
export function renderModelTotals(daily: DailyUsage[]): string {
  const byModel = new Map<string, number>();
  for (const d of daily) {
    byModel.set(d.model, (byModel.get(d.model) ?? 0) + totalTokens(d));
  }

  const entries = Array.from(byModel.entries()).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return pc.dim("  (データがありません)");
  }

  return entries.map(([model, total]) => `  ${pad(model, 28)} ${formatNumber(total)}`).join("\n");
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s.slice(0, width);
  return s + " ".repeat(width - s.length);
}

function padNum(s: string, width: number): string {
  if (s.length >= width) return s;
  return " ".repeat(width - s.length) + s;
}
