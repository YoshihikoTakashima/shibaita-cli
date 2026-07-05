import { describe, expect, it } from "vitest";
import { detectOs } from "../src/commands/submit.js";

/**
 * process.platform → 送信用OS種別のマッピング検証。
 * ホスト名・マシン名等は一切含めず、4値(macos/windows/linux/other)のみを返すことを保証する。
 */
describe("detectOs", () => {
  it("darwin を macos にマップする", () => {
    expect(detectOs("darwin")).toBe("macos");
  });

  it("win32 を windows にマップする", () => {
    expect(detectOs("win32")).toBe("windows");
  });

  it("linux を linux にマップする", () => {
    expect(detectOs("linux")).toBe("linux");
  });

  it("未知のプラットフォームは other にマップする", () => {
    expect(detectOs("freebsd" as NodeJS.Platform)).toBe("other");
    expect(detectOs("sunos" as NodeJS.Platform)).toBe("other");
    expect(detectOs("aix" as NodeJS.Platform)).toBe("other");
  });
});
