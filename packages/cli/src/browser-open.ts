import { spawn } from "node:child_process";

/**
 * ★child_process使用はこのファイルのみ(loginコマンド専用)。
 * network-isolation.test.ts がcliパッケージ内のchild_process使用箇所を検査する。
 *
 * OS別にデフォルトブラウザでURLを開く。
 * - darwin: open <url>
 * - win32:  cmd /c start "" <url>  (第1引数の空文字は`start`がウィンドウタイトルとして
 *           解釈するダミー。省略するとURL自体がタイトル扱いになり、`&`等を含む場合に
 *           誤動作する)
 * - linux等: xdg-open <url>
 *
 * spawnは引数配列渡し・shell:falseで実行するため、URLにシェルメタ文字が含まれていても
 * シェル経由で解釈されることはない(シェルインジェクションの余地なし)。
 * それでも呼び出し側は、URLをサーバ応答からではなく自前で組み立てた値を渡すこと。
 */
export function openInBrowser(url: string): void {
  const platform = process.platform;

  let command: string;
  let args: string[];

  if (platform === "darwin") {
    command = "open";
    args = [url];
  } else if (platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
  } else {
    command = "xdg-open";
    args = [url];
  }

  try {
    const child = spawn(command, args, { shell: false, stdio: "ignore", detached: true });
    child.on("error", () => {
      // ブラウザが開けなくても致命的ではない(URLは画面に表示済みのため手動で開ける)。
    });
    child.unref();
  } catch {
    // spawn自体が同期的に投げるケースの保険。
  }
}
