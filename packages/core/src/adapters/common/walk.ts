import { readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * 指定ディレクトリ配下の *.jsonl を再帰的に探索する。シンボリックリンクは辿らない。
 * ディレクトリが存在しない/読めない場合は無視する(存在するものだけ探索する方針)。
 * Claude Code / Codex 両アダプタの discover.ts で共有する。
 */
export async function walkJsonlFiles(root: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      // シンボリックリンクは辿らない
      if (entry.isSymbolicLink()) continue;

      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        results.push(fullPath);
      }
    }
  }

  await walk(root);
  return results;
}
