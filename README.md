[English](./README.en.md) | 日本語

# shibaita CLI

Claude Code のローカル利用ログ(`~/.claude/projects/**/*.jsonl` 等)を解析し、
「しばき量」(トークン使用量の合計)をローカルで集計するCLIです。

本サービスは Anthropic PBC とは無関係の非公式サービスです。Claude™ は Anthropic PBC の商標です。

## 使い方

すべてのコマンドは**どのディレクトリで実行しても構いません**。このCLIはあなたのホーム
ディレクトリ配下にあるClaude Codeのログ(`~/.claude`)を読むため、いま開いている
プロジェクトの場所とは無関係に動作します。

```bash
# 今月の合計しばき量+直近7日のバー表示
npx shibaita

# 日別・モデル別の詳細集計(通信なし)
npx shibaita inspect
npx shibaita inspect --days 60

# スマートフォンで発行したペアリングコードでデバイス登録
npx shibaita pair XXXXXXXX

# 送信予定のJSONを確認するだけ(通信なし)
npx shibaita submit --dry-run

# 集計結果を送信(送信前に確認プロンプトあり)
npx shibaita submit
npx shibaita submit --yes      # 確認をスキップ
npx shibaita submit --days 30  # 対象期間を変更

# ローカルの登録情報を削除
npx shibaita logout

# Claude Code用スキルをインストール(以後Claude Code内から「/shibaita」で操作可能)
npx shibaita install-skill
```

### Claude Codeから使う

`npx shibaita install-skill` を**どのディレクトリからでもよいので1回**実行してください。
あなたの `~/.claude/skills/shibaita/SKILL.md` に「shibaita」という個人スキル(全プロジェクト
共通で使えるMarkdownファイル1つ)がインストールされます。

以後、新しいClaude Codeセッションで `/shibaita` と打つか、「今日どれだけしばいた?」
「今月のしばき量をランキングに送信して」と話しかけるだけで、ClaudeがこのCLIを代わりに
実行してくれます。スキルの中身は上記コマンドの実行手順を書いたテキストだけで、
スキル経由でも**サーバーへの送信前には必ずあなたへの確認が入ります**(勝手に送信される
ことはありません)。不要になったら `~/.claude/skills/shibaita/` を削除すれば消えます。

`npx shibaita inspect` と `npx shibaita submit --dry-run` は一切の通信を行いません。
サーバーへデータが送信されるのは `npx shibaita submit` を実行し、確認プロンプトで `y` を
入力した場合のみです。

スキルに埋め込まれるCLIの起動コマンドはインストール時点のバージョンに固定されます。CLIを更新した後は `npx shibaita install-skill` を再実行してください。

## 送るもの・送らないもの

詳細は [PRIVACY.md](./PRIVACY.md) を参照してください。ログファイルの各JSONL行を
解析します。集計・送信・保存・表示に利用するのは、日付、モデル名、トークン数などの
利用量フィールドのみです。プロンプト本文、出力本文、ソースコード、ファイルパス、
環境変数、認証情報は送信・保存・表示しません。

`submit` 実行時、ログフォルダに識別用IDファイル(`.shibaita-source-id`、ランダムUUIDの
み)を1つ作成します。複数PCでログを同期している場合の二重計上を防ぐためです。
また、送信元の判別のためOS種別(`macos`/`windows`/`linux`/`other`の4値のみ。ホスト名・
マシン名は送りません)を送信します。

## モノレポ構成

```text
cli/
├── packages/core    # ログ解析+集計。純関数のみ、ネットワークコード不在
├── packages/schema   # 送信JSONのzodスキーマ(公開契約)
└── packages/cli      # bin本体。UI/確認プロンプト/送信(fetch使用はapi.tsのみ)
```

## 開発

```bash
npm install
npm test
npm run typecheck
npx tsx packages/cli/src/index.ts inspect
```

## セキュリティ・監査関連ドキュメント

- [SECURITY.md](./SECURITY.md): 脆弱性の報告窓口・対応方針
- [PRIVACY.md](./PRIVACY.md): 読むもの/送るもの/送らないもの
- [THREAT_MODEL.md](./THREAT_MODEL.md): 信頼境界と残存リスク
- [AUDIT_PROMPT.md](./AUDIT_PROMPT.md): 利用者が任意のAIにソースを貼って監査するためのプロンプト

## Acknowledgements / Prior Art

本CLIのログ解析・集計ロジック(ストリーミング途中スナップショットのフィールド別maxマージに
よるdedup手法など)は、[tokscale](https://github.com/junhoyeo/tokscale) および
[ccusage](https://github.com/ryoppippi/ccusage) の設計・知見を参考にしています。
コードの流用はなく、TypeScriptで新規実装しています。

### Why not a fork?

[tokscale](https://github.com/junhoyeo/tokscale) は素晴らしいプロジェクトですが、forkせずTypeScriptで新規実装しました。
本CLIの中核価値は「小さく読めるコード」だからです。全コードを数千行のTSに収め、ネットワーク送信を1ファイルに限定する
ことで、誰でも(AIに貼ってでも)安全性を検証できることを優先しました。dedup手法などのログ解析の知見はtokscale・ccusageの
実装を参考にしています。感謝します。

## ライセンス

MIT License. See [LICENSE](./LICENSE).
