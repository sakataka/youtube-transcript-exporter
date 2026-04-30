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
  publishedDate?: string;
  captions: CaptionOption[];
};

type TranscriptSuccess = {
  videoId: string;
  language: string;
  source: CaptionSource;
  title: string;
  channelName?: string;
  publishedDate?: string;
  text: string;
};

type ApiFailure = {
  error: string;
};

type PromptTemplate = {
  id: string;
  label: string;
  description: string;
  instruction: string;
};

type PromptSettings = {
  defaultTemplateId: string;
  templates: PromptTemplate[];
};

const promptSettingsStorageKey = "youtube-transcript-exporter.prompt-settings.v1";
const defaultPromptTemplateId = "default";
const defaultPromptTemplates: PromptTemplate[] = [
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
      "4. 結論・主張"
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

let promptSettings = loadPromptSettings();

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
          <button class="secondary-button" id="prompt-settings-button" type="button">プロンプト設定</button>
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

    <div class="settings-backdrop" id="prompt-settings-modal" hidden>
      <section class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="prompt-settings-title">
        <div class="settings-header">
          <div>
            <p class="eyebrow">Copy prompt</p>
            <h2 id="prompt-settings-title">プロンプト設定</h2>
          </div>
          <button class="secondary-button compact-button" id="prompt-settings-close" type="button">閉じる</button>
        </div>

        <div class="settings-body">
          <div class="settings-template-list">
            <label class="label" for="settings-template-select">テンプレート</label>
            <select id="settings-template-select" size="6"></select>
            <div class="settings-actions">
              <button class="secondary-button" id="settings-add-template" type="button">追加</button>
              <button class="secondary-button" id="settings-delete-template" type="button">削除</button>
            </div>
          </div>

          <div class="settings-editor">
            <label class="label" for="settings-template-title">タイトル</label>
            <input id="settings-template-title" type="text" />

            <label class="label" for="settings-template-description">説明</label>
            <input id="settings-template-description" type="text" />

            <label class="label" for="settings-template-body">本文</label>
            <textarea id="settings-template-body" class="settings-template-body" spellcheck="false"></textarea>

            <label class="default-template-toggle">
              <input id="settings-template-default" type="checkbox" />
              <span>このテンプレートを自動コピーのデフォルトにする</span>
            </label>

            <div class="settings-footer">
              <button class="secondary-button" id="settings-reset-template" type="button">初期状態に戻す</button>
              <button id="settings-save-template" type="button">保存</button>
            </div>
          </div>
        </div>
      </section>
    </div>
  </section>
`;

const form = document.querySelector<HTMLFormElement>("#caption-form")!;
const urlInput = document.querySelector<HTMLInputElement>("#youtube-url")!;
const captionButton = document.querySelector<HTMLButtonElement>("#caption-button")!;
const transcriptButton = document.querySelector<HTMLButtonElement>("#transcript-button")!;
const copyButton = document.querySelector<HTMLButtonElement>("#copy-button")!;
const promptTemplateSelect = document.querySelector<HTMLSelectElement>("#prompt-template")!;
const promptDescription = document.querySelector<HTMLParagraphElement>("#prompt-description")!;
const promptSettingsButton = document.querySelector<HTMLButtonElement>("#prompt-settings-button")!;
const promptSettingsModal = document.querySelector<HTMLDivElement>("#prompt-settings-modal")!;
const promptSettingsClose = document.querySelector<HTMLButtonElement>("#prompt-settings-close")!;
const settingsTemplateSelect = document.querySelector<HTMLSelectElement>("#settings-template-select")!;
const settingsTemplateTitle = document.querySelector<HTMLInputElement>("#settings-template-title")!;
const settingsTemplateDescription = document.querySelector<HTMLInputElement>(
  "#settings-template-description"
)!;
const settingsTemplateBody = document.querySelector<HTMLTextAreaElement>("#settings-template-body")!;
const settingsTemplateDefault = document.querySelector<HTMLInputElement>("#settings-template-default")!;
const settingsAddTemplate = document.querySelector<HTMLButtonElement>("#settings-add-template")!;
const settingsDeleteTemplate = document.querySelector<HTMLButtonElement>("#settings-delete-template")!;
const settingsResetTemplate = document.querySelector<HTMLButtonElement>("#settings-reset-template")!;
const settingsSaveTemplate = document.querySelector<HTMLButtonElement>("#settings-save-template")!;
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
      await copyTranscriptToClipboard(payload, getDefaultPromptTemplate());
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
    await copyTranscriptToClipboard(latestTranscript, getSelectedPromptTemplate());
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

promptSettingsButton.addEventListener("click", () => {
  openPromptSettings();
});

promptSettingsClose.addEventListener("click", () => {
  closePromptSettings();
});

promptSettingsModal.addEventListener("click", (event) => {
  if (event.target === promptSettingsModal) {
    closePromptSettings();
  }
});

settingsTemplateSelect.addEventListener("change", () => {
  renderPromptSettingsEditor(settingsTemplateSelect.value);
});

settingsAddTemplate.addEventListener("click", () => {
  const template: PromptTemplate = {
    id: `custom-${Date.now()}`,
    label: "新しいプロンプト",
    description: "説明を入力してください",
    instruction: "以下はYouTube動画の字幕です。内容を日本語で整理してください。"
  };

  promptSettings.templates.push(template);
  savePromptSettings();
  renderPromptTemplates(template.id);
  renderPromptSettingsList(template.id);
  renderPromptSettingsEditor(template.id);
});

settingsDeleteTemplate.addEventListener("click", () => {
  if (promptSettings.templates.length <= 1) {
    return;
  }

  const templateId = settingsTemplateSelect.value;
  promptSettings.templates = promptSettings.templates.filter((template) => template.id !== templateId);

  if (promptSettings.defaultTemplateId === templateId) {
    promptSettings.defaultTemplateId = promptSettings.templates[0]?.id ?? defaultPromptTemplateId;
  }

  const nextTemplateId = promptSettings.templates[0]?.id ?? defaultPromptTemplateId;
  savePromptSettings();
  renderPromptTemplates(nextTemplateId);
  renderPromptSettingsList(nextTemplateId);
  renderPromptSettingsEditor(nextTemplateId);
});

settingsResetTemplate.addEventListener("click", () => {
  promptSettings = createDefaultPromptSettings();
  savePromptSettings();
  renderPromptTemplates(promptSettings.defaultTemplateId);
  renderPromptSettingsList(promptSettings.defaultTemplateId);
  renderPromptSettingsEditor(promptSettings.defaultTemplateId);
  message.classList.remove("error");
  message.textContent = "プロンプト設定を初期状態に戻しました。";
});

settingsSaveTemplate.addEventListener("click", () => {
  const templateId = settingsTemplateSelect.value;
  const template = promptSettings.templates.find((item) => item.id === templateId);

  if (!template) {
    return;
  }

  template.label = settingsTemplateTitle.value.trim() || "無題のプロンプト";
  template.description = settingsTemplateDescription.value.trim();
  template.instruction = settingsTemplateBody.value.trim() || "以下はYouTube動画の字幕です。内容を日本語で整理してください。";

  if (settingsTemplateDefault.checked) {
    promptSettings.defaultTemplateId = template.id;
  }

  savePromptSettings();
  renderPromptTemplates(template.id);
  renderPromptSettingsList(template.id);
  renderPromptSettingsEditor(template.id);
  message.classList.remove("error");
  message.textContent = "プロンプト設定を保存しました。";
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

async function copyTranscriptToClipboard(transcript: TranscriptSuccess, template: PromptTemplate) {
  const clipboardText = buildAnalysisPrompt(transcript, template);

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(clipboardText);
  } else {
    copyTextWithSelectionFallback(clipboardText);
  }

  message.classList.remove("error");
  message.textContent = `取得しました。「${template.label}」プロンプト付きでクリップボードにコピーしました。`;
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

function buildAnalysisPrompt(transcript: TranscriptSuccess, template: PromptTemplate) {
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
    transcript.publishedDate ? `公開日: ${transcript.publishedDate}` : null,
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
    template.instruction,
    "",
    "動画情報:",
    ...metadata,
    ...caution,
    "",
    "字幕:",
    transcript.text
  ].join("\n");
}

function renderPromptTemplates(selectedTemplateId = promptSettings.defaultTemplateId) {
  promptTemplateSelect.innerHTML = promptSettings.templates
    .map((template) => `<option value="${template.id}">${escapeHtml(template.label)}</option>`)
    .join("");

  promptTemplateSelect.value = promptSettings.templates.some(
    (template) => template.id === selectedTemplateId
  )
    ? selectedTemplateId
    : promptSettings.defaultTemplateId;
  updatePromptDescription();
}

function updatePromptDescription() {
  promptDescription.textContent = getSelectedPromptTemplate().description;
}

function getSelectedPromptTemplate() {
  return (
    promptSettings.templates.find((template) => template.id === promptTemplateSelect.value) ??
    promptSettings.templates.find((template) => template.id === promptSettings.defaultTemplateId) ??
    promptSettings.templates[0]
  );
}

function getDefaultPromptTemplate() {
  return (
    promptSettings.templates.find((template) => template.id === promptSettings.defaultTemplateId) ??
    promptSettings.templates[0]
  );
}

function openPromptSettings() {
  renderPromptSettingsList(promptTemplateSelect.value || promptSettings.defaultTemplateId);
  renderPromptSettingsEditor(settingsTemplateSelect.value || promptSettings.defaultTemplateId);
  promptSettingsModal.hidden = false;
  settingsTemplateTitle.focus();
  settingsTemplateTitle.select();
}

function closePromptSettings() {
  promptSettingsModal.hidden = true;
  promptSettingsButton.focus();
}

function renderPromptSettingsList(selectedTemplateId: string) {
  settingsTemplateSelect.innerHTML = promptSettings.templates
    .map((template) => {
      const defaultMark = template.id === promptSettings.defaultTemplateId ? " / デフォルト" : "";
      return `<option value="${template.id}">${escapeHtml(template.label)}${defaultMark}</option>`;
    })
    .join("");
  settingsTemplateSelect.value = promptSettings.templates.some(
    (template) => template.id === selectedTemplateId
  )
    ? selectedTemplateId
    : promptSettings.defaultTemplateId;
  settingsDeleteTemplate.disabled = promptSettings.templates.length <= 1;
}

function renderPromptSettingsEditor(templateId: string) {
  const template = promptSettings.templates.find((item) => item.id === templateId) ?? promptSettings.templates[0];

  if (!template) {
    return;
  }

  settingsTemplateSelect.value = template.id;
  settingsTemplateTitle.value = template.label;
  settingsTemplateDescription.value = template.description;
  settingsTemplateBody.value = template.instruction;
  settingsTemplateDefault.checked = template.id === promptSettings.defaultTemplateId;
}

function loadPromptSettings(): PromptSettings {
  const fallback = createDefaultPromptSettings();

  try {
    const rawValue = localStorage.getItem(promptSettingsStorageKey);
    if (!rawValue) {
      return fallback;
    }

    const parsed = JSON.parse(rawValue) as Partial<PromptSettings>;
    const templates = Array.isArray(parsed.templates)
      ? parsed.templates
          .map(normalizePromptTemplate)
          .filter((template): template is PromptTemplate => Boolean(template))
      : [];

    if (templates.length === 0) {
      return fallback;
    }

    const defaultTemplateId =
      typeof parsed.defaultTemplateId === "string" &&
      templates.some((template) => template.id === parsed.defaultTemplateId)
        ? parsed.defaultTemplateId
        : templates[0].id;

    return {
      defaultTemplateId,
      templates
    };
  } catch {
    return fallback;
  }
}

function savePromptSettings() {
  localStorage.setItem(promptSettingsStorageKey, JSON.stringify(promptSettings));
}

function createDefaultPromptSettings(): PromptSettings {
  return {
    defaultTemplateId: defaultPromptTemplateId,
    templates: defaultPromptTemplates.map((template) => ({ ...template }))
  };
}

function normalizePromptTemplate(value: unknown): PromptTemplate | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<PromptTemplate>;

  if (
    typeof candidate.id !== "string" ||
    typeof candidate.label !== "string" ||
    typeof candidate.description !== "string" ||
    typeof candidate.instruction !== "string"
  ) {
    return null;
  }

  return {
    id: candidate.id,
    label: candidate.label,
    description: candidate.description,
    instruction: candidate.instruction
  };
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
