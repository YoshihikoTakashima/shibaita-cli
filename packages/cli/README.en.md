English | [日本語](./README.md)

# shibaita CLI

A CLI that parses your local Claude Code usage logs (`~/.claude/projects/**/*.jsonl`, etc.)
and aggregates your "Shibaki volume" (total tokens) — entirely on your machine.

This is an unofficial service and is not affiliated with Anthropic PBC. Claude™ is a trademark of Anthropic PBC.

## Usage

Every command can be run from **any directory**. This CLI reads your Claude Code logs
under your home directory (`~/.claude`), so it works regardless of which project you
currently have open.

```bash
# Total Shibaki volume for this month + a bar chart for the last 7 days
npx shibaita

# Detailed per-day, per-model breakdown (no network access)
npx shibaita inspect
npx shibaita inspect --days 60

# Start here: opens your browser automatically; just approve the code shown to link this PC
npx shibaita login

# Preview the JSON that would be submitted, without sending anything (no network access)
npx shibaita submit --dry-run

# Submit the aggregated results (asks for confirmation before sending)
npx shibaita submit
npx shibaita submit --yes      # skip the confirmation prompt
npx shibaita submit --days 30  # change the aggregation period

# Remove local registration data
npx shibaita logout

# Install the Claude Code skill (lets you drive this CLI from inside Claude Code via "/shibaita")
npx shibaita install-skill
```

If you already have a pairing code issued from your phone (via `/pair`), you can use this instead:

```bash
npx shibaita pair XXXXXXXX
```

### Using it from Claude Code

Run `npx shibaita install-skill` **once, from any directory**. It installs a personal
skill named "shibaita" (a single Markdown file, usable across all your projects) at
`~/.claude/skills/shibaita/SKILL.md`.

From then on, in any new Claude Code session, just type `/shibaita`, or say things like
"How much did I shibaku today?" or "Submit this month's Shibaki volume to the ranking,"
and Claude will run this CLI on your behalf. The skill itself is nothing more than a
text file describing the commands above — and even through the skill, **you are always
asked to confirm before anything is sent to the server** (nothing is ever submitted
automatically). If you no longer want it, just delete `~/.claude/skills/shibaita/`.

`npx shibaita inspect` and `npx shibaita submit --dry-run` never perform any network
communication. Data is only sent to the server when you run `npx shibaita submit` and
answer `y` at the confirmation prompt.

The CLI invocation embedded in the skill is pinned to the version installed at the time.
After updating the CLI, re-run `npx shibaita install-skill`.

## What we send, and what we don't

See [PRIVACY.md](./PRIVACY.md) for details. We parse each JSONL line in your log files.
The only fields used for aggregation, submission, storage, or display are usage-related
fields such as date, model name, and token counts. We never send, store, or display
prompt text, output text, source code, file paths, environment variables, or credentials.

When you run `submit`, we create a single identifier file (`.shibaita-source-id`,
containing only a random UUID) in your log folder. This exists solely to prevent
double-counting when your logs are synced across multiple machines.
We also send the source OS type (one of `macos`/`windows`/`linux`/`other` only —
never the hostname or machine name) for the per-device breakdown shown on your page.
In addition, if any rate-limit hits occurred in the covered period, we send the
number of times you hit a rate limit, per day only — we never read or store the
contents of the `rateLimits` field itself.

## Monorepo layout

```text
cli/
├── packages/core    # Log parsing + aggregation. Pure functions only, no network code
├── packages/schema   # zod schema for the submitted JSON (the public contract)
└── packages/cli      # The bin itself. UI/confirmation prompts/submission (fetch is used only in api.ts)
```

## Development

```bash
npm install
npm test
npm run typecheck
npx tsx packages/cli/src/index.ts inspect
```

## Security & audit-related documents

- [SECURITY.md](./SECURITY.md): Vulnerability reporting contact and response policy
- [PRIVACY.md](./PRIVACY.md): What we read / what we send / what we don't send
- [THREAT_MODEL.md](./THREAT_MODEL.md): Trust boundaries and residual risks
- [AUDIT_PROMPT.md](./AUDIT_PROMPT.md): A prompt users can paste alongside the source into any AI to audit it

## Acknowledgements / Prior Art

This CLI's log-parsing and aggregation logic (including the dedup technique of
per-field max-merging across streaming intermediate snapshots) draws on the design and
insights of [tokscale](https://github.com/junhoyeo/tokscale) and
[ccusage](https://github.com/ryoppippi/ccusage). No code was copied; everything here is
a fresh implementation in TypeScript.

### Why not a fork?

[tokscale](https://github.com/junhoyeo/tokscale) is a wonderful project, but we chose to
reimplement it from scratch in TypeScript rather than fork it. The core value of this
CLI is "small, readable code." By keeping the entire codebase to a few thousand lines of
TypeScript and confining all network submission to a single file, we prioritized making
it possible for anyone — even by pasting it into an AI — to verify its safety. The
log-parsing insights, including the dedup technique, are drawn from the tokscale and
ccusage implementations. Our thanks to both projects.

## License

MIT License. See [LICENSE](./LICENSE).
