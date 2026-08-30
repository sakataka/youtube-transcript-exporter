import { describe, expect, test } from "bun:test";
import { buildAnalysisPrompt, buildFollowUpPrompt } from "./promptBuilder";
import type { PromptTemplate, TranscriptSuccess } from "./types";

const template: PromptTemplate = {
  id: "default",
  label: "概要",
  description: "要約用",
  instruction: "1. 概要\n2. 要点"
};

function transcript(partial: Partial<TranscriptSuccess> = {}): TranscriptSuccess {
  return {
    videoId: "abc123",
    language: "ja",
    source: "automatic",
    title: "テスト動画",
    channelName: "テストチャンネル",
    description: "説明 文",
    thumbnailUrl: "https://example.com/thumb.jpg",
    webpageUrl: "https://www.youtube.com/watch?v=abc123",
    viewCount: 1200,
    publishedDate: "2026-05-01",
    duration: "12:34",
    chapters: [{ title: "導入", startSeconds: 0, startLabel: "0:00" }],
    text: "raw",
    timedSegments: [
      { startSeconds: 2, startLabel: "0:02", text: "最初の説明" },
      { startSeconds: 34, startLabel: "0:34", text: "次の説明" }
    ],
    ...partial
  };
}

describe("prompt builder", () => {
  test("builds the analysis prompt from explicit inputs", () => {
    const prompt = buildAnalysisPrompt(transcript(), template, {
      includeImageInstruction: true,
      transcriptText: "整形済み字幕",
      captionLabel: "ja (自動字幕)",
      fallbackUrl: "https://youtu.be/fallback",
      promptCreatedDate: "2026/05/05",
      transcriptDisplayMode: "plain",
      buildTimestampUrl: (seconds) => `https://example.com/watch?t=${seconds}s`
    });

    expect(prompt).toContain("確認基準日: 2026/05/05");
    expect(prompt).toContain("字幕: ja (自動字幕)");
    expect(prompt).toContain("重要な安全指示:");
    expect(prompt).toContain("整形済み字幕");
    expect(prompt).toContain("- 0:02 (https://example.com/watch?t=2s): 最初の説明");
    expect(prompt).toContain("画像生成指示:");
    expect(prompt).toContain("元の字幕、動画情報、説明文、チャプター");
    expect(prompt).toContain("日本の詳細なPowerPoint資料やA4の解説シート");
    expect(prompt).toContain("情報を3〜6個など少数に制限せず");
    expect(prompt).not.toContain("強調すべき情報は3〜6個に絞り");
    expect(prompt).not.toContain("権利や出典に注意が必要そうな画像");
  });

  test("omits timed reference when transcript display is already timestamped", () => {
    const prompt = buildAnalysisPrompt(transcript(), template, {
      includeImageInstruction: false,
      transcriptText: "0:02 整形済み字幕",
      captionLabel: "ja (自動字幕)",
      fallbackUrl: "",
      promptCreatedDate: "2026/05/05",
      transcriptDisplayMode: "timestamped",
      buildTimestampUrl: (seconds) => `https://example.com/watch?t=${seconds}s`
    });

    expect(prompt).not.toContain("時間付き参照:");
    expect(prompt).not.toContain("画像生成指示:");
  });

  test("builds follow-up prompts from immutable answer context when transcript differs", () => {
    const prompt = buildFollowUpPrompt({
      question: "根拠を補足して",
      selectedExcerpt: "",
      transcript: transcript({ videoId: "other-video" }),
      context: {
        videoId: "history-video",
        title: "履歴動画",
        url: "https://www.youtube.com/watch?v=history-video",
        language: "en",
        source: "manual"
      },
      sourceAnswer: "前回回答",
      fallbackUrl: "",
      formatCaptionSource: (source) => (source === "manual" ? "字幕" : "自動字幕")
    });

    expect(prompt).toContain("動画ID: history-video");
    expect(prompt).toContain("字幕: en (字幕)");
    expect(prompt).toContain("前回AI回答:");
    expect(prompt).toContain("前回回答");
    expect(prompt).toContain("根拠を補足して");
  });
});
