# shibaita CLI

Claude Code のローカル利用ログ(`~/.claude/projects/**/*.jsonl` 等)を解析し、
「しばき量」(トークン使用量の合計)をローカルで集計するCLIです。

本サービスは Anthropic PBC とは無関係の非公式サービスです。Claude™ は Anthropic PBC の商標です。

## 使い方

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

`install-skill` を1回実行すると、新しいClaude Codeセッションから「今日どれだけしばいた?」
「今月のしばき量をランキングに送信して」と話しかけるだけで操作できます。
スキル経由でも、サーバーへの送信前には必ず確認が入ります(勝手に送信されることはありません)。

`npx shibaita inspect` と `npx shibaita submit --dry-run` は一切の通信を行いません。
サーバーへデータが送信されるのは `npx shibaita submit` を実行し、確認プロンプトで `y` を
入力した場合のみです。

## 送るもの・送らないもの

詳細は [PRIVACY.md](./PRIVACY.md) を参照してください。送信されるのは日付・モデル名・
トークン数の集計値のみです。プロンプト本文・出力本文・ソースコード・ファイルパス・
プロジェクト名・環境変数・認証情報などは一切収集・送信しません。

`submit` 実行時、ログフォルダに識別用IDファイル(`.shibaita-source-id`、ランダムUUIDの
み)を1つ作成します。複数PCでログを同期している場合の二重計上を防ぐためです。

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

## Acknowledgements

本CLIのログ解析・集計ロジック(ストリーミング途中スナップショットのフィールド別maxマージに
よるdedup手法など)は、[tokscale](https://github.com/tokscale/tokscale) および
[ccusage](https://github.com/ryoppippi/ccusage) の設計・知見を参考にしています。
コードの流用はなく、TypeScriptで新規実装しています。

## ライセンス

MIT License. See [LICENSE](./LICENSE).
