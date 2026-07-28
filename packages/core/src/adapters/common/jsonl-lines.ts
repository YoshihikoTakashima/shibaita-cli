import { createReadStream } from "node:fs";

/**
 * ファイル全体を1文字列で読み込まず、行単位でストリーム処理するための共有ユーティリティ。
 *
 * 背景: `readFile(path, "utf-8")` は環境依存のNode/V8文字列長上限(64bit環境で目安約512MB=
 * `buffer.constants.MAX_STRING_LENGTH`)を超えるファイルに対して
 * `RangeError: Invalid string length` を投げる(実機Node v24.12.0、600MBのファイルで確認済み)。
 * Claude Code / Codex のセッションログはロールされずに肥大化することがあり、実際に512MB超の
 * ログファイル(Codexの累積セッションログで1.0GB/588MB/577MB)を持つユーザーが報告で確認された。
 *
 * `node:readline` の `createInterface` を使わない理由: readlineには1行の最大長を制限する
 * オプションが無い。JSONL内の1行が異常に(例: 数百MB)長い場合、ストリーム化していても
 * readlineが内部でその1行をまるごと1つのJS文字列として保持しようとし、理論上は同じ
 * `Invalid string length` に当たり得る。ここでは自前でチャンクを読み、改行が見つからないまま
 * 蓄積中のバッファが `maxLineBytes` を超えたらその行を破棄(スキップ)してバッファをリセットする
 * ことで、1行がどれだけ長くても保持するバッファの長さを `maxLineBytes` 程度(+チャンクサイズ分)
 * に抑える。これによりピークメモリはファイルサイズに依存せず、行サイズ(の上限)のオーダーになる。
 */

export const DEFAULT_MAX_LINE_BYTES = 64 * 1024 * 1024; // 64MB

export interface JsonlLineReadOptions {
  /** 1行の最大バイト長。これを超える行は破棄し、oversizedとして報告する(既定64MB)。 */
  maxLineBytes?: number;
  /** ストリームの読み込み単位(highWaterMark)。テストで小さくして境界ケースを検証できる。 */
  chunkSizeBytes?: number;
}

export type JsonlLineEvent = { kind: "line"; line: string } | { kind: "oversized" };

/**
 * ファイルを行単位で非同期ストリーム読みする。
 * 通常行は `{ kind: "line", line }` を、`maxLineBytes` を超えた行は本文を保持せず
 * `{ kind: "oversized" }` のみを生成する(呼び出し側でスキップ扱いにする想定)。
 */
export async function* readJsonlLines(
  filePath: string,
  options: JsonlLineReadOptions = {},
): AsyncGenerator<JsonlLineEvent> {
  const maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  const stream = createReadStream(filePath, {
    encoding: "utf-8",
    highWaterMark: options.chunkSizeBytes,
  });

  let buffer = "";
  // 直前までのバッファを閾値超過で破棄済みで、まだその行の終端(改行)に到達していない状態か。
  let discardingOversizedLine = false;

  for await (const chunk of stream as AsyncIterable<string>) {
    buffer += chunk;

    for (;;) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) break;

      if (discardingOversizedLine) {
        // 破棄中だった巨大行の残り(終端)に到達した。この断片も破棄し、次の行から再開する。
        buffer = buffer.slice(newlineIndex + 1);
        discardingOversizedLine = false;
        continue;
      }

      if (newlineIndex > maxLineBytes) {
        // 改行はすぐ見つかったが、その1行自体がmaxLineBytesを超えている
        // (1回のチャンク読み込みに巨大な1行がまるごと収まったケース)。本文は保持せず破棄する。
        yield { kind: "oversized" };
        buffer = buffer.slice(newlineIndex + 1);
        continue;
      }

      const rawLine = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      yield { kind: "line", line: rawLine };
    }

    if (!discardingOversizedLine && buffer.length > maxLineBytes) {
      // 改行が見つからないまま閾値を超えた: 異常に長い1行とみなして破棄する。
      // バッファを溜め続けずここでリセットすることでピークメモリを抑える。
      yield { kind: "oversized" };
      buffer = "";
      discardingOversizedLine = true;
    }
  }

  // ファイル末尾に改行が無い最後の行(既にoversizedとして報告済みの行の残りなら何もしない)
  if (buffer.length > 0 && !discardingOversizedLine) {
    if (buffer.length > maxLineBytes) {
      yield { kind: "oversized" };
    } else {
      yield { kind: "line", line: buffer };
    }
  }
}
