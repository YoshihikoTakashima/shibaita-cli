import { defineConfig } from "tsup";

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
});
