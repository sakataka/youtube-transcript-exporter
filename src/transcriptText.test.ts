import { describe, expect, test } from "bun:test";
import {
  getSearchableSegments,
  getTranscriptTextForDisplay,
  normalizeTranscriptSegment,
  removeRollingCaptionOverlaps
} from "./transcriptText";
import type { AppSettings, TranscriptSuccess } from "./types";

const baseSettings: AppSettings = {
  uiLanguage: "ja",
  includeImagePrompt: true,
  formatAutomaticTranscript: true,
  transcriptDisplayMode: "plain"
};

function transcript(partial: Partial<TranscriptSuccess>): TranscriptSuccess {
  return {
    videoId: "video-id-123",
    language: "ja",
    source: "automatic",
    title: "Test Video",
    chapters: [],
    text: "raw transcript",
    timedSegments: [],
    ...partial
  };
}

describe("transcript text formatting", () => {
  test("keeps manual captions untouched even when cleanup is enabled", () => {
    const input = transcript({
      source: "manual",
      text: "手 動 字 幕\nSecond line",
      timedSegments: [{ startSeconds: 0, startLabel: "0:00", text: "ignored segment" }]
    });

    expect(getTranscriptTextForDisplay(input, baseSettings)).toBe("手 動 字 幕\nSecond line");
  });

  test("removes rolling auto-caption overlaps from searchable segments", () => {
    const input = transcript({
      timedSegments: [
        { startSeconds: 0, startLabel: "0:00", text: "hello world" },
        { startSeconds: 1, startLabel: "0:01", text: "world again" },
        { startSeconds: 2, startLabel: "0:02", text: "world again" },
        { startSeconds: 3, startLabel: "0:03", text: "world again today" }
      ]
    });

    expect(getSearchableSegments(input, baseSettings)).toEqual([
      { startSeconds: 0, startLabel: "0:00", text: "hello world" },
      { startSeconds: 1, startLabel: "0:01", text: "again" },
      { startSeconds: 3, startLabel: "0:03", text: "world again today" }
    ]);
  });

  test("uses timestamped display when requested", () => {
    const input = transcript({
      timedSegments: [
        { startSeconds: 12, startLabel: "0:12", text: "最 初 の話" },
        { startSeconds: 35, startLabel: "0:35", text: "次の話" }
      ]
    });

    expect(getTranscriptTextForDisplay(input, { ...baseSettings, transcriptDisplayMode: "timestamped" })).toBe(
      "0:12 最初の話\n0:35 次の話"
    );
  });

  test("normalizes Japanese spacing without touching English word spacing", () => {
    expect(normalizeTranscriptSegment("これ は test case です 。")).toBe("これは test case です。");
  });

  test("exports overlap cleaner as a pure helper", () => {
    expect(
      removeRollingCaptionOverlaps([
        { startSeconds: 0, startLabel: "0:00", text: "A B C" },
        { startSeconds: 1, startLabel: "0:01", text: "B C D" }
      ])
    ).toEqual([
      { startSeconds: 0, startLabel: "0:00", text: "A B C" },
      { startSeconds: 1, startLabel: "0:01", text: "D" }
    ]);
  });
});
