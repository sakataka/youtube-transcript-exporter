import { describe, expect, test } from "bun:test";

const mainSource = await Bun.file(new URL("./main.tsx", import.meta.url)).text();
const historyStoreSource = await Bun.file(new URL("./codexHistoryStore.ts", import.meta.url)).text();
const promptBuilderSource = await Bun.file(new URL("./promptBuilder.ts", import.meta.url)).text();
const styleSource = await Bun.file(new URL("./style.css", import.meta.url)).text();

describe("UI regression contract", () => {
  test("keeps the primary transcript entry points", () => {
    expect(mainSource).toContain('id="caption-form"');
    expect(mainSource).toContain('id="youtube-url"');
    expect(mainSource).toContain('id="ask-codex-button"');
    expect(mainSource).not.toContain('id="local-media-path"');
    expect(mainSource).not.toContain('id="transcribe-media-button"');
  });

  test("keeps the three output modes and simplified settings sections", () => {
    for (const mode of ["transcript", "copyPrompt", "codexAnswer"]) {
      expect(mainSource).toContain(`data-output-mode="${mode}"`);
    }

    for (const section of ["copy", "display"]) {
      expect(mainSource).toContain(`data-settings-section="${section}"`);
    }
    expect(mainSource).not.toContain('data-settings-section="prompts"');
    expect(mainSource).not.toContain('id="prompt-template"');
    expect(mainSource).not.toContain('id="settings-template-select"');
  });

  test("keeps accessible settings and follow-up dialogs", () => {
    expect(mainSource).toContain('id="prompt-settings-modal"');
    expect(mainSource).toContain('id="follow-up-modal"');
    expect(mainSource).toContain("<PersistentDialog");
    expect(mainSource).toContain("onCancel=");
  });

  test("keeps app settings and history schemas without prompt-template persistence", () => {
    expect(mainSource).not.toContain('youtube-transcript-exporter.prompt-settings.v1');
    expect(mainSource).toContain('youtube-transcript-exporter.app-settings.v1');
    expect(historyStoreSource).toContain('youtube-ai-brief.codex-history.v1');
  });

  test("keeps the fixed prompt focused on an overview and linked timeline detail", () => {
    expect(promptBuilderSource).toContain("次の2項目だけで回答してください");
    expect(promptBuilderSource).toContain("# 1. この動画の概要");
    expect(promptBuilderSource).toContain("# 2. 時刻ごとの詳細");
    expect(promptBuilderSource).toContain("原則として約5分ごと");
    expect(promptBuilderSource).toContain("約10分ごとに調整");
    expect(promptBuilderSource).toContain("見出しの先頭に置いてください");
    expect(promptBuilderSource).not.toContain('id: "quick"');
  });

  test("keeps the mobile layout breakpoint and reduced-motion handling", () => {
    expect(styleSource).toContain("@media (max-width: 760px)");
    expect(styleSource).toContain("@media (prefers-reduced-motion: reduce)");
  });

  test("keeps the LocalWeb-derived section structure and palette", () => {
    for (const [index, label] of [["01", "INPUT"], ["02", "VIDEO INFO"], ["03", "OUTPUT"]]) {
      expect(mainSource).toContain(`<SectionMarker index="${index}" label="${label}" />`);
    }

    for (const color of ["#fafafa", "#ffffff", "#e4e4e7", "#18181b", "#71717a", "#2f6fdb"]) {
      expect(styleSource.toLowerCase()).toContain(color);
    }
    expect(styleSource.toLowerCase()).not.toContain("#0d7377");
    expect(styleSource).not.toContain("linear-gradient");
  });
});
