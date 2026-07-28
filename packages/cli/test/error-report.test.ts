import { describe, expect, it, vi } from "vitest";
import { reportTopLevelError } from "../src/error-report.js";

/**
 * main()最上位catchのエラー表示ロジックの単体テスト。
 * index.ts自体はimport時にmain()を即時実行してしまう構造のため直接importせず、
 * 表示ロジックだけを抽出したこのモジュールを対象にする。
 */
describe("reportTopLevelError", () => {
  it("通常時はエラーが発生しました:のみを表示し、スタックトレースは表示しない", () => {
    const logger = { error: vi.fn() };
    const error = new Error("Invalid string length");

    reportTopLevelError(error, {}, logger);

    expect(logger.error).toHaveBeenCalledTimes(1);
    const message = logger.error.mock.calls[0]?.[0] as string;
    expect(message).toContain("エラーが発生しました: Invalid string length");
  });

  it("SHIBAITA_DEBUG=1のときはスタックトレースも表示する", () => {
    const logger = { error: vi.fn() };
    const error = new Error("Invalid string length");

    reportTopLevelError(error, { SHIBAITA_DEBUG: "1" }, logger);

    expect(logger.error).toHaveBeenCalledTimes(2);
    const firstMessage = logger.error.mock.calls[0]?.[0] as string;
    const secondMessage = logger.error.mock.calls[1]?.[0] as string;
    expect(firstMessage).toContain("エラーが発生しました: Invalid string length");
    expect(secondMessage).toContain("Error: Invalid string length");
  });

  it("SHIBAITA_DEBUG が1以外(未設定・0等)のときはスタックトレースを表示しない", () => {
    const logger = { error: vi.fn() };
    const error = new Error("boom");

    reportTopLevelError(error, { SHIBAITA_DEBUG: "0" }, logger);
    reportTopLevelError(error, { SHIBAITA_DEBUG: "true" }, logger);
    reportTopLevelError(error, {}, logger);

    expect(logger.error).toHaveBeenCalledTimes(3);
  });

  it("Errorインスタンスでない値がthrowされても壊れない", () => {
    const logger = { error: vi.fn() };

    reportTopLevelError("plain string error", { SHIBAITA_DEBUG: "1" }, logger);

    expect(logger.error).toHaveBeenCalledTimes(2);
    const message = logger.error.mock.calls[0]?.[0] as string;
    expect(message).toContain("エラーが発生しました: plain string error");
  });
});
