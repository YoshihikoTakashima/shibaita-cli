import { afterEach, describe, expect, it, vi } from "vitest";
import type { SubmissionPayload } from "@shibaita/schema";
import {
  ApiError,
  SOURCE_BOUND_MESSAGE,
  SourceBoundError,
  claimPairing,
  pollDeviceFlow,
  submitUsage,
} from "../src/api.js";

/**
 * D-24(sourceId排他バインディング)の409応答ハンドリングを検証する。
 * サーバ(shibaita/web)の {error:"source_bound"} 応答を受けたら、
 * サーバのmessageではなくCLI固有の案内文言(SOURCE_BOUND_MESSAGE)でSourceBoundErrorを投げる。
 */
function sourceBoundResponse(): Response {
  return new Response(
    JSON.stringify({ error: "source_bound", message: "このPCは既に別のアカウントに連携されています" }),
    { status: 409, headers: { "Content-Type": "application/json" } },
  );
}

describe("claimPairing: sourceId送信とsource_bound処理", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sourceIdをリクエストボディに含める", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ deviceToken: "tok-1" }), { status: 200 }),
    );

    await claimPairing("ABCD1234", "https://shibaita.ai", "11111111-1111-4111-8111-111111111111");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://shibaita.ai/api/v1/pairing/claim",
      expect.objectContaining({
        body: JSON.stringify({ code: "ABCD1234", sourceId: "11111111-1111-4111-8111-111111111111" }),
      }),
    );
  });

  it("sourceId省略時はリクエストボディにsourceIdを含めない(後方互換)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ deviceToken: "tok-1" }), { status: 200 }),
    );

    await claimPairing("ABCD1234", "https://shibaita.ai");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://shibaita.ai/api/v1/pairing/claim",
      expect.objectContaining({ body: JSON.stringify({ code: "ABCD1234" }) }),
    );
  });

  it("409 source_bound はSourceBoundError(CLI固有の案内文言)を投げる", async () => {
    // fetchの呼び出しごとに新しいResponseを返す(Response.json()は1回しか読めないため)。
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => sourceBoundResponse());

    const error = await claimPairing("ABCD1234", "https://shibaita.ai", "src-1").catch((e) => e);
    expect(error).toBeInstanceOf(SourceBoundError);
    expect((error as Error).message).toBe(SOURCE_BOUND_MESSAGE);
  });
});

describe("pollDeviceFlow: sourceId送信とsource_bound処理", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sourceIdをリクエストボディに含める", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "pending" }), { status: 200 }),
    );

    await pollDeviceFlow("devicecode", "https://shibaita.ai", "src-1");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://shibaita.ai/api/v1/device/poll",
      expect.objectContaining({ body: JSON.stringify({ deviceCode: "devicecode", sourceId: "src-1" }) }),
    );
  });

  it("409 source_bound はSourceBoundErrorを投げる", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sourceBoundResponse());

    await expect(pollDeviceFlow("devicecode", "https://shibaita.ai", "src-1")).rejects.toThrow(
      SourceBoundError,
    );
  });
});

describe("submitUsage: source_bound処理", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const payload: SubmissionPayload = {
    adapterVersion: "1.0.0",
    clientVersion: "1.2.0",
    sourceId: "11111111-1111-4111-8111-111111111111",
    os: "macos",
    days: [
      {
        date: "2026-07-01",
        provider: "anthropic",
        product: "claude-code",
        model: "claude-opus",
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        requestCount: 1,
        messageCount: 1,
      },
    ],
  };

  it("409 source_bound はSourceBoundError(CLI固有の案内文言)を投げる", async () => {
    // fetchの呼び出しごとに新しいResponseを返す(Response.json()は1回しか読めないため)。
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => sourceBoundResponse());

    const error = await submitUsage(payload, "device-token", "https://shibaita.ai").catch((e) => e);
    expect(error).toBeInstanceOf(SourceBoundError);
    expect((error as Error).message).toBe(SOURCE_BOUND_MESSAGE);
  });

  it("409だがsource_bound以外の場合は通常のApiError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "something_else" }), { status: 409 }),
    );

    const error = await submitUsage(payload, "device-token", "https://shibaita.ai").catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).not.toBeInstanceOf(SourceBoundError);
  });
});
