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
  channelName?: string;
  captions: CaptionOption[];
};

type TranscriptSuccess = {
  videoId: string;
  language: string;
  source: CaptionSource;
  title: string;
  channelName?: string;
  text: string;
};

type ApiFailure = {
  error: string;
};

type PromptTemplateId = "default" | "quick" | "detailed" | "argument" | "study";

type PromptTemplate = {
  id: PromptTemplateId;
  label: string;
  description: string;
  instruction: string;
};

const promptTemplates: PromptTemplate[] = [
  {
    id: "default",
    label: "概要 + 詳細",
    description: "動画の全体像、要点、流れ、結論を整理",
    instruction: [
      "以下はYouTube動画の字幕です。内容を日本語でわかりやすく整理してください。",
      "",
      "次の形式で回答してください。",
      "1. この動画の概要",
      "2. 重要なポイント",
      "3. 話の流れの詳細",
      "4. 結論・主張",
      "5. 背景知識や専門用語の補足",
      "6. この動画を見るべき人"
    ].join("\n")
  },
  {
    id: "quick",
    label: "要点だけ",
    description: "短時間で把握できる箇条書き",
    instruction: [
      "以下はYouTube動画の字幕です。内容を日本語で簡潔に要約してください。",
      "",
      "次の形式で回答してください。",
      "1. 30秒でわかる要約",
      "2. 重要なポイント5つ",
      "3. 最後に覚えておくべき結論"
    ].join("\n")
  },
  {
    id: "detailed",
    label: "詳しく解説",
    description: "背景や専門用語まで深く理解",
    instruction: [
      "以下はYouTube動画の字幕です。内容を日本語で詳しく解説してください。",
      "",
      "次の形式で回答してください。",
      "1. 全体の概要",
      "2. 話題ごとの詳しい解説",
      "3. 背景知識や前提",
      "4. 専門用語の説明",
      "5. 実務や学習に使える示唆",
      "6. 注意点や不確かな点"
    ].join("\n")
  },
  {
    id: "argument",
    label: "主張と根拠",
    description: "議論、結論、根拠を分解",
    instruction: [
      "以下はYouTube動画の字幕です。話者の主張、根拠、結論を日本語で整理してください。",
      "",
      "次の形式で回答してください。",
      "1. 話者が一番言いたいこと",
      "2. 主張ごとの根拠",
      "3. 反論や弱い前提がありそうな点",
      "4. 結論",
      "5. 自分ならどう判断すべきか"
    ].join("\n")
  },
  {
    id: "study",
    label: "語学・学習",
    description: "外国語動画の理解と表現学習",
    instruction: [
      "以下はYouTube動画の字幕です。内容を日本語で解説し、学習にも使える形で整理してください。",
      "",
      "次の形式で回答してください。",
      "1. 内容の概要",
      "2. 重要な表現やキーワード",
      "3. 文脈上わかりにくい表現の説明",
      "4. 日本語での自然な言い換え",
      "5. この動画から学べること"
    ].join("\n")
  }
];

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
          autofocus
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
        <div>
          <label class="label" for="prompt-template">コピープロンプト</label>
          <select id="prompt-template"></select>
          <p class="prompt-description" id="prompt-description"></p>
        </div>
        <div class="action-buttons">
          <button id="transcript-button" type="button" disabled>選択した字幕を取得</button>
          <button id="copy-button" type="button" disabled>コピー</button>
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
const promptTemplateSelect = document.querySelector<HTMLSelectElement>("#prompt-template")!;
const promptDescription = document.querySelector<HTMLParagraphElement>("#prompt-description")!;
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

renderPromptTemplates();
focusUrlInput();
window.addEventListener("load", focusUrlInput);

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
    try {
      await copyTranscriptToClipboard(payload);
    } catch {
      message.textContent =
        "取得しましたが、クリップボードにコピーできませんでした。コピーボタンを押すか、本文を選択して手動でコピーしてください。";
      message.classList.add("error");
    }
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
    await copyTranscriptToClipboard(latestTranscript);
  } catch {
    message.textContent = "クリップボードにコピーできませんでした。本文を選択して手動でコピーしてください。";
    message.classList.add("error");
  }
});

promptTemplateSelect.addEventListener("change", () => {
  updatePromptDescription();

  if (!latestTranscript) {
    return;
  }

  message.classList.remove("error");
  message.textContent = "プロンプトを変更しました。コピーするとこの形式でクリップボードに入ります。";
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
}

function showError(text: string) {
  latestTranscript = null;
  message.textContent = text;
  message.classList.add("error");
  output.value = "";
  copyButton.disabled = true;
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

async function copyTranscriptToClipboard(transcript: TranscriptSuccess) {
  const clipboardText = buildAnalysisPrompt(transcript);

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(clipboardText);
  } else {
    copyTextWithSelectionFallback(clipboardText);
  }

  message.classList.remove("error");
  message.textContent = `取得しました。「${getSelectedPromptTemplate().label}」プロンプト付きでクリップボードにコピーしました。`;
}

function copyTextWithSelectionFallback(text: string) {
  const clipboardBuffer = document.createElement("textarea");
  clipboardBuffer.value = text;
  clipboardBuffer.setAttribute("readonly", "");
  clipboardBuffer.style.position = "fixed";
  clipboardBuffer.style.inset = "0 auto auto 0";
  clipboardBuffer.style.opacity = "0";
  document.body.append(clipboardBuffer);
  clipboardBuffer.focus();
  clipboardBuffer.select();
  document.execCommand("copy");
  clipboardBuffer.remove();
}

function buildAnalysisPrompt(transcript: TranscriptSuccess) {
  const captionLabel = selectedCaption
    ? formatCaptionLabel({
        language: transcript.language,
        name: selectedCaption.name,
        source: transcript.source,
        isAutoCaption: transcript.source === "automatic"
      })
    : `${transcript.language} (${transcript.source === "manual" ? "字幕" : "自動字幕"})`;
  const metadata = [
    `動画タイトル: ${transcript.title || transcript.videoId}`,
    transcript.channelName ? `チャンネル名: ${transcript.channelName}` : null,
    `YouTube URL: ${urlInput.value.trim()}`,
    `動画ID: ${transcript.videoId}`,
    `字幕: ${captionLabel}`,
    `文字数: ${transcript.text.length.toLocaleString("ja-JP")}`
  ].filter(Boolean);
  const caution =
    transcript.source === "automatic"
      ? [
          "",
          "注意: この字幕はYouTubeの自動字幕なので、誤認識が含まれる可能性があります。文脈から補正しながら解説してください。"
        ]
      : [];

  return [
    getSelectedPromptTemplate().instruction,
    "",
    "動画情報:",
    ...metadata,
    ...caution,
    "",
    "字幕:",
    transcript.text
  ].join("\n");
}

function renderPromptTemplates() {
  promptTemplateSelect.innerHTML = promptTemplates
    .map((template) => `<option value="${template.id}">${escapeHtml(template.label)}</option>`)
    .join("");
  promptTemplateSelect.value = "default";
  updatePromptDescription();
}

function updatePromptDescription() {
  promptDescription.textContent = getSelectedPromptTemplate().description;
}

function getSelectedPromptTemplate() {
  return (
    promptTemplates.find((template) => template.id === promptTemplateSelect.value) ??
    promptTemplates[0]
  );
}

function focusUrlInput() {
  requestAnimationFrame(() => {
    urlInput.focus();
    urlInput.select();
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
