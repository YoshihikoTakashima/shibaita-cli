import { describe, expect, it } from "vitest";
import { dayUsageSchema, submissionSchema } from "../src/index.js";

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

describe("submissionSchema", () => {
  it("正常な送信データを受理する", () => {
    const payload = {
      adapterVersion: "1.0.0",
      clientVersion: "0.1.0",
      days: [validDay()],
    };
    expect(() => submissionSchema.parse(payload)).not.toThrow();
  });

  it("未知キーを含む場合は拒否する(strict)", () => {
    const payload = {
      adapterVersion: "1.0.0",
      clientVersion: "0.1.0",
      days: [validDay()],
      extra: "nope",
    };
    expect(() => submissionSchema.parse(payload)).toThrow();
  });

  it("daysが空配列の場合は拒否する(min 1)", () => {
    const payload = { adapterVersion: "1.0.0", clientVersion: "0.1.0", days: [] };
    expect(() => submissionSchema.parse(payload)).toThrow();
  });

  it("daysが上限(2000)を超える場合は拒否する", () => {
    const days = Array.from({ length: 2001 }, () => validDay());
    const payload = { adapterVersion: "1.0.0", clientVersion: "0.1.0", days };
    expect(() => submissionSchema.parse(payload)).toThrow();
  });
});
