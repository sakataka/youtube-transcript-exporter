import "./style.css";
import { invoke } from "@tauri-apps/api/core";

type CaptionSource = "manual" | "automatic";

type CaptionOption = {
  language: string;
  name: string;
  source: CaptionSource;
  isAutoCaption: boolean;
};

type CaptionListSuccess = {
  videoId: string;
  title: string;
  captions: CaptionOption[];
};

type TranscriptSuccess = {
  videoId: string;
  language: string;
  source: CaptionSource;
  title: string;
  text: string;
};

type ApiFailure = {
  error: string;
};

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root was not found.");
}

app.innerHTML = `
  <section class="workspace">
    <header class="topbar">
      <div>
        <p class="eyebrow">Local YouTube transcript tool</p>
        <h1>YouTube字幕をテキスト化</h1>
      </div>
      <span class="status-pill" id="runtime-status">ローカル実行</span>
    </header>

    <form class="input-panel" id="caption-form">
      <label for="youtube-url">YouTube URL</label>
      <div class="url-row">
        <input
          id="youtube-url"
          name="url"
          type="url"
          placeholder="https://www.youtube.com/watch?v=..."
          autocomplete="off"
          required
        />
        <button id="caption-button" type="submit">字幕を確認</button>
      </div>
      <p class="hint">自動翻訳字幕は除外し、動画に紐づく字幕・自動字幕のみ表示します。</p>
    </form>

    <section class="result-layout" aria-live="polite">
      <div class="meta-panel">
        <div>
          <span class="label">動画ID</span>
          <strong id="video-id">-</strong>
        </div>
        <div>
          <span class="label">選択言語</span>
          <strong id="language">-</strong>
        </div>
        <div>
          <span class="label">文字数</span>
          <strong id="char-count">0</strong>
        </div>
        <div class="action-buttons">
          <button id="transcript-button" type="button" disabled>選択した字幕を取得</button>
          <button id="copy-button" type="button" disabled>コピー</button>
          <button id="download-button" type="button" disabled>TXT保存</button>
          <button id="markdown-button" type="button" disabled>Markdown保存</button>
        </div>
      </div>

      <div class="output-panel">
        <div class="output-header">
          <h2 id="video-title">トランスクリプト</h2>
          <p id="message">URLを入力して字幕候補を確認してください。</p>
        </div>
        <section class="caption-panel" id="caption-panel" hidden>
          <div class="caption-panel-header">
            <h3>取得可能な字幕</h3>
            <span id="caption-count">0件</span>
          </div>
          <div class="caption-list" id="caption-list"></div>
        </section>
        <textarea id="transcript-output" spellcheck="false" readonly></textarea>
      </div>
    </section>
  </section>
`;

const form = document.querySelector<HTMLFormElement>("#caption-form")!;
const urlInput = document.querySelector<HTMLInputElement>("#youtube-url")!;
const captionButton = document.querySelector<HTMLButtonElement>("#caption-button")!;
const transcriptButton = document.querySelector<HTMLButtonElement>("#transcript-button")!;
const copyButton = document.querySelector<HTMLButtonElement>("#copy-button")!;
const downloadButton = document.querySelector<HTMLButtonElement>("#download-button")!;
const markdownButton = document.querySelector<HTMLButtonElement>("#markdown-button")!;
const captionPanel = document.querySelector<HTMLElement>("#caption-panel")!;
const captionList = document.querySelector<HTMLDivElement>("#caption-list")!;
const captionCount = document.querySelector<HTMLElement>("#caption-count")!;
const output = document.querySelector<HTMLTextAreaElement>("#transcript-output")!;
const message = document.querySelector<HTMLParagraphElement>("#message")!;
const title = document.querySelector<HTMLHeadingElement>("#video-title")!;
const videoId = document.querySelector<HTMLElement>("#video-id")!;
const language = document.querySelector<HTMLElement>("#language")!;
const charCount = document.querySelector<HTMLElement>("#char-count")!;

let latestCaptionList: CaptionListSuccess | null = null;
let selectedCaption: CaptionOption | null = null;
let latestTranscript: TranscriptSuccess | null = null;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = urlInput.value.trim();

  if (!url) {
    showError("YouTube URLを入力してください。");
    return;
  }

  setCaptionLoading(true);
  clearResult();

  try {
    const payload = await invoke<CaptionListSuccess>("list_captions", { url });

    latestCaptionList = payload;
    selectedCaption = payload.captions[0] ?? null;
    title.textContent = payload.title || "トランスクリプト";
    videoId.textContent = payload.videoId;
    renderCaptionOptions(payload.captions);
    transcriptButton.disabled = !selectedCaption;
    message.classList.remove("error");
    message.textContent = selectedCaption
      ? "取得する字幕を選んでください。"
      : "字幕が見つかりません。";
    updateSelectedLanguage();
  } catch (error) {
    showError(formatInvokeError(error, "字幕候補の取得に失敗しました。"));
  } finally {
    setCaptionLoading(false);
  }
});

captionList.addEventListener("change", (event) => {
  const target = event.target;

  if (!(target instanceof HTMLInputElement) || target.name !== "caption-option") {
    return;
  }

  selectedCaption = latestCaptionList?.captions[Number(target.value)] ?? null;
  transcriptButton.disabled = !selectedCaption;
  clearTranscript();
  updateSelectedLanguage();
  message.classList.remove("error");
  message.textContent = "選択した字幕を取得できます。";
});

transcriptButton.addEventListener("click", async () => {
  const url = urlInput.value.trim();

  if (!url || !selectedCaption) {
    showError("取得する字幕を選択してください。");
    return;
  }

  setTranscriptLoading(true);
  clearTranscript();

  try {
    const payload = await invoke<TranscriptSuccess>("fetch_transcript", {
      url,
      language: selectedCaption.language,
      source: selectedCaption.source
    });

    latestTranscript = payload;
    title.textContent = payload.title || "トランスクリプト";
    videoId.textContent = payload.videoId;
    language.textContent = formatCaptionLabel({
      language: payload.language,
      name: selectedCaption.name,
      source: payload.source,
      isAutoCaption: payload.source === "automatic"
    });
    output.value = payload.text;
    charCount.textContent = payload.text.length.toLocaleString("ja-JP");
    copyButton.disabled = payload.text.length === 0;
    downloadButton.disabled = payload.text.length === 0;
    markdownButton.disabled = payload.text.length === 0;
    message.classList.remove("error");
    message.textContent = "取得しました。コピーまたはTXT保存できます。";
  } catch (error) {
    showError(formatInvokeError(error, "取得に失敗しました。"));
  } finally {
    setTranscriptLoading(false);
  }
});

copyButton.addEventListener("click", async () => {
  if (!latestTranscript) {
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(latestTranscript.text);
    } else {
      output.focus();
      output.select();
      document.execCommand("copy");
      output.setSelectionRange(0, 0);
    }

    message.classList.remove("error");
    message.textContent = "クリップボードにコピーしました。";
  } catch {
    message.textContent = "クリップボードにコピーできませんでした。本文を選択して手動でコピーしてください。";
    message.classList.add("error");
  }
});

downloadButton.addEventListener("click", () => {
  if (!latestTranscript) {
    return;
  }

  downloadTextFile(
    latestTranscript.text,
    `${safeFileName(latestTranscript.title || latestTranscript.videoId)}-${latestTranscript.language}.txt`,
    "text/plain;charset=utf-8"
  );
});

markdownButton.addEventListener("click", () => {
  if (!latestTranscript) {
    return;
  }

  const captionLabel = selectedCaption
    ? formatCaptionLabel({
        language: latestTranscript.language,
        name: selectedCaption.name,
        source: latestTranscript.source,
        isAutoCaption: latestTranscript.source === "automatic"
      })
    : `${latestTranscript.language} (${latestTranscript.source === "manual" ? "字幕" : "自動字幕"})`;

  const markdown = [
    `# ${latestTranscript.title || latestTranscript.videoId}`,
    "",
    `- URL: ${urlInput.value.trim()}`,
    `- Video ID: ${latestTranscript.videoId}`,
    `- Caption: ${captionLabel}`,
    `- Characters: ${latestTranscript.text.length.toLocaleString("ja-JP")}`,
    "",
    "## Transcript",
    "",
    latestTranscript.text
  ].join("\n");

  downloadTextFile(
    markdown,
    `${safeFileName(latestTranscript.title || latestTranscript.videoId)}-${latestTranscript.language}.md`,
    "text/markdown;charset=utf-8"
  );
});

function renderCaptionOptions(captions: CaptionOption[]) {
  captionList.innerHTML = captions
    .map(
      (caption, index) => `
        <label class="caption-option">
          <input
            type="radio"
            name="caption-option"
            value="${index}"
            ${index === 0 ? "checked" : ""}
          />
          <span class="caption-option-body">
            <strong>${escapeHtml(caption.name || caption.language)}</strong>
            <span>${escapeHtml(caption.language)} / ${caption.source === "manual" ? "字幕" : "自動字幕"}</span>
          </span>
        </label>
      `
    )
    .join("");
  captionCount.textContent = `${captions.length.toLocaleString("ja-JP")}件`;
  captionPanel.hidden = captions.length === 0;
}

function setCaptionLoading(isLoading: boolean) {
  captionButton.disabled = isLoading;
  captionButton.textContent = isLoading ? "確認中" : "字幕を確認";
  message.textContent = isLoading ? "字幕候補を確認しています。" : message.textContent;
}

function setTranscriptLoading(isLoading: boolean) {
  transcriptButton.disabled = isLoading || !selectedCaption;
  transcriptButton.textContent = isLoading ? "取得中" : "選択した字幕を取得";
  message.textContent = isLoading ? "選択した字幕を取得しています。" : message.textContent;
}

function clearResult() {
  latestCaptionList = null;
  selectedCaption = null;
  captionList.innerHTML = "";
  captionCount.textContent = "0件";
  captionPanel.hidden = true;
  title.textContent = "トランスクリプト";
  videoId.textContent = "-";
  language.textContent = "-";
  transcriptButton.disabled = true;
  clearTranscript();
  message.classList.remove("error");
}

function clearTranscript() {
  latestTranscript = null;
  charCount.textContent = "0";
  output.value = "";
  copyButton.disabled = true;
  downloadButton.disabled = true;
  markdownButton.disabled = true;
}

function showError(text: string) {
  latestTranscript = null;
  message.textContent = text;
  message.classList.add("error");
  output.value = "";
  copyButton.disabled = true;
  downloadButton.disabled = true;
  markdownButton.disabled = true;
}

function formatInvokeError(error: unknown, fallback: string) {
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "object" && error && "error" in error) {
    const value = (error as ApiFailure).error;
    if (value) {
      return value;
    }
  }

  return fallback;
}

function updateSelectedLanguage() {
  language.textContent = selectedCaption ? formatCaptionLabel(selectedCaption) : "-";
}

function formatCaptionLabel(caption: CaptionOption) {
  return `${caption.language} (${caption.source === "manual" ? "字幕" : "自動字幕"})`;
}

function safeFileName(value: string) {
  return value
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "transcript";
}

function downloadTextFile(content: string, fileName: string, type: string) {
  const blob = new Blob([content], { type });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
