import { describe, expect, it } from "vitest";
import { aggregateRateLimitHits, aggregateUsage, totalTokens } from "../src/aggregate.js";
import type { RateLimitHit, UsageEntry } from "../src/types.js";

function makeEntry(overrides: Partial<UsageEntry> & { key: string }): UsageEntry {
  return {
    model: "claude-opus-4",
    timestamp: new Date("2026-06-10T12:00:00"),
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    ...overrides,
  };
}

function makeHit(overrides: Partial<RateLimitHit> & { key: string }): RateLimitHit {
  return {
    timestamp: new Date(2026, 5, 10, 12, 0, 0),
    ...overrides,
  };
}

describe("aggregateUsage", () => {
  it("同日・同モデルのエントリを合算する", () => {
    const entries: UsageEntry[] = [
      makeEntry({ key: "a", requestId: "r1", inputTokens: 10, outputTokens: 5 }),
      makeEntry({ key: "b", requestId: "r2", inputTokens: 20, outputTokens: 15 }),
    ];

    const result = aggregateUsage(entries);
    expect(result).toHaveLength(1);
    expect(result[0]!.inputTokens).toBe(30);
    expect(result[0]!.outputTokens).toBe(20);
    expect(result[0]!.messageCount).toBe(2);
    expect(result[0]!.requestCount).toBe(2);
  });

  it("モデルが異なれば別バケットに分離する", () => {
    const entries: UsageEntry[] = [
      makeEntry({ key: "a", model: "claude-opus-4", requestId: "r1", inputTokens: 10 }),
      makeEntry({ key: "b", model: "claude-sonnet-4", requestId: "r2", inputTokens: 20 }),
    ];

    const result = aggregateUsage(entries);
    expect(result).toHaveLength(2);
    const opus = result.find((r) => r.model === "claude-opus-4")!;
    const sonnet = result.find((r) => r.model === "claude-sonnet-4")!;
    expect(opus.inputTokens).toBe(10);
    expect(sonnet.inputTokens).toBe(20);
  });

  it("日付が変わればローカルTZの日境界で別バケットにする", () => {
    const entries: UsageEntry[] = [
      makeEntry({ key: "a", requestId: "r1", timestamp: new Date(2026, 5, 10, 23, 59, 59), inputTokens: 1 }),
      makeEntry({ key: "b", requestId: "r2", timestamp: new Date(2026, 5, 11, 0, 0, 1), inputTokens: 2 }),
    ];

    const result = aggregateUsage(entries);
    expect(result).toHaveLength(2);
    expect(result[0]!.date).toBe("2026-06-10");
    expect(result[1]!.date).toBe("2026-06-11");
  });

  it("date×modelでソート済みの配列を返す", () => {
    const entries: UsageEntry[] = [
      makeEntry({ key: "a", model: "z-model", timestamp: new Date(2026, 5, 12), requestId: "r1" }),
      makeEntry({ key: "b", model: "a-model", timestamp: new Date(2026, 5, 10), requestId: "r2" }),
      makeEntry({ key: "c", model: "b-model", timestamp: new Date(2026, 5, 10), requestId: "r3" }),
    ];

    const result = aggregateUsage(entries);
    expect(result.map((r) => `${r.date}:${r.model}`)).toEqual([
      "2026-06-10:a-model",
      "2026-06-10:b-model",
      "2026-06-12:z-model",
    ]);
  });

  it("合計しばき量はinput+output+cacheRead+cacheWriteの総和", () => {
    const usage = {
      date: "2026-06-10",
      model: "claude-opus-4",
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheWriteTokens: 40,
      requestCount: 1,
      messageCount: 1,
    };
    expect(totalTokens(usage)).toBe(100);
  });

  it("同一入力を2回集計しても同一出力になる(冪等性)", () => {
    const entries: UsageEntry[] = [
      makeEntry({ key: "a", requestId: "r1", inputTokens: 10, outputTokens: 5 }),
      makeEntry({ key: "b", requestId: "r2", inputTokens: 20, outputTokens: 15 }),
    ];

    const result1 = aggregateUsage(entries);
    const result2 = aggregateUsage(entries);
    expect(result1).toEqual(result2);
  });

  it("daysオプションで直近N日にフィルタする", () => {
    const now = new Date();
    const old = new Date(now);
    old.setDate(old.getDate() - 100);

    const entries: UsageEntry[] = [
      makeEntry({ key: "old", requestId: "r1", timestamp: old, inputTokens: 999 }),
      makeEntry({ key: "recent", requestId: "r2", timestamp: now, inputTokens: 1 }),
    ];

    const result = aggregateUsage(entries, { days: 7 });
    expect(result).toHaveLength(1);
    expect(result[0]!.inputTokens).toBe(1);
  });
});

describe("aggregateRateLimitHits", () => {
  it("同日のヒットを件数として合算する", () => {
    const hits: RateLimitHit[] = [
      makeHit({ key: "a", timestamp: new Date(2026, 5, 10, 9, 0, 0) }),
      makeHit({ key: "b", timestamp: new Date(2026, 5, 10, 15, 0, 0) }),
    ];

    const result = aggregateRateLimitHits(hits);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ date: "2026-06-10", count: 2 });
  });

  it("日付が変わればローカルTZの日境界で別バケットにする", () => {
    const hits: RateLimitHit[] = [
      makeHit({ key: "a", timestamp: new Date(2026, 5, 10, 23, 59, 59) }),
      makeHit({ key: "b", timestamp: new Date(2026, 5, 11, 0, 0, 1) }),
    ];

    const result = aggregateRateLimitHits(hits);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ date: "2026-06-10", count: 1 });
    expect(result[1]).toEqual({ date: "2026-06-11", count: 1 });
  });

  it("日付順にソート済みの配列を返す", () => {
    const hits: RateLimitHit[] = [
      makeHit({ key: "a", timestamp: new Date(2026, 5, 12) }),
      makeHit({ key: "b", timestamp: new Date(2026, 5, 10) }),
      makeHit({ key: "c", timestamp: new Date(2026, 5, 11) }),
    ];

    const result = aggregateRateLimitHits(hits);
    expect(result.map((r) => r.date)).toEqual(["2026-06-10", "2026-06-11", "2026-06-12"]);
  });

  it("daysオプションで直近N日にフィルタする", () => {
    const now = new Date();
    const old = new Date(now);
    old.setDate(old.getDate() - 100);

    const hits: RateLimitHit[] = [
      makeHit({ key: "old", timestamp: old }),
      makeHit({ key: "recent", timestamp: now }),
    ];

    const result = aggregateRateLimitHits(hits, { days: 7 });
    expect(result).toHaveLength(1);
  });

  it("同一入力を2回集計しても同一出力になる(冪等性)", () => {
    const hits: RateLimitHit[] = [
      makeHit({ key: "a", timestamp: new Date(2026, 5, 10, 9, 0, 0) }),
      makeHit({ key: "b", timestamp: new Date(2026, 5, 10, 15, 0, 0) }),
    ];

    const result1 = aggregateRateLimitHits(hits);
    const result2 = aggregateRateLimitHits(hits);
    expect(result1).toEqual(result2);
  });
});
