import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readJsonlLines } from "../src/adapters/common/jsonl-lines.js";

/**
 * readJsonlLines の単体テスト。
 *
 * `node:readline` を使わず自前でチャンク+バッファ管理をしている理由の核心部分:
 * 1行が異常に長い(理論上は数百MB)場合でも、蓄積中のバッファが `maxLineBytes` を
 * 超えたら本文を保持せず破棄する({ kind: "oversized" })ことで、ピークメモリを
 * ファイルサイズに依存させない。実際に512MB級のファイルをテストで作るのは非現実的なため、
 * `maxLineBytes` / `chunkSizeBytes` を小さく注入し、小さなフィクスチャで境界条件を検証する。
 */

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "shibaita-jsonl-lines-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function collect(filePath: string, options: Parameters<typeof readJsonlLines>[1] = {}) {
  const events: Array<{ kind: string; line?: string }> = [];
  for await (const event of readJsonlLines(filePath, options)) {
    events.push(event.kind === "line" ? { kind: "line", line: event.line } : { kind: "oversized" });
  }
  return events;
}

describe("readJsonlLines", () => {
  it("通常の複数行を1行ずつ返す(末尾に改行あり)", async () => {
    const filePath = join(tempDir, "a.jsonl");
    await writeFile(filePath, "line1\nline2\nline3\n", "utf-8");

    const events = await collect(filePath);
    expect(events).toEqual([
      { kind: "line", line: "line1" },
      { kind: "line", line: "line2" },
      { kind: "line", line: "line3" },
    ]);
  });

  it("末尾に改行が無い最後の行も返す", async () => {
    const filePath = join(tempDir, "b.jsonl");
    await writeFile(filePath, "line1\nline2", "utf-8");

    const events = await collect(filePath);
    expect(events).toEqual([
      { kind: "line", line: "line1" },
      { kind: "line", line: "line2" },
    ]);
  });

  it("空ファイルは何も返さない", async () => {
    const filePath = join(tempDir, "empty.jsonl");
    await writeFile(filePath, "", "utf-8");

    const events = await collect(filePath);
    expect(events).toEqual([]);
  });

  it("チャンクサイズを極小にしても(1行が複数チャンクに分割されても)行が壊れない", async () => {
    const filePath = join(tempDir, "c.jsonl");
    const content = '{"a":1}\n{"b":2}\n{"c":3}\n';
    await writeFile(filePath, content, "utf-8");

    const events = await collect(filePath, { chunkSizeBytes: 3 });
    expect(events).toEqual([
      { kind: "line", line: '{"a":1}' },
      { kind: "line", line: '{"b":2}' },
      { kind: "line", line: '{"c":3}' },
    ]);
  });

  it("maxLineBytesを超える行はoversizedとして破棄し、本文を保持しない", async () => {
    const filePath = join(tempDir, "d.jsonl");
    const hugeLine = "x".repeat(1000);
    const content = `short1\n${hugeLine}\nshort2\n`;
    await writeFile(filePath, content, "utf-8");

    const events = await collect(filePath, { maxLineBytes: 100, chunkSizeBytes: 16 });
    expect(events).toEqual([
      { kind: "line", line: "short1" },
      { kind: "oversized" },
      { kind: "line", line: "short2" },
    ]);
  });

  it("oversizedな行がファイル末尾(改行無し)で終わってもクラッシュせず1回だけoversizedを報告する", async () => {
    const filePath = join(tempDir, "e.jsonl");
    const hugeLine = "y".repeat(1000);
    const content = `short1\n${hugeLine}`; // 末尾に改行無し
    await writeFile(filePath, content, "utf-8");

    const events = await collect(filePath, { maxLineBytes: 100, chunkSizeBytes: 16 });
    expect(events).toEqual([{ kind: "line", line: "short1" }, { kind: "oversized" }]);
  });

  it("oversizedな行の後、複数の通常行が同じチャンク内に続いても正しく再開する", async () => {
    const filePath = join(tempDir, "f.jsonl");
    const hugeLine = "z".repeat(500);
    // hugeLineの終端("\n")の直後に複数の短い行が続く状況を作る
    const content = `${hugeLine}\nnormalA\nnormalB\n`;
    await writeFile(filePath, content, "utf-8");

    const events = await collect(filePath, { maxLineBytes: 100, chunkSizeBytes: 4096 });
    expect(events).toEqual([
      { kind: "oversized" },
      { kind: "line", line: "normalA" },
      { kind: "line", line: "normalB" },
    ]);
  });

  it("非常に長い行が閾値を何度も跨いでもoversizedは1回しか報告しない(重複報告しない)", async () => {
    const filePath = join(tempDir, "g.jsonl");
    // maxLineBytes(100)の何倍もの長さの1行(改行はファイル末尾のみ)
    const hugeLine = "w".repeat(5000);
    const content = `${hugeLine}\nafter\n`;
    await writeFile(filePath, content, "utf-8");

    const events = await collect(filePath, { maxLineBytes: 100, chunkSizeBytes: 8 });
    expect(events).toEqual([{ kind: "oversized" }, { kind: "line", line: "after" }]);
  });
});
