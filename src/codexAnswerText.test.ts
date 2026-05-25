import { describe, expect, test } from "bun:test";
import { getCodexAnswerTextForCopy } from "./codexAnswerText";

describe("codex answer text", () => {
  test("removes generated image section for answer copy", () => {
    const answer = [
      "# 1. この動画の概要",
      "",
      "本文です。",
      "",
      "## 生成画像",
      "",
      "![generated image](/tmp/generated.png)"
    ].join("\n");

    expect(getCodexAnswerTextForCopy(answer)).toBe(["# 1. この動画の概要", "", "本文です。"].join("\n"));
  });

  test("removes inline markdown images from copied answer text", () => {
    const answer = "本文です。\n\n![diagram](https://example.com/image.png)\n\n続きです。";

    expect(getCodexAnswerTextForCopy(answer)).toBe("本文です。\n\n続きです。");
  });

  test("removes a stray leading heading marker from copied answer text", () => {
    const answer = "\uFEFF#\u200B\n\n# 1. この動画の概要\n\n本文です。";

    expect(getCodexAnswerTextForCopy(answer)).toBe("# 1. この動画の概要\n\n本文です。");
  });
});
