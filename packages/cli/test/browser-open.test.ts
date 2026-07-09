import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const { openInBrowser } = await import("../src/browser-open.js");

function fakeChild() {
  const ee = new EventEmitter() as EventEmitter & { unref: () => void };
  ee.unref = vi.fn();
  return ee;
}

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value: platform });
}

describe("openInBrowser", () => {
  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    spawnMock.mockReset();
  });

  it("darwin: `open <url>` を引数配列・shell:falseで呼び出す", () => {
    setPlatform("darwin");
    spawnMock.mockReturnValue(fakeChild());

    openInBrowser("https://shibaita.ai/link?c=ABCD1234");

    expect(spawnMock).toHaveBeenCalledWith(
      "open",
      ["https://shibaita.ai/link?c=ABCD1234"],
      expect.objectContaining({ shell: false }),
    );
  });

  it('win32: `cmd /c start "" <url>` を引数配列・shell:falseで呼び出す', () => {
    setPlatform("win32");
    spawnMock.mockReturnValue(fakeChild());

    openInBrowser("https://shibaita.ai/link?c=ABCD1234");

    expect(spawnMock).toHaveBeenCalledWith(
      "cmd",
      ["/c", "start", "", "https://shibaita.ai/link?c=ABCD1234"],
      expect.objectContaining({ shell: false }),
    );
  });

  it("linux: `xdg-open <url>` を引数配列・shell:falseで呼び出す", () => {
    setPlatform("linux");
    spawnMock.mockReturnValue(fakeChild());

    openInBrowser("https://shibaita.ai/link?c=ABCD1234");

    expect(spawnMock).toHaveBeenCalledWith(
      "xdg-open",
      ["https://shibaita.ai/link?c=ABCD1234"],
      expect.objectContaining({ shell: false }),
    );
  });

  it("シェルメタ文字を含むURLでも配列渡しのため1つの引数として扱われる(シェルインジェクション不可)", () => {
    setPlatform("darwin");
    spawnMock.mockReturnValue(fakeChild());

    const maliciousUrl = "https://shibaita.ai/link?c=A; rm -rf /tmp/x";
    openInBrowser(maliciousUrl);

    expect(spawnMock).toHaveBeenCalledWith(
      "open",
      [maliciousUrl],
      expect.objectContaining({ shell: false }),
    );
  });

  it("spawnが例外を投げても呼び出し元に伝播しない", () => {
    setPlatform("darwin");
    spawnMock.mockImplementation(() => {
      throw new Error("boom");
    });

    expect(() => openInBrowser("https://shibaita.ai/link?c=ABCD1234")).not.toThrow();
  });
});
