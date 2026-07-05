import { describe, expect, it } from "vitest";
import {
  buildSkillMarkdown,
  parseInstallSkillArgs,
  resolveCliInvocation,
} from "../src/commands/install-skill.js";

describe("install-skill", () => {
  it("--api-url を解釈する", () => {
    expect(parseInstallSkillArgs(["--api-url", "http://localhost:8787"])).toEqual({
      apiUrl: "http://localhost:8787",
    });
    expect(parseInstallSkillArgs([])).toEqual({});
  });

  it("開発リポジトリからの実行では tsx 絶対パス起動を埋め込む", () => {
    const cli = resolveCliInvocation();
    expect(cli).toMatch(/^npx tsx .*index\.ts$/);
  });

  it("スキル文面: frontmatter・送信前確認・禁止事項を含む", () => {
    const md = buildSkillMarkdown("npx -y shibaita");
    expect(md).toMatch(/^---\nname: shibaita\n/);
    expect(md).toContain("必ずユーザーに確認する");
    expect(md).toContain("同意なしに submit を実行すること");
    expect(md).toContain("npx -y shibaita inspect");
    // api-url未指定時はenvプレフィックスなし・本番URL案内
    expect(md).not.toContain("SHIBAITA_API_URL=");
    expect(md).toContain("https://shibaita.ai/pair");
  });

  it("api-url指定時はenvプレフィックスとローカルURL案内を埋め込む", () => {
    const md = buildSkillMarkdown("npx tsx /x/index.ts", "http://localhost:8787");
    expect(md).toContain("SHIBAITA_API_URL=http://localhost:8787 npx tsx /x/index.ts inspect");
    expect(md).toContain("http://localhost:8787/pair");
  });

  it("禁止表現を助長する文言がない(参考値であることを明記)", () => {
    const md = buildSkillMarkdown("npx -y shibaita");
    expect(md).toContain("参考値");
  });
});
