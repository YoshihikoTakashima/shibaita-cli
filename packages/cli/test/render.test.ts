import { describe, expect, it } from "vitest";
import type { DailyUsage } from "@shibaita/core";
import { clampWidth, renderBarChart, renderDailyTable, renderModelTotals } from "../src/render.js";

/**
 * Node.js の `RangeError: Invalid string length` は
 * `String.prototype.padStart/padEnd/repeat` に非有限値(NaN/Infinity)や異常に大きい値を
 * 渡すと発生する(例: `"x".padStart(Infinity)`)。幅計算に0除算やMath.max()の初期値ミス等で
 * 非有限値が紛れ込んでも表示系がクラッシュしないことを保証する回帰テスト。
 */
describe("clampWidth", () => {
  it("通常の有限値はそのまま(上限以下なら)返す", () => {
    expect(clampWidth(10)).toBe(10);
    expect(clampWidth(0)).toBe(0);
  });

  it("Infinity/-Infinityは0扱いにする", () => {
    expect(clampWidth(Infinity)).toBe(0);
    expect(clampWidth(-Infinity)).toBe(0);
  });

  it("NaNは0扱いにする", () => {
    expect(clampWidth(NaN)).toBe(0);
  });

  it("負値は0にする", () => {
    expect(clampWidth(-1)).toBe(0);
    expect(clampWidth(-100)).toBe(0);
  });

  it("Number.MAX_SAFE_INTEGERや巨大な値は上限(既定200)でクランプする", () => {
    expect(clampWidth(Number.MAX_SAFE_INTEGER)).toBe(200);
    expect(clampWidth(Number.MAX_VALUE)).toBe(200);
    expect(clampWidth(1e300)).toBe(200);
  });

  it("上限を明示指定できる", () => {
    expect(clampWidth(1000, 30)).toBe(30);
    expect(clampWidth(Infinity, 30)).toBe(0);
  });

  it("実際にpadStart/padEndへ直接渡すとRangeErrorになる値でも、clampWidth経由なら安全に使える", () => {
    // 対比のため: ガード無しで直接渡すと壊れることを確認しておく
    expect(() => "x".padStart(Infinity)).toThrow(RangeError);
    expect(() => "x".padStart(Number.MAX_SAFE_INTEGER)).toThrow(RangeError);

    // ガード経由なら常に安全
    expect(() => "x".padStart(clampWidth(Infinity))).not.toThrow();
    expect(() => "x".padStart(clampWidth(Number.MAX_SAFE_INTEGER))).not.toThrow();
    expect(() => "x".padStart(clampWidth(NaN))).not.toThrow();
  });
});

function fakeDaily(overrides: Partial<DailyUsage> & { date: string }): DailyUsage {
  return {
    provider: "anthropic",
    product: "claude-code",
    model: "claude-opus-4",
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    requestCount: 0,
    messageCount: 0,
    ...overrides,
  };
}

describe("renderBarChart (異常値混入時の耐性)", () => {
  it("正常値では従来どおりクラッシュせず描画する", () => {
    const daily = [fakeDaily({ date: "2026-07-28", inputTokens: 100, outputTokens: 50 })];
    expect(() => renderBarChart(daily, 7)).not.toThrow();
  });

  it("トークン数にNaNが混入してもクラッシュしない(Math.maxの結果がNaNになるケース)", () => {
    const daily = [fakeDaily({ date: "2026-07-28", inputTokens: NaN })];
    expect(() => renderBarChart(daily, 7)).not.toThrow();
  });

  it("トークン数にInfinityが混入してもクラッシュしない", () => {
    const daily = [fakeDaily({ date: "2026-07-28", inputTokens: Infinity })];
    expect(() => renderBarChart(daily, 7)).not.toThrow();
  });

  it("トークン数がNumber.MAX_SAFE_INTEGER相当でもクラッシュしない", () => {
    const daily = [fakeDaily({ date: "2026-07-28", inputTokens: Number.MAX_SAFE_INTEGER })];
    expect(() => renderBarChart(daily, 7)).not.toThrow();
  });
});

describe("renderDailyTable / renderModelTotals (異常値混入時の耐性)", () => {
  it("トークン数がNaN/Infinityでもテーブル描画でクラッシュしない", () => {
    const daily = [
      fakeDaily({ date: "2026-07-28", inputTokens: NaN, outputTokens: Infinity }),
      fakeDaily({ date: "2026-07-27", inputTokens: Number.MAX_SAFE_INTEGER }),
    ];
    expect(() => renderDailyTable(daily)).not.toThrow();
    expect(() => renderModelTotals(daily)).not.toThrow();
  });
});
