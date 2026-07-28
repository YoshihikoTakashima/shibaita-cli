import { stat } from "node:fs/promises";

/**
 * ファイル全体を `readFile(path, "utf-8")` で1つの文字列として読み込むと、Node/V8の
 * 文字列長上限(環境依存。目安として `buffer.constants.MAX_STRING_LENGTH`、64bit環境で
 * 約512MB=536,870,888文字)を超えるファイルで `RangeError: Invalid string length` が
 * 発生する(実機Node v24.12.0で確認済み: 600MBのファイルをreadFile(utf-8)するとこの
 * メッセージのまま例外が投げられる)。
 *
 * Claude Code / Codex のセッションログは1ファイルがロールされずに肥大化するケースがあり、
 * 実際に512MB超のログファイルを持つユーザーは存在しうる。これを事前に検知し、該当ファイルは
 * 行ストリーム読み(readline + createReadStream)に切り替えるための閾値判定をここに集約する。
 *
 * バイト長で判定する理由: UTF-8のデコード後のUTF-16文字列長は、常に元のUTF-8バイト長以下になる
 * (マルチバイト文字ほど複数バイトが少ないUTF-16コード単位にまとまるため)。よってバイト長での
 * 事前チェックは安全側(文字列長を過大に見積もる方向)に働き、見逃しが起きない。
 */
export const DEFAULT_LARGE_FILE_THRESHOLD_BYTES = 256 * 1024 * 1024; // 256MB

export interface LargeFileCheckOptions {
  /**
   * この値(バイト数)を超えるファイルは行ストリーム読みに切り替える。
   * テストで閾値を注入できるようにするためのオプション(未指定時は
   * DEFAULT_LARGE_FILE_THRESHOLD_BYTES を使う)。実運用でこれを指定する必要はない。
   */
  largeFileThresholdBytes?: number;
}

/**
 * ファイルサイズが閾値を超えるかどうかを判定する。
 * stat自体が失敗する場合(競合で削除された等)は false を返し、
 * 呼び出し側の通常読み込みパスにフォールバックさせる(既存動作を変えないため)。
 */
export async function isLargeFile(filePath: string, options: LargeFileCheckOptions = {}): Promise<boolean> {
  const threshold = options.largeFileThresholdBytes ?? DEFAULT_LARGE_FILE_THRESHOLD_BYTES;
  try {
    const { size } = await stat(filePath);
    return size > threshold;
  } catch {
    return false;
  }
}
