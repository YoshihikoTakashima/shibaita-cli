import {
  discoverCodexLogFiles,
  discoverLogFiles,
  mergeEntries,
  mergeRateLimitHits,
  parseCodexLogFiles,
  parseLogFiles,
} from "@shibaita/core";
import type { RateLimitHit, UsageEntry } from "@shibaita/core";

export interface CollectedUsage {
  entries: UsageEntry[];
  rateLimitHits: RateLimitHit[];
  skippedLines: number;
}

/**
 * 全アダプタ(Claude Code / Codex)を横断してログを探索・パースし、1つの結果に結合する。
 * アダプタ間でkeyが衝突しても provider プレフィックス付きのdedup(core側のmergeEntry/
 * mergeRateLimitHits)で安全にマージされる。submit/inspect/デフォルト表示で共通利用する。
 */
export async function collectAllUsage(): Promise<CollectedUsage> {
  const [claudeCodeFiles, codexFiles] = await Promise.all([discoverLogFiles(), discoverCodexLogFiles()]);
  const [claudeCodeResult, codexResult] = await Promise.all([
    parseLogFiles(claudeCodeFiles),
    parseCodexLogFiles(codexFiles),
  ]);

  const entries = mergeEntries([...claudeCodeResult.entries, ...codexResult.entries]);
  const rateLimitHits = mergeRateLimitHits([
    ...claudeCodeResult.rateLimitHits,
    ...codexResult.rateLimitHits,
  ]);
  const skippedLines = claudeCodeResult.skippedLines + codexResult.skippedLines;

  return { entries, rateLimitHits, skippedLines };
}
