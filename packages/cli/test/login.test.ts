import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const startDeviceFlowMock = vi.fn();
const pollDeviceFlowMock = vi.fn();
const openInBrowserMock = vi.fn();
const readStateMock = vi.fn();
const writeStateMock = vi.fn();
const getOrCreateSourceIdMock = vi.fn();
const getPrimaryLogRootMock = vi.fn();

const FAKE_SOURCE_ID = "11111111-1111-4111-8111-111111111111";

// 実ファイルシステム(~/.claude等)に触れないよう、sourceId取得はモックで固定する。
// (afterEachのvi.restoreAllMocks()はvi.mockファクトリ内のvi.fn()もリセットするため、
//  トップレベルの参照を経由してbeforeEachで都度再設定する。)
vi.mock("@shibaita/core", () => ({
  getOrCreateSourceId: (...args: unknown[]) => getOrCreateSourceIdMock(...args),
  getPrimaryLogRoot: (...args: unknown[]) => getPrimaryLogRootMock(...args),
}));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>("../src/api.js");
  return {
    ...actual,
    getApiUrl: () => "https://shibaita.ai",
    startDeviceFlow: (...args: unknown[]) => startDeviceFlowMock(...args),
    pollDeviceFlow: (...args: unknown[]) => pollDeviceFlowMock(...args),
  };
});

vi.mock("../src/browser-open.js", () => ({
  openInBrowser: (...args: unknown[]) => openInBrowserMock(...args),
}));

vi.mock("../src/state.js", () => ({
  readState: (...args: unknown[]) => readStateMock(...args),
  writeState: (...args: unknown[]) => writeStateMock(...args),
  createStateFallback: (state: { fallbackSourceId?: string }) => ({
    async read() {
      return state.fallbackSourceId;
    },
    async write(sourceId: string) {
      state.fallbackSourceId = sourceId;
      await writeStateMock(state);
    },
  }),
}));

const { runLogin } = await import("../src/commands/login.js");
const { ApiError } = await import("../src/api.js");

describe("runLogin", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    startDeviceFlowMock.mockReset();
    pollDeviceFlowMock.mockReset();
    openInBrowserMock.mockReset();
    readStateMock.mockReset().mockResolvedValue({});
    writeStateMock.mockReset().mockResolvedValue(undefined);
    getOrCreateSourceIdMock.mockReset().mockResolvedValue(FAKE_SOURCE_ID);
    getPrimaryLogRootMock.mockReset().mockReturnValue("/tmp/fake-claude-root");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("承認されたらdevice tokenを保存し、サーバ応答のverificationUrlではなく自前組立URLを開く", async () => {
    startDeviceFlowMock.mockResolvedValue({
      deviceCode: "d".repeat(64),
      userCode: "ABCD1234",
      // わざと不審な値を混ぜる。ここが使われないことを検証する。
      verificationUrl: "https://evil.example.com/should-not-be-used",
    });
    pollDeviceFlowMock.mockResolvedValue({ status: "approved", deviceToken: "tok-abc" });

    const promise = runLogin();
    await vi.advanceTimersByTimeAsync(3000);
    const exitCode = await promise;

    expect(exitCode).toBe(0);
    expect(openInBrowserMock).toHaveBeenCalledWith("https://shibaita.ai/link?c=ABCD1234");
    expect(writeStateMock).toHaveBeenCalledWith(
      expect.objectContaining({ deviceToken: "tok-abc" }),
    );
    // D-24: sourceId排他バインディング用に、pollリクエストへsourceIdを含める。
    expect(pollDeviceFlowMock).toHaveBeenCalledWith(
      "d".repeat(64),
      "https://shibaita.ai",
      FAKE_SOURCE_ID,
    );
  });

  it("pendingの間はポーリングを継続し、expiredでエラー終了する(exit code 1)", async () => {
    startDeviceFlowMock.mockResolvedValue({
      deviceCode: "d".repeat(64),
      userCode: "ABCD1234",
      verificationUrl: "https://shibaita.ai/link?c=ABCD1234",
    });
    pollDeviceFlowMock
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "expired" });

    const promise = runLogin();
    await vi.advanceTimersByTimeAsync(3000 * 3);
    const exitCode = await promise;

    expect(exitCode).toBe(1);
    expect(pollDeviceFlowMock).toHaveBeenCalledTimes(3);
    expect(writeStateMock).not.toHaveBeenCalled();
  });

  it("開始リクエストが失敗したらエラー終了する(exit code 1)", async () => {
    startDeviceFlowMock.mockRejectedValue(new ApiError("通信に失敗しました: network down"));

    const exitCode = await runLogin();

    expect(exitCode).toBe(1);
    expect(openInBrowserMock).not.toHaveBeenCalled();
  });

  it("ポーリング中にApiErrorが発生したらエラー終了する(exit code 1)", async () => {
    startDeviceFlowMock.mockResolvedValue({
      deviceCode: "d".repeat(64),
      userCode: "ABCD1234",
      verificationUrl: "https://shibaita.ai/link?c=ABCD1234",
    });
    pollDeviceFlowMock.mockRejectedValue(new ApiError("ポーリングに失敗しました (HTTP 500)", 500));

    const promise = runLogin();
    await vi.advanceTimersByTimeAsync(3000);
    const exitCode = await promise;

    expect(exitCode).toBe(1);
  });
});
