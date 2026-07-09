import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pc from "picocolors";
import { getPackageVersion } from "../version.js";

/**
 * `shibaita install-skill` : Claude Code用スキルを ~/.claude/skills/shibaita/SKILL.md に書き込む。
 * これによりClaude Code内から「/shibaita」や「今日のしばき量見せて」で操作できる。
 *
 * 重要: スキル文面はD-19(送信は明示的なユーザー同意時のみ)をスキル経由でも守るよう、
 * 「送信前に必ずユーザーへ確認」をClaudeへの指示として埋め込む。
 */

interface InstallSkillOptions {
  apiUrl?: string;
}

export function parseInstallSkillArgs(args: string[]): InstallSkillOptions {
  const options: InstallSkillOptions = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--api-url") {
      const value = args[i + 1];
      if (value) options.apiUrl = value;
      i++;
    }
  }
  return options;
}

/**
 * npmパッケージとして実行されている場合の起動コマンド。
 * `packages/cli/package.json` の version を唯一のソースとしてバージョンを固定する
 * (npx は既定でキャッシュ済みバージョンを再利用しうるため、明示指定で再現性を保つ)。
 * 将来のCLI更新を反映したい場合は、ユーザーが `install-skill` を再実行する運用とする。
 */
export function resolvePublishedCliInvocation(version: string = getPackageVersion()): string {
  return `npx -y shibaita@${version}`;
}

/**
 * このCLIの起動コマンドを決める。
 * - 開発リポジトリからtsx実行されている場合: 絶対パス付きの `npx tsx <path>` を埋め込む
 * - npmパッケージとして実行されている場合: `npx -y shibaita@<version>`
 */
export function resolveCliInvocation(): string {
  const selfPath = fileURLToPath(import.meta.url);
  // 開発時は .../packages/cli/src/commands/install-skill.ts にいる
  if (selfPath.includes(`${join("packages", "cli", "src")}`)) {
    const entry = resolve(dirname(selfPath), "..", "index.ts");
    return `npx tsx ${entry}`;
  }
  return resolvePublishedCliInvocation();
}

export function buildSkillMarkdown(cli: string, apiUrl?: string): string {
  const envPrefix = apiUrl ? `SHIBAITA_API_URL=${apiUrl} ` : "";
  return `---
name: shibaita
description: Claude Codeのしばき量(トークン利用量)をローカル集計して表示し、ユーザーの明示的な同意があるときだけ shibaita.ai に送信する。「しばき量」「しばいた」「shibaita」「トークン使用量を晒す」などの話題で使う。
---

# AIしばいたった。(shibaita.ai) スキル

あなたはshibaita CLIのオペレーターです。以下を厳守してください。

## コマンド(Bashツールで実行)

- ローカル集計の表示(通信なし): \`${envPrefix}${cli} inspect --days 30\`
- 送信内容のプレビュー(通信なし): \`${envPrefix}${cli} submit --dry-run\`
- 送信(必ずユーザー同意の後): \`${envPrefix}${cli} submit --yes\`
- ブラウザ連携(未ペアリング時。ブラウザが自動で開く): \`${envPrefix}${cli} login\`
- ペアリング(スマホでコードを発行した場合): \`${envPrefix}${cli} pair <code>\`

## 手順

1. ユーザーが「見たい」だけなら inspect を実行し、今月合計・直近の日別・モデル別を簡潔に要約する。**送信はしない。**
2. ユーザーが「送信したい / ランキングに載せたい / 晒したい」場合:
   a. まず inspect または submit --dry-run で日別サマリを見せる
   b. 送信先とあわせて「この集計値を送信しますか?」と**必ずユーザーに確認する**
   c. ユーザーが明示的に同意した場合のみ \`submit --yes\` を実行する
3. 未ペアリングのエラーが出たら: \`${envPrefix}${cli} login\` を実行するよう案内する(ブラウザが自動で開き、表示されたコードで承認するだけで連携できる。スマホで発行したコードがある場合は \`pair <code>\` も使える)。
4. 送信成功後はプロフィールURLを伝える。X投稿はユーザー自身が行う(intentリンクはマイページにある)。

## 禁止事項

- ユーザーの明示的な依頼・同意なしに submit を実行すること(スキルが呼ばれただけでは同意ではない)
- 会話ログ・ファイルパス・コードの内容を送信・表示に含めること(CLIは日別の集計数値のみを扱う)
- 「正確な利用量」「公式」などと表現すること(ローカルログ由来の参考値である)

## 補足

- 上記コマンドのCLIバージョンはインストール時点のもので固定されています。新しいバージョンを使うには \`npx shibaita install-skill\` を再実行してください。
`;
}

export async function runInstallSkill(args: string[]): Promise<number> {
  const options = parseInstallSkillArgs(args);
  const cli = resolveCliInvocation();
  const skillDir = join(homedir(), ".claude", "skills", "shibaita");
  const skillPath = join(skillDir, "SKILL.md");

  await mkdir(skillDir, { recursive: true });
  await writeFile(skillPath, buildSkillMarkdown(cli, options.apiUrl), "utf-8");

  console.log(pc.green("Claude Code用スキルをインストールしました:"));
  console.log(`  ${skillPath}`);
  console.log();
  console.log("新しいClaude Codeセッションで、次のように使えます:");
  console.log(pc.cyan("  /shibaita"));
  console.log(pc.cyan("  「今日どれだけしばいたか見せて」"));
  console.log(pc.cyan("  「今月のしばき量をランキングに送信して」(送信前に確認されます)"));
  return 0;
}
