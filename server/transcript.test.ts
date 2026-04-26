import { describe, expect, test } from "bun:test";
import { chooseCaptionTrack, parseVttToPlainText, parseYouTubeVideoId, rankCaptionTracks } from "./transcript.ts";

describe("parseYouTubeVideoId", () => {
  test("watch URLから動画IDを取得する", () => {
    expect(parseYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42")).toBe("dQw4w9WgXcQ");
  });

  test("短縮URLから動画IDを取得する", () => {
    expect(parseYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ?si=test")).toBe("dQw4w9WgXcQ");
  });

  test("shorts URLから動画IDを取得する", () => {
    expect(parseYouTubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  test("YouTube以外のURLは拒否する", () => {
    expect(() => parseYouTubeVideoId("https://example.com/watch?v=dQw4w9WgXcQ")).toThrow();
  });
});

describe("chooseCaptionTrack", () => {
  test("日本語字幕を優先する", () => {
    const track = chooseCaptionTrack({
      subtitles: {
        en: [{ ext: "vtt", url: "https://example.com/en.vtt" }],
        ja: [{ ext: "vtt", url: "https://example.com/ja.vtt" }]
      }
    });

    expect(track?.language).toBe("ja");
  });

  test("日本語がない場合は英語を選ぶ", () => {
    const track = chooseCaptionTrack({
      automatic_captions: {
        fr: [{ ext: "vtt", url: "https://example.com/fr.vtt" }],
        en: [{ ext: "vtt", url: "https://example.com/en.vtt" }]
      }
    });

    expect(track?.language).toBe("en");
  });

  test("自動翻訳字幕は選択候補から除外する", () => {
    const tracks = rankCaptionTracks({
      subtitles: {
        "en-US": [{ ext: "vtt", url: "https://example.com/en.vtt" }],
        "zh-Hans": [{ ext: "vtt", url: "https://example.com/zh-manual.vtt" }]
      },
      automatic_captions: {
        "zh-Hans": [{ ext: "vtt", url: "https://example.com/zh-auto.vtt" }],
        "ja-zh-Hans": [{ ext: "vtt", url: "https://example.com/ja-translated.vtt" }]
      }
    });

    expect(tracks[0]?.language).toBe("en-US");
    expect(tracks.map((track) => track.language)).toEqual(["en-US", "zh-Hans"]);
    expect(tracks.map((track) => track.source)).toEqual(["manual", "manual"]);
  });
});

describe("parseVttToPlainText", () => {
  test("VTTから本文だけを抽出する", () => {
    const text = parseVttToPlainText(`WEBVTT

00:00:00.000 --> 00:00:01.000
こんにちは

00:00:01.000 --> 00:00:02.000
<c>世界</c> &amp; YouTube
`);

    expect(text).toBe("こんにちは\n世界 & YouTube");
  });

  test("先頭のAI翻訳注意文は除外する", () => {
    const text = parseVttToPlainText(`WEBVTT

00:00:00.000 --> 00:00:01.000
（Translated by AI for reference only.）

00:00:01.000 --> 00:00:02.000
Hello everyone
`);

    expect(text).toBe("Hello everyone");
  });
});
