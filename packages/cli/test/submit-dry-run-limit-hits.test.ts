import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSubmit } from "../src/commands/submit.js";

let tempDir: string;
let originalConfigDir: string | undefined;
let originalHome: string | undefined;

/**
 * submit --dry-run のレート制限ヒット(limitHits)スナップショットテスト。
 * error.rateLimitsを持つ行がある場合にpayload.limitHitsへ日別件数として含まれること、
 * 0件の場合はpayloadから省略されることを検証する(通信なし)。
 */
describe("submit --dry-run (limitHits)", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "shibaita-dry-run-limit-hits-"));
    const projectDir = join(tempDir, "projects", "fake-project");
    await mkdir(projectDir, { recursive: true });

    const today = new Date();
    const usageIso = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 0, 0).toISOString();
    const rateLimitIsoA = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      10,
      0,
      0,
    ).toISOString();
    const rateLimitIsoB = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      11,
      0,
      0,
    ).toISOString();

    const usageLine = JSON.stringify({
      type: "assistant",
      timestamp: usageIso,
      requestId: "req-limit-hits-1",
      message: {
        id: "msg-limit-hits-1",
        model: "claude-opus-4",
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    });

    const rateLimitLineA = JSON.stringify({
      type: "system",
      subtype: "api_error",
      timestamp: rateLimitIsoA,
      uuid: "evt-limit-hits-a",
      error: { type: "rate_limit_error", rateLimits: { resetsAt: rateLimitIsoA } },
    });
    const rateLimitLineB = JSON.stringify({
      type: "system",
      subtype: "api_error",
      timestamp: rateLimitIsoB,
      uuid: "evt-limit-hits-b",
      error: { type: "rate_limit_error", rateLimits: { resetsAt: rateLimitIsoB } },
    });

    await writeFile(
      join(projectDir, "session.jsonl"),
      `${usageLine}\n${rateLimitLineA}\n${rateLimitLineB}\n`,
      "utf-8",
    );

    originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
    originalHome = process.env.HOME;
    process.env.CLAUDE_CONFIG_DIR = tempDir;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
    process.env.HOME = originalHome;
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("レート制限ヒットがある日はpayload.limitHitsに日別件数として含まれる", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg: string) => {
      logs.push(msg);
    });

    const exitCode = await runSubmit(["--dry-run"]);
    expect(exitCode).toBe(0);

    const jsonOutput = logs.find((l) => l.trim().startsWith("{"));
    expect(jsonOutput).toBeDefined();
    const payload = JSON.parse(jsonOutput!);

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate(),
    ).padStart(2, "0")}`;

    expect(payload.limitHits).toEqual([{ date: todayStr, count: 2 }]);
    // rateLimitsの中身(resetsAt等)は一切含まれない
    expect(Object.keys(payload.limitHits[0]).sort()).toEqual(["count", "date"]);
  });
});
