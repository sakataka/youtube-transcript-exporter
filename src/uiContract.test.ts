import { describe, expect, test } from "bun:test";

const mainSource = await Bun.file(new URL("./main.tsx", import.meta.url)).text();
const styleSource = await Bun.file(new URL("./style.css", import.meta.url)).text();

describe("UI regression contract", () => {
  test("keeps the primary transcript entry points", () => {
    expect(mainSource).toContain('id="caption-form"');
    expect(mainSource).toContain('id="youtube-url"');
    expect(mainSource).toContain('id="local-media-path"');
    expect(mainSource).toContain('id="ask-codex-button"');
    expect(mainSource).toContain('id="transcribe-media-button"');
  });

  test("keeps the three output modes and settings sections", () => {
    for (const mode of ["transcript", "copyPrompt", "codexAnswer"]) {
      expect(mainSource).toContain(`data-output-mode="${mode}"`);
    }

    for (const section of ["prompts", "copy", "display"]) {
      expect(mainSource).toContain(`data-settings-section="${section}"`);
    }
  });

  test("keeps accessible settings and follow-up dialogs", () => {
    expect(mainSource).toContain('id="prompt-settings-modal"');
    expect(mainSource).toContain('id="follow-up-modal"');
    expect(mainSource).toContain("<PersistentDialog");
    expect(mainSource).toContain("onCancel=");
  });

  test("keeps persisted settings and history schemas", () => {
    expect(mainSource).toContain('youtube-transcript-exporter.prompt-settings.v1');
    expect(mainSource).toContain('youtube-transcript-exporter.app-settings.v1');
    expect(mainSource).toContain('youtube-ai-brief.codex-history.v1');
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
