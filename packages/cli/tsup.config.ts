import { createRequire } from "node:module";
import { defineConfig } from "tsup";

const require = createRequire(import.meta.url);
const pkg = require("./package.json") as { version: string };

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  format: ["esm"],
  target: "node18",
  platform: "node",
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false,
  shims: false,
  // ワークスペース内のパッケージ(@shibaita/core, @shibaita/schema)は
  // モノレポ外に公開する単一パッケージへ同梱(bundle)する。
  // picocolors / zod は通常のnpm依存としてそのまま外部参照させる。
  noExternal: [/^@shibaita\//],
  // src/index.ts に既に shebang があるため banner は付与しない(重複防止)。
  // package.json の version を唯一のソースとし、ビルド時にリテラル埋め込みする。
  // (src/version.ts 参照。開発実行時=tsxはこのdefineが効かないためフォールバックする)
  define: {
    __PKG_VERSION__: JSON.stringify(pkg.version),
  },
});
