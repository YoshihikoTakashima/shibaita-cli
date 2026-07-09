import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const claimPairingMock = vi.fn();
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
    claimPairing: (...args: unknown[]) => claimPairingMock(...args),
  };
});

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

const { runPair } = await import("../src/commands/pair.js");
const { SourceBoundError } = await import("../src/api.js");

describe("runPair", () => {
  beforeEach(() => {
    claimPairingMock.mockReset();
    readStateMock.mockReset().mockResolvedValue({});
    writeStateMock.mockReset().mockResolvedValue(undefined);
    getOrCreateSourceIdMock.mockReset().mockResolvedValue(FAKE_SOURCE_ID);
    getPrimaryLogRootMock.mockReset().mockReturnValue("/tmp/fake-claude-root");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("コード未指定はエラー終了する(exit code 1)", async () => {
    const exitCode = await runPair([]);
    expect(exitCode).toBe(1);
    expect(claimPairingMock).not.toHaveBeenCalled();
  });

  it("成功時はdeviceTokenを保存し、claim/pollリクエストにsourceIdを含める", async () => {
    claimPairingMock.mockResolvedValue({ deviceToken: "tok-abc" });

    const exitCode = await runPair(["ABCD1234"]);

    expect(exitCode).toBe(0);
    // D-24: sourceId排他バインディング用に、claimリクエストへsourceIdを含める。
    expect(claimPairingMock).toHaveBeenCalledWith("ABCD1234", "https://shibaita.ai", FAKE_SOURCE_ID);
    expect(writeStateMock).toHaveBeenCalledWith(expect.objectContaining({ deviceToken: "tok-abc" }));
  });

  it("SourceBoundError受信時は専用の案内文言をそのまま表示する(exit code 1)", async () => {
    claimPairingMock.mockRejectedValue(new SourceBoundError());
    const errorSpy = vi.spyOn(console, "error");

    const exitCode = await runPair(["ABCD1234"]);

    expect(exitCode).toBe(1);
    expect(writeStateMock).not.toHaveBeenCalled();
    const printed = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("このPC(ログフォルダ)は既に別のアカウントに連携されています");
    // 通常のラップ文言("ペアリングに失敗しました。(...)")は付与しない。
    expect(printed).not.toContain("ペアリングに失敗しました。(このPC");
  });

  it("それ以外のエラーは従来通りラップして表示する(exit code 1)", async () => {
    claimPairingMock.mockRejectedValue(new Error("network down"));
    const errorSpy = vi.spyOn(console, "error");

    const exitCode = await runPair(["ABCD1234"]);

    expect(exitCode).toBe(1);
    const printed = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("ペアリングに失敗しました。(network down)");
  });
});
