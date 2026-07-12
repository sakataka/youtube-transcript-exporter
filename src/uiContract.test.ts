import { describe, expect, test } from "bun:test";

const mainSource = await Bun.file(new URL("./main.tsx", import.meta.url)).text();
const shellSource = await Bun.file(new URL("./components/AppShell.tsx", import.meta.url)).text();
const styleSource = await Bun.file(new URL("./style.css", import.meta.url)).text();

describe("UI regression contract", () => {
  test("keeps the primary transcript entry points", () => {
    expect(shellSource).toContain('id="caption-form"');
    expect(shellSource).toContain('id="youtube-url"');
    expect(shellSource).toContain('id="local-media-path"');
    expect(shellSource).toContain('id="ask-codex-button"');
    expect(shellSource).toContain('id="transcribe-media-button"');
  });

  test("keeps the three output modes and settings sections", () => {
    for (const mode of ["transcript", "copyPrompt", "codexAnswer"]) {
      expect(shellSource).toContain(`data-output-mode="${mode}"`);
    }

    for (const section of ["prompts", "copy", "display"]) {
      expect(shellSource).toContain(`data-settings-section="${section}"`);
    }
  });

  test("keeps accessible settings and follow-up dialogs", () => {
    expect(shellSource).toContain('id="prompt-settings-modal"');
    expect(shellSource).toContain('id="follow-up-modal"');
    expect(shellSource).toContain("<PersistentDialog");
    expect(mainSource).toContain('event.key === "Escape"');
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
});
