import pc from "picocolors";
import { aggregateUsage } from "@shibaita/core";
import { collectAllUsage } from "../collect-usage.js";
import { renderDailyTable, renderModelTotals } from "../render.js";

export interface InspectOptions {
  days: number;
}

const DEFAULT_DAYS = 30;

/** --days N を引数配列からパースする */
export function parseInspectArgs(args: string[]): InspectOptions {
  let days = DEFAULT_DAYS;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--days") {
      const value = args[i + 1];
      const n = value ? Number.parseInt(value, 10) : NaN;
      if (Number.isFinite(n) && n > 0) days = n;
      i++;
    }
  }
  return { days };
}

/** `shibaita inspect` : 日別・モデル別のローカル集計を表示する。通信なし。 */
export async function runInspect(args: string[]): Promise<void> {
  const options = parseInspectArgs(args);

  const { entries, skippedLines } = await collectAllUsage();
  const daily = aggregateUsage(entries, { days: options.days });

  console.log(pc.bold(`直近${options.days}日の日別集計`));
  console.log(renderDailyTable(daily));
  console.log();
  console.log(pc.bold("モデル別合計"));
  console.log(renderModelTotals(daily));
  console.log();
  console.log(pc.dim(`スキップした行数: ${skippedLines}`));
}
