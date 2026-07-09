import pc from "picocolors";
import { ApiError, getApiUrl, pollDeviceFlow, startDeviceFlow } from "../api.js";
import { openInBrowser } from "../browser-open.js";
import { readState, writeState } from "../state.js";

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_MS = 15 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `shibaita login` : CLI起点のdevice flowペアリング。
 * 1. サーバに開始を要求してdeviceCode(秘密)/userCode(画面表示用)を受け取る
 * 2. ブラウザで承認ページを開く(URLはサーバ応答を信用せず自前組立: getApiUrl()+パス+userCode)
 * 3. 承認されるまで3秒間隔でポーリング(最大15分)
 * 4. 承認されたらdevice tokenを保存する
 */
export async function runLogin(): Promise<number> {
  let apiUrl: string;
  try {
    apiUrl = getApiUrl();
  } catch (error) {
    console.error(pc.red(`エラー: ${(error as Error).message}`));
    return 1;
  }

  let deviceCode: string;
  let userCode: string;
  try {
    const start = await startDeviceFlow(apiUrl);
    deviceCode = start.deviceCode;
    userCode = start.userCode;
  } catch (error) {
    console.error(pc.red(`エラー: 連携の開始に失敗しました。(${(error as Error).message})`));
    return 1;
  }

  // サーバ応答のuserCodeを形式検証してからURLに使う。
  // Windowsの `cmd /c start` はcmd自身が引数内の`&`等を解釈しうるため、
  // 悪性サーバがuserCodeに任意文字列を返すケースをここで遮断する(crockford 8文字のみ許可)。
  if (!/^[0-9A-HJKMNP-TV-Z]{8}$/.test(userCode)) {
    console.error(pc.red("エラー: サーバーからの応答が不正です(連携コードの形式が不正)。"));
    return 1;
  }

  // URLはサーバ応答(verificationUrl)を信用せず、自前で組み立てる(シェルインジェクション対策)。
  const verificationUrl = `${apiUrl}/link?c=${userCode}`;

  console.log(pc.bold("ブラウザで承認してください") + `(コード: ${pc.cyan(userCode)})`);
  console.log(`  ${verificationUrl}`);
  console.log();

  openInBrowser(verificationUrl);

  console.log(pc.dim("承認されるまで待機します… (Ctrl-C で中断できます)"));

  const deadline = Date.now() + MAX_POLL_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    let result;
    try {
      result = await pollDeviceFlow(deviceCode, apiUrl);
    } catch (error) {
      if (error instanceof ApiError) {
        console.error(pc.red(`エラー: ${error.message}`));
        return 1;
      }
      throw error;
    }

    if (result.status === "approved") {
      if (!result.deviceToken) {
        console.error(pc.red("エラー: サーバーからの応答が不正です。"));
        return 1;
      }
      const state = await readState();
      state.deviceToken = result.deviceToken;
      await writeState(state);

      console.log(pc.green("連携完了!(まだ何も送信されていません)"));
      console.log();
      console.log(pc.bold("次のステップ: ") + pc.cyan("npx shibaita submit"));
      console.log(pc.dim("  ↑ 集計値を送信すると、ランキングとマイページに反映されます。"));
      return 0;
    }

    if (result.status === "expired") {
      console.error(
        pc.red("エラー: コードの有効期限が切れました。もう一度 npx shibaita login を実行してください。"),
      );
      return 1;
    }

    // pending: ポーリングを継続する。
  }

  console.error(
    pc.red("エラー: 承認の待機がタイムアウトしました(15分)。もう一度 npx shibaita login を実行してください。"),
  );
  return 1;
}
