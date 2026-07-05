import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const SOURCE_ID_FILENAME = ".shibaita-source-id";

/** state.json等へのフォールバック読み書き(coreはファイル形式を知らないため呼び出し側から注入する)。 */
export interface SourceIdFallback {
  read(): Promise<string | undefined>;
  write(sourceId: string): Promise<void>;
}

/**
 * 「主要ログルート」を決定する: CLAUDE_CONFIG_DIR(カンマ区切り)の先頭 → ~/.claude。
 * discover.ts の探索順(CLAUDE_CONFIG_DIR全部 → ~/.claude → ~/.config/claude)とは別に、
 * sourceIdファイルの置き場所としては「先頭の1箇所」だけを使う(複数ルートに書くと
 * ルートごとに異なるIDが生成され、二重計上対策の意味が薄れるため)。
 */
export function getPrimaryLogRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configDirEnv = env.CLAUDE_CONFIG_DIR;
  if (configDirEnv && configDirEnv.trim().length > 0) {
    const first = configDirEnv.split(",")[0]?.trim();
    if (first && first.length > 0) return first;
  }
  return join(homedir(), ".claude");
}

function isValidSourceId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  // UUID形式チェック(厳密なv4限定ではなく、schema側のz.string().uuid()と同程度の緩さで良い)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
}

/**
 * 主要ログルート直下の `.shibaita-source-id` を読む/作成する。
 *
 * - 既にファイルがあり内容が有効なUUIDならそれを読んで返す。
 * - なければ crypto.randomUUID() で新規生成し、パーミッション0600で書き込んで返す。
 * - ログルートへの読み書きが失敗する場合(権限なし等)は fallback を使う:
 *   - fallback.read() で既存の保存済みIDがあればそれを使う。
 *   - なければ新規生成し fallback.write() で保存する。
 */
export async function getOrCreateSourceId(
  logRoot: string,
  fallback: SourceIdFallback,
): Promise<string> {
  const filePath = join(logRoot, SOURCE_ID_FILENAME);

  try {
    const content = await readFile(filePath, "utf-8");
    const trimmed = content.trim();
    if (isValidSourceId(trimmed)) {
      return trimmed;
    }
    // ファイルはあるが内容が不正 → 上書きを試みる
  } catch {
    // 読めない(存在しない/権限なし) → 作成を試みる
  }

  const newId = randomUUID();
  try {
    await writeFile(filePath, `${newId}\n`, { mode: 0o600 });
    return newId;
  } catch {
    // ログルートへの書き込みが不可能 → フォールバックへ
  }

  const existingFallback = await fallback.read();
  if (existingFallback && isValidSourceId(existingFallback)) {
    return existingFallback;
  }

  await fallback.write(newId);
  return newId;
}
