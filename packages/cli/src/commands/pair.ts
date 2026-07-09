import pc from "picocolors";
import { getOrCreateSourceId, getPrimaryLogRoot } from "@shibaita/core";
import { SourceBoundError, claimPairing, getApiUrl } from "../api.js";
import { createStateFallback, readState, writeState } from "../state.js";

/** `shibaita pair <code>` : ペアリングコードをdevice tokenに交換して保存する。 */
export async function runPair(args: string[]): Promise<number> {
  const code = args[0];
  if (!code) {
    console.error(pc.red("エラー: ペアリングコードを指定してください。"));
    console.error("使い方: npx shibaita pair <code>");
    return 1;
  }

  let apiUrl: string;
  try {
    apiUrl = getApiUrl();
  } catch (error) {
    console.error(pc.red(`エラー: ${(error as Error).message}`));
    return 1;
  }

  const state = await readState();
  // D-24: sourceId排他バインディング用に、連携前に主要ログルートの識別子を取得しておく。
  const sourceId = await getOrCreateSourceId(getPrimaryLogRoot(), createStateFallback(state));

  try {
    const { deviceToken } = await claimPairing(code, apiUrl, sourceId);
    state.deviceToken = deviceToken;
    await writeState(state);

    console.log(pc.green("ペアリングに成功しました。"));
    console.log("これで npx shibaita submit で利用量を送信できます。");
    return 0;
  } catch (error) {
    if (error instanceof SourceBoundError) {
      console.error(pc.red(`エラー: ${error.message}`));
    } else {
      console.error(pc.red(`エラー: ペアリングに失敗しました。(${(error as Error).message})`));
    }
    return 1;
  }
}
