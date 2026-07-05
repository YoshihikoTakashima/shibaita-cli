# プライバシー(shibaita CLI)

本ドキュメントは、公開リポジトリ `shibaita/cli`(このコード)が何を読み、何を送信し、
何を送信しないかを説明します。本サービスは Anthropic PBC とは無関係の非公式サービスです。

## 読むもの(ローカル)

- `CLAUDE_CONFIG_DIR` 環境変数で指定されたディレクトリ、`~/.claude/projects`、
  `~/.claude/transcripts`、`~/.config/claude/projects`(後方互換)配下の `*.jsonl` ファイル。
- 各行のうち `type: "assistant"` かつ `message.usage` を含む行の以下フィールドのみ:
  `message.id`, `message.model`, `requestId`, `timestamp`,
  `message.usage.input_tokens` / `output_tokens` / `cache_read_input_tokens` /
  `cache_creation_input_tokens`。
- **credentials系ファイル(認証情報・OAuthトークンを含むファイル)には一切アクセスしません。**

## 送るもの(サーバーへの送信は `submit` 実行時のみ)

`npx shibaita submit` を実行し、確認プロンプトで明示的に承諾した場合にのみ、以下の
日別×モデル別の集計値を送信します(`packages/schema` の公開zodスキーマが正)。

- `date`(YYYY-MM-DD、送信時点でタイムゾーン情報は含めない)
- `provider`("anthropic"固定), `product`("claude-code"固定)
- `model`(モデル名文字列)
- `inputTokens` / `outputTokens` / `cacheReadTokens` / `cacheWriteTokens`(トークン数の合計値)
- `requestCount`(distinct requestId数) / `messageCount`(dedup後エントリ数)

送信されるオブジェクトは、`DailyUsage` から**フィールドを1つずつ明示的に写す
allowlist方式**で構築され、送信直前に公開zodスキーマで `strict()` 検証されます。
スキーマにないキーが含まれる場合、送信は中止されます。

- `sourceId`(ランダムUUID): ログフォルダに識別用IDファイル(`.shibaita-source-id`、
  ランダムUUIDのみ)を1つ作成します。複数PCでログを同期している場合の二重計上を
  防ぐためです。ホスト名・OSユーザー名・MACアドレス等、端末やユーザーを特定できる
  情報は一切含まれません。

ペアリング(`shibaita pair <code>`)実行時は、コード文字列のみをサーバーに送信し、
device tokenを受け取ってローカルの `~/.config/shibaita/state.json`(パーミッション0600)
に保存します。

## 送らないもの

- プロンプト本文・Claudeの出力本文
- ソースコード・ファイルパス・プロジェクト名
- 会話ログ全般
- 環境変数、APIキー、認証情報(OAuthトークン等)
- ホスト名、OSユーザー名、端末識別子
- MCPサーバー名等の環境構成情報

## 送信は明示実行時のみ

- CLIをインストール・実行しただけでは何も送信されません。
- `npx shibaita`(引数なし)、`npx shibaita inspect`、`npx shibaita submit --dry-run`、
  `npx shibaita logout` は**通信を一切行いません**。
- 自動送信・バックグラウンド送信・OSスケジューラへの登録は実装していません。
- データが送信されるのは `npx shibaita submit` を実行し、送信内容のプレビュー表示後に
  `y` で確認した場合のみです(`--yes` オプションで確認プロンプトを省略できますが、
  それでも `submit` コマンドの明示実行が前提です)。

## 透明性のための仕組み

- `--dry-run`: 送信予定のJSONをそのまま表示し、送信は行いません。
- ログ解析・集計・送信スキーマはすべて公開ソースコードです(このリポジトリ)。
- [AUDIT_PROMPT.md](./AUDIT_PROMPT.md): 任意のAIにソースコードを貼り付けて監査できる
  プロンプトを用意しています。
