import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Claude Code のログJSONLファイルを探索する。
 *
 * 探索対象(存在するものだけ):
 * 1. CLAUDE_CONFIG_DIR 環境変数(カンマ区切り複数可)の各 <dir>/projects/**\/*.jsonl と <dir>/transcripts/**\/*.jsonl
 * 2. ~/.claude/projects/**\/*.jsonl
 * 3. ~/.claude/transcripts/**\/*.jsonl (ディレクトリが存在すれば)
 * 4. ~/.config/claude/projects/**\/*.jsonl (後方互換)
 *
 * 再帰探索は fs.readdir 再帰(globライブラリ不使用)。シンボリックリンクは辿らない。
 */
export async function discoverLogFiles(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const roots: string[] = [];

  const configDirEnv = env.CLAUDE_CONFIG_DIR;
  if (configDirEnv && configDirEnv.trim().length > 0) {
    for (const rawDir of configDirEnv.split(",")) {
      const dir = rawDir.trim();
      if (dir.length === 0) continue;
      roots.push(join(dir, "projects"));
      roots.push(join(dir, "transcripts"));
    }
  }

  const home = homedir();
  roots.push(join(home, ".claude", "projects"));
  roots.push(join(home, ".claude", "transcripts"));
  roots.push(join(home, ".config", "claude", "projects"));

  const found = new Set<string>();
  for (const root of roots) {
    const files = await walkJsonlFiles(root);
    for (const f of files) found.add(f);
  }
  return Array.from(found);
}

/** 指定ディレクトリ配下の *.jsonl を再帰的に探索する。シンボリックリンクは辿らない。 */
async function walkJsonlFiles(root: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // ディレクトリが存在しない/読めない場合は無視(存在するものだけ探索)
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
