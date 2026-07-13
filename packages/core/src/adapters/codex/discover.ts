import { homedir } from "node:os";
import { join } from "node:path";
import { walkJsonlFiles } from "../common/walk.js";

/**
 * Codex CLI (OpenAI) のセッションログJSONLファイルを探索する。
 *
 * 探索対象(実端末の ~/.codex で検証済みのパス):
 * - CODEX_HOME 環境変数があれば <CODEX_HOME>/sessions/**\/*.jsonl (優先。Claude Code側と異なり
 *   複数ディレクトリ合算ではなく単純な上書き)
 * - なければ ~/.codex/sessions/**\/*.jsonl
 *
 * 実際のファイル名は `rollout-YYYY-MM-DDTHH-MM-SS-<uuid>.jsonl` で、
 * `sessions/YYYY/MM/DD/` 配下に格納されている。再帰探索は共通の walkJsonlFiles を使う
 * (シンボリックリンクは辿らない)。ディレクトリが存在しない場合は空配列を返す。
 */
export async function discoverLogFiles(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const codexHomeEnv = env.CODEX_HOME;
  const root =
    codexHomeEnv && codexHomeEnv.trim().length > 0 ? codexHomeEnv.trim() : join(homedir(), ".codex");

  const sessionsRoot = join(root, "sessions");
  return walkJsonlFiles(sessionsRoot);
}
