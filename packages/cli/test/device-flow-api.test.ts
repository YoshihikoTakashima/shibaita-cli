import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, pollDeviceFlow, startDeviceFlow } from "../src/api.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("startDeviceFlow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POST /api/v1/device/start を呼び、deviceCode/userCode/verificationUrlを返す", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        deviceCode: "a".repeat(64),
        userCode: "ABCD1234",
        verificationUrl: "https://shibaita.ai/link?c=ABCD1234",
      }),
    );

    const result = await startDeviceFlow("https://shibaita.ai");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://shibaita.ai/api/v1/device/start",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toEqual({
      deviceCode: "a".repeat(64),
      userCode: "ABCD1234",
      verificationUrl: "https://shibaita.ai/link?c=ABCD1234",
    });
  });

  it("応答が不正な形の場合はApiErrorを投げる", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ userCode: "ABCD1234" }));
    await expect(startDeviceFlow("https://shibaita.ai")).rejects.toThrow(ApiError);
  });

  it("HTTPエラー応答はApiErrorを投げる", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: "oops" }, 500));
    await expect(startDeviceFlow("https://shibaita.ai")).rejects.toThrow(ApiError);
  });
});

describe("pollDeviceFlow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pending状態を返す", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ status: "pending" }));
    const result = await pollDeviceFlow("devicecode", "https://shibaita.ai");
    expect(result).toEqual({ status: "pending" });
  });

  it("approved状態はdeviceTokenを伴って返す", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ status: "approved", deviceToken: "tok-123" }),
    );
    const result = await pollDeviceFlow("devicecode", "https://shibaita.ai");
    expect(result).toEqual({ status: "approved", deviceToken: "tok-123" });
  });

  it("410(expired)は正常系として扱う", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ status: "expired" }, 410));
    const result = await pollDeviceFlow("devicecode", "https://shibaita.ai");
    expect(result).toEqual({ status: "expired" });
  });

  it("approvedなのにdeviceTokenが無い応答はApiErrorを投げる", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ status: "approved" }));
    await expect(pollDeviceFlow("devicecode", "https://shibaita.ai")).rejects.toThrow(ApiError);
  });

  it("想定外のHTTPステータスはApiErrorを投げる", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: "oops" }, 500));
    await expect(pollDeviceFlow("devicecode", "https://shibaita.ai")).rejects.toThrow(ApiError);
  });
});
