import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { SourceIdFallback } from "@shibaita/core";

export interface ShibaitaState {
  deviceToken?: string;
  /** key: "date:model", value: 送信時点の合計しばき量 */
  lastSubmitted?: Record<string, number>;
  /**
   * 主要ログルート直下に `.shibaita-source-id` を作成/読み込みできない場合の
   * フォールバック保存先(getOrCreateSourceIdのfallback引数から利用される)。
   */
  fallbackSourceId?: string;
}

function getStateFilePath(): string {
  return join(homedir(), ".config", "shibaita", "state.json");
}

/** ~/.config/shibaita/state.json を読み込む。存在しない/壊れている場合は空オブジェクトを返す。 */
export async function readState(): Promise<ShibaitaState> {
  const filePath = getStateFilePath();
  try {
    const content = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(content) as ShibaitaState;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** state.json をパーミッション0600で書き込む。 */
export async function writeState(state: ShibaitaState): Promise<void> {
  const filePath = getStateFilePath();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), { mode: 0o600 });
}

/** state.json を削除する(logout用)。存在しない場合は何もしない。 */
export async function deleteState(): Promise<void> {
  const filePath = getStateFilePath();
  try {
    await rm(filePath);
  } catch {
    // 存在しない場合は無視
  }
}

/**
 * state.json をフォールバック先とした SourceIdFallback。
 * 主要ログルート直下に `.shibaita-source-id` を作成できない環境(権限なし等)向け。
 * pair/login/submit の各コマンドから共通で利用する(D-24でpair/loginにも展開)。
 */
export function createStateFallback(state: ShibaitaState): SourceIdFallback {
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
