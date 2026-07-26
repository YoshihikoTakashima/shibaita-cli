import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSubmit } from "../src/commands/submit.js";

let tempDir: string;
let originalConfigDir: string | undefined;
let originalHome: string | undefined;
let originalCodexHome: string | undefined;

/**
 * submit --dry-run のマルチプロバイダ(Claude Code + Codex)スナップショットテスト。
 * 両アダプタのログが存在する場合に、送信予定payload.daysへ
 * provider:"anthropic"(claude-code) と provider:"openai"(codex) の両方が
 * 含まれることを検証する(通信なし)。
 */
describe("submit --dry-run (マルチプロバイダ)", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "shibaita-dry-run-multi-"));

    const today = new Date();
    const y = today.getFullYear();
    const mo = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");

    // --- Claude Code側フィクスチャ ---
    const projectDir = join(tempDir, "projects", "fake-project");
    await mkdir(projectDir, { recursive: true });
    const claudeIso = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 0, 0).toISOString();
    const claudeLine = JSON.stringify({
      type: "assistant",
      timestamp: claudeIso,
      requestId: "req-multi-1",
      message: {
        id: "msg-multi-1",
        model: "claude-opus-4",
        usage: {
          input_tokens: 1000,
          output_tokens: 200,
          cache_read_input_tokens: 50,
          cache_creation_input_tokens: 10,
        },
      },
    });
    await writeFile(join(projectDir, "session.jsonl"), `${claudeLine}\n`, "utf-8");

    // --- Codex側フィクスチャ(実端末の~/.codexログ実地調査に基づく実フォーマット) ---
    const codexDayDir = join(tempDir, ".codex", "sessions", y.toString(), mo, d);
    await mkdir(codexDayDir, { recursive: true });
    const codexIso = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 30, 0).toISOString();
    const codexLines = [
      JSON.stringify({
        timestamp: codexIso,
        type: "session_meta",
        payload: { session_id: "sess-multi-1", id: "sess-multi-1" },
      }),
      JSON.stringify({
        timestamp: codexIso,
        type: "turn_context",
        payload: { turn_id: "turn-1", model: "gpt-5.5" },
      }),
      JSON.stringify({
        timestamp: codexIso,
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 500,
              cached_input_tokens: 100,
              output_tokens: 80,
              reasoning_output_tokens: 10,
              total_tokens: 580,
            },
          },
          rate_limits: { rate_limit_reached_type: null },
        },
      }),
    ];
    await writeFile(
      join(codexDayDir, `rollout-${y}-${mo}-${d}T09-30-00-testmulti1.jsonl`),
      `${codexLines.join("\n")}\n`,
      "utf-8",
    );

    originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
    originalHome = process.env.HOME;
    originalCodexHome = process.env.CODEX_HOME;
    process.env.CLAUDE_CONFIG_DIR = tempDir;
    process.env.HOME = tempDir;
    delete process.env.CODEX_HOME;
  });

  afterEach(async () => {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
    process.env.HOME = originalHome;
    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodexHome;
    }
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("payload.daysにprovider:anthropicとprovider:openaiの両方が含まれる", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg: string) => {
      logs.push(msg);
    });

    const exitCode = await runSubmit(["--dry-run"]);
    expect(exitCode).toBe(0);

    const jsonOutput = logs.find((l) => l.trim().startsWith("{"));
    expect(jsonOutput).toBeDefined();
    const payload = JSON.parse(jsonOutput!);

    expect(payload.days).toHaveLength(2);

    const anthropicDay = payload.days.find((d: { provider: string }) => d.provider === "anthropic");
    const openaiDay = payload.days.find((d: { provider: string }) => d.provider === "openai");

    expect(anthropicDay).toMatchObject({
      provider: "anthropic",
      product: "claude-code",
      model: "claude-opus-4",
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 50,
      cacheWriteTokens: 10,
    });

    expect(openaiDay).toMatchObject({
      provider: "openai",
      product: "codex",
      model: "gpt-5.5",
      // input_tokens(500) - cached_input_tokens(100)
      inputTokens: 400,
      outputTokens: 80,
      cacheReadTokens: 100,
      cacheWriteTokens: 0,
    });

    // Codex側の整合性チェック: input+cacheRead+outputがtotal_tokens(580)と一致する
    expect(openaiDay.inputTokens + openaiDay.cacheReadTokens + openaiDay.outputTokens).toBe(580);
  });
});
