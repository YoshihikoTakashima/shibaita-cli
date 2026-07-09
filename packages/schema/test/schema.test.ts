import { describe, expect, it } from "vitest";
import { dayUsageSchema, limitHitSchema, submissionSchema } from "../src/index.js";

function validDay() {
  return {
    date: "2026-06-10",
    provider: "anthropic" as const,
    product: "claude-code" as const,
    model: "claude-opus-4",
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 10,
    cacheWriteTokens: 5,
    requestCount: 3,
    messageCount: 3,
  };
}

describe("dayUsageSchema", () => {
  it("正常な値を受理する", () => {
    expect(() => dayUsageSchema.parse(validDay())).not.toThrow();
  });

  it("未知キーを含む場合は拒否する(strict)", () => {
    const withExtra = { ...validDay(), unexpectedField: "should-not-exist" };
    expect(() => dayUsageSchema.parse(withExtra)).toThrow();
  });

  it("負値を拒否する", () => {
    const negative = { ...validDay(), inputTokens: -1 };
    expect(() => dayUsageSchema.parse(negative)).toThrow();
  });

  it("日付フォーマット不正を拒否する", () => {
    const badDate = { ...validDay(), date: "2026/06/10" };
    expect(() => dayUsageSchema.parse(badDate)).toThrow();
  });

  it("providerがanthropic以外は拒否する", () => {
    const badProvider = { ...validDay(), provider: "openai" };
    expect(() => dayUsageSchema.parse(badProvider)).toThrow();
  });

  it("modelが空文字は拒否する", () => {
    const badModel = { ...validDay(), model: "" };
    expect(() => dayUsageSchema.parse(badModel)).toThrow();
  });

  it("modelが100文字を超える場合は拒否する(上限)", () => {
    const tooLong = { ...validDay(), model: "a".repeat(101) };
    expect(() => dayUsageSchema.parse(tooLong)).toThrow();
  });
});

const VALID_SOURCE_ID = "11111111-1111-4111-8111-111111111111";

describe("submissionSchema", () => {
  it("正常な送信データを受理する", () => {
    const payload = {
      adapterVersion: "1.0.0",
      clientVersion: "0.1.0",
      sourceId: VALID_SOURCE_ID,
      os: "macos",
      days: [validDay()],
    };
    expect(() => submissionSchema.parse(payload)).not.toThrow();
  });

  it("osの4値(macos/windows/linux/other)すべてを受理する", () => {
    for (const os of ["macos", "windows", "linux", "other"] as const) {
      const payload = {
        adapterVersion: "1.0.0",
        clientVersion: "0.1.0",
        sourceId: VALID_SOURCE_ID,
        os,
        days: [validDay()],
      };
      expect(() => submissionSchema.parse(payload)).not.toThrow();
    }
  });

  it("osが未知の値の場合は拒否する", () => {
    const payload = {
      adapterVersion: "1.0.0",
      clientVersion: "0.1.0",
      sourceId: VALID_SOURCE_ID,
      os: "freebsd",
      days: [validDay()],
    };
    expect(() => submissionSchema.parse(payload)).toThrow();
  });

  it("osが欠落している場合は拒否する", () => {
    const payload = {
      adapterVersion: "1.0.0",
      clientVersion: "0.1.0",
      sourceId: VALID_SOURCE_ID,
      days: [validDay()],
    };
    expect(() => submissionSchema.parse(payload)).toThrow();
  });

  it("未知キーを含む場合は拒否する(strict)", () => {
    const payload = {
      adapterVersion: "1.0.0",
      clientVersion: "0.1.0",
      sourceId: VALID_SOURCE_ID,
      os: "macos",
      days: [validDay()],
      extra: "nope",
    };
    expect(() => submissionSchema.parse(payload)).toThrow();
  });

  it("daysが空配列の場合は拒否する(min 1)", () => {
    const payload = {
      adapterVersion: "1.0.0",
      clientVersion: "0.1.0",
      sourceId: VALID_SOURCE_ID,
      os: "macos",
      days: [],
    };
    expect(() => submissionSchema.parse(payload)).toThrow();
  });

  it("daysが上限(2000)を超える場合は拒否する", () => {
    const days = Array.from({ length: 2001 }, () => validDay());
    const payload = {
      adapterVersion: "1.0.0",
      clientVersion: "0.1.0",
      sourceId: VALID_SOURCE_ID,
      os: "macos",
      days,
    };
    expect(() => submissionSchema.parse(payload)).toThrow();
  });

  it("sourceIdが不正なUUID形式の場合は拒否する", () => {
    const payload = {
      adapterVersion: "1.0.0",
      clientVersion: "0.1.0",
      sourceId: "not-a-uuid",
      os: "macos",
      days: [validDay()],
    };
    expect(() => submissionSchema.parse(payload)).toThrow();
  });

  it("sourceIdが欠落している場合は拒否する", () => {
    const payload = {
      adapterVersion: "1.0.0",
      clientVersion: "0.1.0",
      os: "macos",
      days: [validDay()],
    };
    expect(() => submissionSchema.parse(payload)).toThrow();
  });
});

function validLimitHit() {
  return { date: "2026-06-10", count: 3 };
}

describe("limitHitSchema", () => {
  it("正常な値を受理する", () => {
    expect(() => limitHitSchema.parse(validLimitHit())).not.toThrow();
  });

  it("countが0でも受理する", () => {
    expect(() => limitHitSchema.parse({ ...validLimitHit(), count: 0 })).not.toThrow();
  });

  it("countが負値の場合は拒否する", () => {
    expect(() => limitHitSchema.parse({ ...validLimitHit(), count: -1 })).toThrow();
  });

  it("countが整数でない場合は拒否する", () => {
    expect(() => limitHitSchema.parse({ ...validLimitHit(), count: 1.5 })).toThrow();
  });

  it("日付フォーマット不正を拒否する", () => {
    expect(() => limitHitSchema.parse({ ...validLimitHit(), date: "2026/06/10" })).toThrow();
  });

  it("未知キーを含む場合は拒否する(strict)", () => {
    expect(() =>
      limitHitSchema.parse({ ...validLimitHit(), extra: "not-allowed" }),
    ).toThrow();
  });
});

describe("submissionSchema (limitHits)", () => {
  it("limitHitsを省略した場合も受理する(0件時は省略される想定)", () => {
    const payload = {
      adapterVersion: "1.0.0",
      clientVersion: "0.1.0",
      sourceId: VALID_SOURCE_ID,
      os: "macos",
      days: [validDay()],
    };
    const result = submissionSchema.parse(payload);
    expect(result.limitHits).toBeUndefined();
  });

  it("limitHitsを含む送信データを受理する", () => {
    const payload = {
      adapterVersion: "1.0.0",
      clientVersion: "0.1.0",
      sourceId: VALID_SOURCE_ID,
      os: "macos",
      days: [validDay()],
      limitHits: [validLimitHit()],
    };
    const result = submissionSchema.parse(payload);
    expect(result.limitHits).toEqual([validLimitHit()]);
  });

  it("limitHitsが93件を超える場合は拒否する(上限)", () => {
    const limitHits = Array.from({ length: 94 }, (_, i) => ({
      date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
      count: 1,
    }));
    const payload = {
      adapterVersion: "1.0.0",
      clientVersion: "0.1.0",
      sourceId: VALID_SOURCE_ID,
      os: "macos",
      days: [validDay()],
      limitHits,
    };
    expect(() => submissionSchema.parse(payload)).toThrow();
  });

  it("limitHits内の要素が不正な場合は全体を拒否する", () => {
    const payload = {
      adapterVersion: "1.0.0",
      clientVersion: "0.1.0",
      sourceId: VALID_SOURCE_ID,
      os: "macos",
      days: [validDay()],
      limitHits: [{ ...validLimitHit(), count: -1 }],
    };
    expect(() => submissionSchema.parse(payload)).toThrow();
  });
});
