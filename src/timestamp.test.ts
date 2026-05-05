import { describe, expect, test } from "bun:test";
import { buildTimestampUrl, parseJapaneseTimestampLabel, parseTimestampLabel } from "./timestamp";

describe("timestamp helpers", () => {
  test("builds YouTube timestamp URLs without dropping existing params", () => {
    expect(buildTimestampUrl("https://www.youtube.com/watch?v=abc&list=xyz", 248.9)).toBe(
      "https://www.youtube.com/watch?v=abc&list=xyz&t=248s"
    );
  });

  test("falls back for non-URL strings", () => {
    expect(buildTimestampUrl("not-a-url?x=1", 5)).toBe("not-a-url?x=1&t=5s");
  });

  test("parses colon and Japanese labels", () => {
    expect(parseTimestampLabel("4:08")).toBe(248);
    expect(parseTimestampLabel("1:02:03")).toBe(3723);
    expect(parseTimestampLabel("4:99")).toBeNull();
    expect(parseJapaneseTimestampLabel("4", "08")).toBe(248);
    expect(parseJapaneseTimestampLabel("4", "99")).toBeNull();
  });
});
