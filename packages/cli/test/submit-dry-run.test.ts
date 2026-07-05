import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSubmit } from "../src/commands/submit.js";

let tempDir: string;
let originalConfigDir: string | undefined;
let originalHome: string | undefined;

/**
 * submit --dry-run のスナップショットテスト。
 * 固定fixture(架空データ、当日基準で組み立てた1日分の正常ログ)をCLAUDE_CONFIG_DIRで隔離した
 * 一時ディレクトリに配置し、通信なしでJSON整形出力されることを検証する。
 */
describe("submit --dry-run", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "shibaita-dry-run-"));
    const projectDir = join(tempDir, "projects", "fake-project");
    await mkdir(projectDir, { recursive: true });

    const today = new Date();
    const iso = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 0, 0).toISOString();

    const line = JSON.stringify({
      type: "assistant",
      timestamp: iso,
      requestId: "req-fixture-1",
      message: {
        id: "msg-fixture-1",
        model: "claude-opus-4",
        usage: {
          input_tokens: 1000,
          output_tokens: 200,
          cache_read_input_tokens: 50,
          cache_creation_input_tokens: 10,
        },
      },
    });

    await writeFile(join(projectDir, "session.jsonl"), `${line}\n`, "utf-8");

    originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
    originalHome = process.env.HOME;
    // 実マシンの ~/.claude 等を探索対象から外し、フィクスチャのみを対象にする
    process.env.CLAUDE_CONFIG_DIR = tempDir;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
    process.env.HOME = originalHome;
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("整形されたJSONペイロードを表示し、通信を行わない", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg: string) => {
      logs.push(msg);
    });

    const exitCode = await runSubmit(["--dry-run"]);

    expect(exitCode).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();

    const jsonOutput = logs.find((l) => l.trim().startsWith("{"));
    expect(jsonOutput).toBeDefined();

    const payload = JSON.parse(jsonOutput!);
    expect(payload).toMatchObject({
      adapterVersion: expect.any(String),
      clientVersion: expect.any(String),
      sourceId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
      days: [
        {
          provider: "anthropic",
          product: "claude-code",
          model: "claude-opus-4",
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadTokens: 50,
          cacheWriteTokens: 10,
          requestCount: 1,
          messageCount: 1,
        },
      ],
    });
    expect(Object.keys(payload).sort()).toEqual(["adapterVersion", "clientVersion", "days", "sourceId"].sort());
    expect(Object.keys(payload.days[0]).sort()).toEqual(
      [
        "cacheReadTokens",
        "cacheWriteTokens",
        "date",
        "inputTokens",
        "messageCount",
        "model",
        "outputTokens",
        "product",
        "provider",
        "requestCount",
      ].sort(),
    );
  });
});
