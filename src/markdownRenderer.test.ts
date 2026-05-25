import { describe, expect, test } from "bun:test";
import { escapeHtml, normalizeMarkdownForDisplay, renderMarkdown } from "./markdownRenderer";

describe("markdown renderer", () => {
  test("renders headings, lists, source notes, and timestamp links", () => {
    const html = renderMarkdown(
      [
        "# 見出し",
        "",
        "本文です。 4:08から重要です。",
        "",
        "出典: 4分08秒 重要な説明",
        "",
        "- **要点**"
      ].join("\n"),
      {
        buildTimestampUrl: (seconds) => `https://www.youtube.com/watch?v=abc&t=${seconds}s`
      }
    );

    expect(html).toContain("<h1>見出し</h1>");
    expect(html).toContain('data-timestamp-url="https://www.youtube.com/watch?v=abc&amp;t=248s"');
    expect(html).toContain('<p class="source-note">');
    expect(html).toContain("<li><strong>要点</strong></li>");
  });

  test("does not create unsafe links or scripts", () => {
    const html = renderMarkdown("[bad](javascript:alert(1)) <script>alert(1)</script>");

    expect(html).toContain("bad");
    expect(html).not.toContain("javascript:alert");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  test("recovers URL suffixes that are accidentally parsed as markdown link targets", () => {
    const html = renderMarkdown(
      "出典: [https://www.moj.go.jp/isa/applications/resources/newimmiiact](3qa.html)"
    );

    expect(html).toContain(
      'href="https://www.moj.go.jp/isa/applications/resources/newimmiiact3qa.html"'
    );
    expect(html).toContain(
      ">https://www.moj.go.jp/isa/applications/resources/newimmiiact3qa.html</a>"
    );
  });

  test("auto-links full web URLs with digits and underscores", () => {
    const html = renderMarkdown(
      "https://www.moj.go.jp/isa/applications/resources/newimmiiact3evaluate_index.html"
    );

    expect(html).toContain(
      'href="https://www.moj.go.jp/isa/applications/resources/newimmiiact3evaluate_index.html"'
    );
  });

  test("normalizes inline numbered sections", () => {
    expect(normalizeMarkdownForDisplay("Intro 1. **概要** text")).toBe("Intro\n\n1. **概要** text");
  });

  test("normalizes inline markdown numbered headings", () => {
    const input =
      "動画内の主張が一部かなり時事的なので、現在情報を短く確認します。# 1. この動画の概要";

    expect(normalizeMarkdownForDisplay(input)).toBe(
      "動画内の主張が一部かなり時事的なので、現在情報を短く確認します。\n\n# 1. この動画の概要"
    );
  });

  test("removes a stray leading heading marker before the first answer section", () => {
    expect(normalizeMarkdownForDisplay("#\n\n# 1. この動画の概要")).toBe("# 1. この動画の概要");
  });

  test("removes invisible-character variants of a stray leading heading marker", () => {
    expect(normalizeMarkdownForDisplay("\uFEFF#\u200B\n\n1. この動画の概要")).toBe("1. この動画の概要");
  });

  test("removes repeated stray leading heading marker lines", () => {
    expect(normalizeMarkdownForDisplay("\n#\n\n#\n\n# 1. この動画の概要")).toBe("# 1. この動画の概要");
  });

  test("renders plain numbered section titles as headings", () => {
    const html = renderMarkdown(["# 1. この動画の概要", "", "本文です。", "", "2. 重要なポイント"].join("\n"));

    expect(html).toContain("<h1>1. この動画の概要</h1>");
    expect(html).toContain("<p>本文です。</p>");
    expect(html).toContain("<h2>重要なポイント</h2>");
  });

  test("escapes html attributes consistently", () => {
    expect(escapeHtml(`"a&b"<tag>`)).toBe("&quot;a&amp;b&quot;&lt;tag&gt;");
  });
});
