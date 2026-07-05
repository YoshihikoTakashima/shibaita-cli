import { createRequire } from "node:module";

/**
 * CLIのバージョンの唯一のソースは packages/cli/package.json の "version" フィールド。
 *
 * - ビルド後(tsup): tsup.config.ts の `define` により `__PKG_VERSION__` が
 *   ビルド時点の package.json version にリテラル置換される。
 * - 開発実行時(tsx等、`__PKG_VERSION__` が未置換のまま残る場合): `createRequire` で
 *   package.json を直接読み込むフォールバックを使う。
 *
 * これにより「バージョン文字列を手書きする箇所」をコードベースからなくす。
 */

declare const __PKG_VERSION__: string;

function readVersionFromPackageJson(): string {
  const require = createRequire(import.meta.url);
  const pkg = require("../package.json") as { version: string };
  return pkg.version;
}

export function getPackageVersion(): string {
  if (typeof __PKG_VERSION__ === "string" && __PKG_VERSION__ !== "__PKG_VERSION__") {
    return __PKG_VERSION__;
  }
  return readVersionFromPackageJson();
}
