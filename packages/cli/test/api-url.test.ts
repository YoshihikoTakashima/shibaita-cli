import { describe, expect, it } from "vitest";
import { getApiUrl } from "../src/api.js";

/**
 * getApiUrl の HTTPS 強制ロジックの検証。
 * 平文(http)での送信によるデータ漏えいを防ぐため、`https://` 以外は原則拒否する。
 * 例外はローカル開発用の `http://localhost` と `http://127.0.0.1`(ポート付き可)のみ。
 */
describe("getApiUrl: HTTPS強制", () => {
  it("環境変数未指定時は既定の https://shibaita.ai を返す", () => {
    expect(getApiUrl({})).toBe("https://shibaita.ai");
  });

  it("https:// で始まるURLはそのまま許可する", () => {
    expect(getApiUrl({ SHIBAITA_API_URL: "https://example.com" })).toBe("https://example.com");
    expect(getApiUrl({ SHIBAITA_API_URL: "https://api.shibaita.ai:8443" })).toBe(
      "https://api.shibaita.ai:8443",
    );
  });

  it("http://localhost はポートありなしどちらも許可する", () => {
    expect(getApiUrl({ SHIBAITA_API_URL: "http://localhost" })).toBe("http://localhost");
    expect(getApiUrl({ SHIBAITA_API_URL: "http://localhost:8787" })).toBe("http://localhost:8787");
  });

  it("http://127.0.0.1 はポートありなしどちらも許可する", () => {
    expect(getApiUrl({ SHIBAITA_API_URL: "http://127.0.0.1" })).toBe("http://127.0.0.1");
    expect(getApiUrl({ SHIBAITA_API_URL: "http://127.0.0.1:3000" })).toBe("http://127.0.0.1:3000");
  });

  it("http:// かつ localhost/127.0.0.1 以外は拒否する", () => {
    expect(() => getApiUrl({ SHIBAITA_API_URL: "http://example.com" })).toThrow();
    expect(() => getApiUrl({ SHIBAITA_API_URL: "http://evil.example.com:8787" })).toThrow();
    expect(() => getApiUrl({ SHIBAITA_API_URL: "http://192.168.1.10" })).toThrow();
  });

  it("http以外・https以外のスキームは拒否する", () => {
    expect(() => getApiUrl({ SHIBAITA_API_URL: "ftp://example.com" })).toThrow();
    expect(() => getApiUrl({ SHIBAITA_API_URL: "file:///etc/passwd" })).toThrow();
  });

  it("不正なURL文字列は拒否する", () => {
    expect(() => getApiUrl({ SHIBAITA_API_URL: "not a url" })).toThrow();
  });

  it("空文字・空白のみは既定URLにフォールバックする", () => {
    expect(getApiUrl({ SHIBAITA_API_URL: "" })).toBe("https://shibaita.ai");
    expect(getApiUrl({ SHIBAITA_API_URL: "   " })).toBe("https://shibaita.ai");
  });
});
