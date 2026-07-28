import pc from "picocolors";

/**
 * main()の最上位catch用のエラー表示。
 *
 * 通常時の表示は従来通り「エラーが発生しました: <message>」の1行のみ(変更しない)。
 * 環境変数 `SHIBAITA_DEBUG=1` が設定されている場合のみ、続けてスタックトレースを表示する
 * (今後の障害報告の診断性向上のため)。
 *
 * `env`/`logger` は注入可能にしてあり、テストから実際の process.env / console に
 * 依存せず検証できるようにしている(デフォルトは実行時の process.env / console)。
 */
export function reportTopLevelError(
  error: unknown,
  env: NodeJS.ProcessEnv = process.env,
  logger: Pick<Console, "error"> = console,
): void {
  const err = error instanceof Error ? error : new Error(String(error));
  logger.error(pc.red(`エラーが発生しました: ${err.message}`));

  if (env.SHIBAITA_DEBUG === "1") {
    logger.error(pc.dim(err.stack ?? `${err.name}: ${err.message}`));
  }
}
