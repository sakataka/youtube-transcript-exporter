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
  description?: string;
  thumbnailUrl?: string;
  webpageUrl?: string;
  viewCount?: number;
  publishedDate?: string;
  duration?: string;
  chapters: VideoChapter[];
  captions: CaptionOption[];
};

type TranscriptSuccess = {
  videoId: string;
  language: string;
  source: CaptionSource;
  title: string;
  channelName?: string;
  description?: string;
  thumbnailUrl?: string;
  webpageUrl?: string;
  viewCount?: number;
  publishedDate?: string;
  duration?: string;
  chapters: VideoChapter[];
  text: string;
  timedSegments: TimedTranscriptSegment[];
};

type TimedTranscriptSegment = {
  startSeconds: number;
  startLabel: string;
  text: string;
};

type NormalizedTranscriptSegment = TimedTranscriptSegment;

type VideoChapter = {
  title: string;
  startSeconds: number;
  startLabel: string;
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

type UiLanguage = "ja" | "en";

type AppSettings = {
  uiLanguage: UiLanguage;
  includeImagePrompt: boolean;
  formatAutomaticTranscript: boolean;
  transcriptDisplayMode: TranscriptDisplayMode;
  recentUrls: string[];
};

type TranscriptDisplayMode = "plain" | "timestamped";

const promptSettingsStorageKey = "youtube-transcript-exporter.prompt-settings.v1";
const appSettingsStorageKey = "youtube-transcript-exporter.app-settings.v1";
const defaultPromptTemplateId = "default";
const appName = "YouTube AI Brief";
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
let appSettings = loadAppSettings();
let activeSettingsSection: "prompts" | "display" = "prompts";

const uiText = {
  ja: {
    eyebrow: "YouTube to AI prompt tool",
    heading: "YouTube動画をAI向けに整理",
    status: "ローカル実行",
    urlLabel: "YouTube URL",
    captionButton: "字幕を確認",
    captionButtonLoading: "確認中",
    hint: "自動翻訳字幕は除外し、動画に紐づく字幕・自動字幕のみ表示します。",
    videoId: "動画ID",
    selectedLanguage: "選択言語",
    characterCount: "文字数",
    videoDuration: "動画時間",
    canonicalUrl: "動画URL",
    viewCount: "再生数",
    captionSourceLabel: "字幕種別",
    segmentCount: "字幕行数",
    copyPrompt: "コピープロンプト",
    copyOptions: "コピー設定",
    includeImagePrompt: "画像生成指示を含める",
    formatAutomaticTranscript: "自動字幕を読みやすく整形",
    transcriptDisplayModeLabel: "字幕表示",
    plainTranscript: "通常",
    timestampedTranscript: "タイムスタンプ付き",
    transcriptView: "字幕本文",
    copyPromptView: "コピー用プロンプト",
    transcriptSearchTitle: "字幕内検索",
    transcriptSearchLabel: "検索語",
    transcriptSearchPlaceholder: "字幕を検索",
    transcriptSearchDisabled: "字幕取得後に検索できます。",
    transcriptSearchReady: "検索語を入力してください。",
    transcriptSearchEmpty: "一致する字幕がありません。",
    transcriptSearchCount: (count: number) => `${count.toLocaleString("ja-JP")}件一致`,
    openTimestamp: "YouTubeで開く",
    settingsButton: "設定",
    fetchTranscript: "選択した字幕を取得",
    fetchTranscriptLoading: "取得中",
    copy: "コピー",
    transcriptTitle: "AI向け入力",
    initialMessage: "URLを入力して字幕候補を確認してください。",
    captionsTitle: "取得可能な字幕",
    settingsEyebrow: "Settings",
    settingsTitle: "設定",
    close: "閉じる",
    promptsTab: "プロンプト",
    displayTab: "表示",
    template: "テンプレート",
    add: "追加",
    delete: "削除",
    title: "タイトル",
    description: "説明",
    body: "本文",
    defaultTemplate: "このテンプレートを自動コピーのデフォルトにする",
    reset: "初期状態に戻す",
    save: "保存",
    uiLanguage: "UI言語",
    uiLanguageDescription: "アプリ画面の表示言語を切り替えます。コピーされるプロンプト本文は、各テンプレートの内容をそのまま使います。",
    japanese: "日本語",
    english: "English",
    urlRequired: "YouTube URLを入力してください。",
    chooseCaption: "取得する字幕を選んでください。",
    noCaptions: "字幕が見つかりません。",
    listCaptionsFailed: "字幕候補の取得に失敗しました。",
    ytDlpInstallHint: "Homebrewの場合は `brew install yt-dlp` を実行してから、アプリを再起動してください。",
    captionReady: "選択した字幕を取得できます。",
    selectCaption: "取得する字幕を選択してください。",
    fetchingCaptions: "字幕候補を確認しています。",
    fetchingTranscript: "選択した字幕を取得しています。",
    fetchTranscriptFailed: "取得に失敗しました。",
    transcriptCopyFailed: "取得しましたが、クリップボードにコピーできませんでした。コピーボタンを押すか、本文を選択して手動でコピーしてください。",
    copyFailed: "クリップボードにコピーできませんでした。本文を選択して手動でコピーしてください。",
    promptChanged: "プロンプトを変更しました。コピーするとこの形式でクリップボードに入ります。",
    copyOptionsChanged: "コピー設定を変更しました。表示とコピー内容に反映しました。",
    settingsReset: "プロンプト設定を初期状態に戻しました。",
    settingsSaved: "プロンプト設定を保存しました。",
    languageSaved: "UI言語を保存しました。",
    newPrompt: "新しいプロンプト",
    newPromptDescription: "説明を入力してください",
    newPromptInstruction: "以下はYouTube動画の字幕です。内容を日本語で整理してください。",
    untitledPrompt: "無題のプロンプト",
    copiedWithPrompt: (label: string) => `取得しました。「${label}」プロンプト付きでクリップボードにコピーしました。`,
    defaultMark: " / デフォルト",
    manualCaption: "字幕",
    automaticCaption: "自動字幕",
    captionCount: (count: number) => `${count.toLocaleString("ja-JP")}件`
  },
  en: {
    eyebrow: "YouTube to AI prompt tool",
    heading: "Prepare YouTube Videos for AI",
    status: "Local app",
    urlLabel: "YouTube URL",
    captionButton: "Check captions",
    captionButtonLoading: "Checking",
    hint: "Shows only captions and auto captions attached to the video, excluding auto-translated captions.",
    videoId: "Video ID",
    selectedLanguage: "Selected language",
    characterCount: "Characters",
    videoDuration: "Duration",
    canonicalUrl: "Video URL",
    viewCount: "Views",
    captionSourceLabel: "Caption type",
    segmentCount: "Segments",
    copyPrompt: "Copy prompt",
    copyOptions: "Copy settings",
    includeImagePrompt: "Include image generation instructions",
    formatAutomaticTranscript: "Clean up auto captions",
    transcriptDisplayModeLabel: "Transcript display",
    plainTranscript: "Plain",
    timestampedTranscript: "Timestamped",
    transcriptView: "Transcript",
    copyPromptView: "Copy prompt",
    transcriptSearchTitle: "Search transcript",
    transcriptSearchLabel: "Search term",
    transcriptSearchPlaceholder: "Search transcript",
    transcriptSearchDisabled: "Search is available after fetching a transcript.",
    transcriptSearchReady: "Enter a search term.",
    transcriptSearchEmpty: "No matching captions found.",
    transcriptSearchCount: (count: number) => `${count.toLocaleString("en-US")} match${count === 1 ? "" : "es"}`,
    openTimestamp: "Open in YouTube",
    settingsButton: "Settings",
    fetchTranscript: "Get selected caption",
    fetchTranscriptLoading: "Getting",
    copy: "Copy",
    transcriptTitle: "AI-ready input",
    initialMessage: "Enter a URL to check available captions.",
    captionsTitle: "Available captions",
    settingsEyebrow: "Settings",
    settingsTitle: "Settings",
    close: "Close",
    promptsTab: "Prompts",
    displayTab: "Display",
    template: "Template",
    add: "Add",
    delete: "Delete",
    title: "Title",
    description: "Description",
    body: "Body",
    defaultTemplate: "Use this template as the default for automatic copy",
    reset: "Reset to defaults",
    save: "Save",
    uiLanguage: "UI language",
    uiLanguageDescription: "Changes the app display language. Copied prompt text still uses each template exactly as written.",
    japanese: "Japanese",
    english: "English",
    urlRequired: "Enter a YouTube URL.",
    chooseCaption: "Choose the caption to fetch.",
    noCaptions: "No captions found.",
    listCaptionsFailed: "Failed to fetch caption candidates.",
    ytDlpInstallHint: "If you use Homebrew, run `brew install yt-dlp`, then restart the app.",
    captionReady: "You can get the selected caption.",
    selectCaption: "Select a caption to fetch.",
    fetchingCaptions: "Checking caption candidates.",
    fetchingTranscript: "Getting the selected caption.",
    fetchTranscriptFailed: "Failed to fetch the transcript.",
    transcriptCopyFailed: "Fetched the transcript, but could not copy it to the clipboard. Press Copy or select the text manually.",
    copyFailed: "Could not copy to the clipboard. Select the text and copy it manually.",
    promptChanged: "Prompt changed. Copy will use this format.",
    copyOptionsChanged: "Copy settings updated. Display and copied text now use them.",
    settingsReset: "Prompt settings were reset to defaults.",
    settingsSaved: "Prompt settings saved.",
    languageSaved: "UI language saved.",
    newPrompt: "New prompt",
    newPromptDescription: "Enter a description",
    newPromptInstruction: "The following is a YouTube video transcript. Please organize the content clearly.",
    untitledPrompt: "Untitled prompt",
    copiedWithPrompt: (label: string) => `Copied with the "${label}" prompt.`,
    defaultMark: " / Default",
    manualCaption: "Caption",
    automaticCaption: "Auto caption",
    captionCount: (count: number) => `${count.toLocaleString("en-US")} item${count === 1 ? "" : "s"}`
  }
};

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root was not found.");
}

app.innerHTML = `
  <section class="workspace">
    <header class="topbar">
      <div>
        <p class="eyebrow" data-i18n="eyebrow">YouTube to AI prompt tool</p>
        <h1 data-i18n="heading">YouTube動画をAI向けに整理</h1>
      </div>
      <span class="status-pill" id="runtime-status" data-i18n="status">ローカル実行</span>
    </header>

    <form class="input-panel" id="caption-form">
      <label for="youtube-url" data-i18n="urlLabel">YouTube URL</label>
      <div class="url-row">
        <input
          id="youtube-url"
          name="url"
          type="url"
          list="recent-url-list"
          placeholder="https://www.youtube.com/watch?v=..."
          autocomplete="off"
          autofocus
          required
        />
        <datalist id="recent-url-list"></datalist>
        <button id="caption-button" type="submit" data-i18n="captionButton">字幕を確認</button>
      </div>
      <p class="hint" data-i18n="hint">自動翻訳字幕は除外し、動画に紐づく字幕・自動字幕のみ表示します。</p>
    </form>

    <section class="result-layout" aria-live="polite">
      <div class="meta-panel">
        <div class="primary-action">
          <button id="transcript-button" type="button" disabled data-i18n="fetchTranscript">選択した字幕を取得</button>
        </div>
        <div>
          <span class="label" data-i18n="videoId">動画ID</span>
          <strong id="video-id">-</strong>
        </div>
        <div>
          <span class="label" data-i18n="selectedLanguage">選択言語</span>
          <strong id="language">-</strong>
        </div>
        <div>
          <span class="label" data-i18n="characterCount">文字数</span>
          <strong id="char-count">0</strong>
        </div>
        <div>
          <span class="label" data-i18n="videoDuration">動画時間</span>
          <strong id="video-duration">-</strong>
        </div>
        <div>
          <span class="label" data-i18n="canonicalUrl">動画URL</span>
          <strong id="canonical-url">-</strong>
        </div>
        <div>
          <span class="label" data-i18n="viewCount">再生数</span>
          <strong id="view-count">-</strong>
        </div>
        <div>
          <span class="label" data-i18n="captionSourceLabel">字幕種別</span>
          <strong id="caption-source">-</strong>
        </div>
        <div>
          <span class="label" data-i18n="segmentCount">字幕行数</span>
          <strong id="segment-count">0</strong>
        </div>
        <div>
          <label class="label" for="prompt-template" data-i18n="copyPrompt">コピープロンプト</label>
          <select id="prompt-template"></select>
          <p class="prompt-description" id="prompt-description"></p>
          <button class="secondary-button" id="prompt-settings-button" type="button" data-i18n="settingsButton">設定</button>
        </div>
        <div>
          <span class="label" data-i18n="copyOptions">コピー設定</span>
          <label class="option-toggle">
            <input id="include-image-prompt" type="checkbox" />
            <span data-i18n="includeImagePrompt">画像生成指示を含める</span>
          </label>
          <label class="option-toggle">
            <input id="format-automatic-transcript" type="checkbox" />
            <span data-i18n="formatAutomaticTranscript">自動字幕を読みやすく整形</span>
          </label>
          <div class="display-mode-control" role="group" aria-labelledby="transcript-display-mode-label">
            <span class="label" id="transcript-display-mode-label" data-i18n="transcriptDisplayModeLabel">字幕表示</span>
            <div class="segmented-control">
              <label>
                <input type="radio" name="transcript-display-mode" value="plain" />
                <span data-i18n="plainTranscript">通常</span>
              </label>
              <label>
                <input type="radio" name="transcript-display-mode" value="timestamped" />
                <span data-i18n="timestampedTranscript">タイムスタンプ付き</span>
              </label>
            </div>
          </div>
        </div>
        <div class="action-buttons">
          <button id="copy-button" type="button" disabled data-i18n="copy">コピー</button>
        </div>
      </div>

      <div class="output-panel">
        <div class="output-header">
          <h2 id="video-title">AI向け入力</h2>
          <p id="message" data-i18n="initialMessage">URLを入力して字幕候補を確認してください。</p>
        </div>
        <section class="caption-panel" id="caption-panel" hidden>
          <div class="caption-panel-header">
            <h3 data-i18n="captionsTitle">取得可能な字幕</h3>
            <span id="caption-count">0件</span>
          </div>
          <div class="caption-list" id="caption-list"></div>
        </section>
        <section class="search-panel" id="transcript-search-panel" hidden>
          <div class="search-header">
            <h3 data-i18n="transcriptSearchTitle">字幕内検索</h3>
            <span id="transcript-search-count" data-i18n="transcriptSearchDisabled">字幕取得後に検索できます。</span>
          </div>
          <label class="label" for="transcript-search" data-i18n="transcriptSearchLabel">検索語</label>
          <input id="transcript-search" type="search" autocomplete="off" disabled data-i18n-placeholder="transcriptSearchPlaceholder" />
          <div class="search-results" id="transcript-search-results"></div>
        </section>
        <div class="output-tabs" role="tablist" aria-label="Output view">
          <button class="output-tab is-active" id="transcript-view-tab" type="button" data-output-mode="transcript" role="tab" aria-selected="true" aria-controls="transcript-output" data-i18n="transcriptView">字幕本文</button>
          <button class="output-tab" id="copy-prompt-view-tab" type="button" data-output-mode="copyPrompt" role="tab" aria-selected="false" aria-controls="transcript-output" data-i18n="copyPromptView">コピー用プロンプト</button>
        </div>
        <textarea id="transcript-output" spellcheck="false" readonly></textarea>
      </div>
    </section>

    <div class="settings-backdrop" id="prompt-settings-modal" hidden>
      <section class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="prompt-settings-title">
        <div class="settings-header">
          <div>
            <p class="eyebrow" data-i18n="settingsEyebrow">Settings</p>
            <h2 id="prompt-settings-title" data-i18n="settingsTitle">設定</h2>
          </div>
          <button class="secondary-button compact-button" id="prompt-settings-close" type="button" data-i18n="close">閉じる</button>
        </div>

        <div class="settings-tabs" role="tablist" aria-label="Settings sections">
          <button class="settings-tab is-active" id="settings-prompts-tab" type="button" role="tab" aria-selected="true" aria-controls="settings-prompts-section" data-settings-section="prompts" data-i18n="promptsTab">プロンプト</button>
          <button class="settings-tab" id="settings-display-tab" type="button" role="tab" aria-selected="false" aria-controls="settings-display-section" data-settings-section="display" data-i18n="displayTab">表示</button>
        </div>

        <div class="settings-body">
          <section class="settings-section" id="settings-prompts-section" role="tabpanel" aria-labelledby="settings-prompts-tab">
            <div class="settings-template-list">
              <label class="label" for="settings-template-select" data-i18n="template">テンプレート</label>
              <select id="settings-template-select" size="6"></select>
              <div class="settings-actions">
                <button class="secondary-button" id="settings-add-template" type="button" data-i18n="add">追加</button>
                <button class="secondary-button" id="settings-delete-template" type="button" data-i18n="delete">削除</button>
              </div>
            </div>

            <div class="settings-editor">
              <label class="label" for="settings-template-title" data-i18n="title">タイトル</label>
              <input id="settings-template-title" type="text" />

              <label class="label" for="settings-template-description" data-i18n="description">説明</label>
              <input id="settings-template-description" type="text" />

              <label class="label" for="settings-template-body" data-i18n="body">本文</label>
              <textarea id="settings-template-body" class="settings-template-body" spellcheck="false"></textarea>

              <label class="default-template-toggle">
                <input id="settings-template-default" type="checkbox" />
                <span data-i18n="defaultTemplate">このテンプレートを自動コピーのデフォルトにする</span>
              </label>

              <div class="settings-footer">
                <button class="secondary-button" id="settings-reset-template" type="button" data-i18n="reset">初期状態に戻す</button>
                <button id="settings-save-template" type="button" data-i18n="save">保存</button>
              </div>
            </div>
          </section>

          <section class="settings-section settings-section-single" id="settings-display-section" role="tabpanel" aria-labelledby="settings-display-tab" hidden>
            <div class="settings-editor">
              <label class="label" for="settings-ui-language" data-i18n="uiLanguage">UI言語</label>
              <select id="settings-ui-language">
                <option value="ja" data-i18n="japanese">日本語</option>
                <option value="en" data-i18n="english">English</option>
              </select>
              <p class="hint" data-i18n="uiLanguageDescription">アプリ画面の表示言語を切り替えます。コピーされるプロンプト本文は、各テンプレートの内容をそのまま使います。</p>
              <div class="settings-footer">
                <button id="settings-save-display" type="button" data-i18n="save">保存</button>
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  </section>
`;

const form = document.querySelector<HTMLFormElement>("#caption-form")!;
const urlInput = document.querySelector<HTMLInputElement>("#youtube-url")!;
const recentUrlList = document.querySelector<HTMLDataListElement>("#recent-url-list")!;
const captionButton = document.querySelector<HTMLButtonElement>("#caption-button")!;
const transcriptButton = document.querySelector<HTMLButtonElement>("#transcript-button")!;
const copyButton = document.querySelector<HTMLButtonElement>("#copy-button")!;
const promptTemplateSelect = document.querySelector<HTMLSelectElement>("#prompt-template")!;
const promptDescription = document.querySelector<HTMLParagraphElement>("#prompt-description")!;
const promptSettingsButton = document.querySelector<HTMLButtonElement>("#prompt-settings-button")!;
const includeImagePrompt = document.querySelector<HTMLInputElement>("#include-image-prompt")!;
const formatAutomaticTranscript = document.querySelector<HTMLInputElement>("#format-automatic-transcript")!;
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
const settingsTabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".settings-tab"));
const outputTabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".output-tab"));
const settingsPromptsSection = document.querySelector<HTMLElement>("#settings-prompts-section")!;
const settingsDisplaySection = document.querySelector<HTMLElement>("#settings-display-section")!;
const settingsUiLanguage = document.querySelector<HTMLSelectElement>("#settings-ui-language")!;
const settingsSaveDisplay = document.querySelector<HTMLButtonElement>("#settings-save-display")!;
const captionPanel = document.querySelector<HTMLElement>("#caption-panel")!;
const captionList = document.querySelector<HTMLDivElement>("#caption-list")!;
const captionCount = document.querySelector<HTMLElement>("#caption-count")!;
const output = document.querySelector<HTMLTextAreaElement>("#transcript-output")!;
const message = document.querySelector<HTMLParagraphElement>("#message")!;
const title = document.querySelector<HTMLHeadingElement>("#video-title")!;
const videoId = document.querySelector<HTMLElement>("#video-id")!;
const language = document.querySelector<HTMLElement>("#language")!;
const charCount = document.querySelector<HTMLElement>("#char-count")!;
const videoDuration = document.querySelector<HTMLElement>("#video-duration")!;
const canonicalUrl = document.querySelector<HTMLElement>("#canonical-url")!;
const viewCount = document.querySelector<HTMLElement>("#view-count")!;
const captionSource = document.querySelector<HTMLElement>("#caption-source")!;
const segmentCount = document.querySelector<HTMLElement>("#segment-count")!;
const transcriptDisplayModeInputs = Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="transcript-display-mode"]')
);
const transcriptSearchPanel = document.querySelector<HTMLElement>("#transcript-search-panel")!;
const transcriptSearchInput = document.querySelector<HTMLInputElement>("#transcript-search")!;
const transcriptSearchCount = document.querySelector<HTMLElement>("#transcript-search-count")!;
const transcriptSearchResults = document.querySelector<HTMLDivElement>("#transcript-search-results")!;

let latestCaptionList: CaptionListSuccess | null = null;
let selectedCaption: CaptionOption | null = null;
let latestTranscript: TranscriptSuccess | null = null;
let outputMode: "transcript" | "copyPrompt" = "transcript";
let elementToRestoreFocus: HTMLElement | null = null;

renderPromptTemplates();
renderAppOptions();
renderRecentUrls();
renderTranscriptDisplayMode();
renderTranscriptSearch();
applyUiLanguage();
focusUrlInput();
window.addEventListener("load", focusUrlInput);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = urlInput.value.trim();

  if (!url) {
    showError(t("urlRequired"));
    return;
  }

  setCaptionLoading(true);
  clearResult();

  try {
    const payload = await invoke<CaptionListSuccess>("list_captions", { url });

    rememberRecentUrl(url);
    latestCaptionList = payload;
    selectedCaption = payload.captions[0] ?? null;
    title.textContent = payload.title || t("transcriptTitle");
    videoId.textContent = payload.videoId;
    videoDuration.textContent = payload.duration || "-";
    renderCanonicalUrl(payload.webpageUrl);
    viewCount.textContent = formatCount(payload.viewCount);
    renderCaptionOptions(payload.captions);
    transcriptButton.disabled = !selectedCaption;
    showMessage(selectedCaption ? t("chooseCaption") : t("noCaptions"));
    updateSelectedLanguage();
    updateCaptionSource();
  } catch (error) {
    showError(formatInvokeError(error, t("listCaptionsFailed")));
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
  updateCaptionSource();
  showMessage(t("captionReady"));
});

transcriptButton.addEventListener("click", async () => {
  const url = urlInput.value.trim();

  if (!url || !selectedCaption) {
    showError(t("selectCaption"));
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
    title.textContent = payload.title || t("transcriptTitle");
    videoId.textContent = payload.videoId;
    videoDuration.textContent = payload.duration || "-";
    renderCanonicalUrl(payload.webpageUrl);
    viewCount.textContent = formatCount(payload.viewCount);
    language.textContent = formatCaptionLabel({
      language: payload.language,
      name: selectedCaption.name,
      source: payload.source,
      isAutoCaption: payload.source === "automatic"
    });
    updateCaptionSource();
    updateTranscriptCharacterCount();
    updateTranscriptStats();
    renderTranscriptSearch();
    copyButton.disabled = payload.text.length === 0;
    renderOutput();
    try {
      await copyTranscriptToClipboard(payload, getDefaultPromptTemplate());
    } catch {
      showMessage(t("transcriptCopyFailed"), true);
    }
  } catch (error) {
    showError(formatInvokeError(error, t("fetchTranscriptFailed")));
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
    showMessage(t("copyFailed"), true);
  }
});

promptTemplateSelect.addEventListener("change", () => {
  updatePromptDescription();
  renderOutput();

  if (!latestTranscript) {
    return;
  }

  showMessage(t("promptChanged"));
});

includeImagePrompt.addEventListener("change", () => {
  appSettings.includeImagePrompt = includeImagePrompt.checked;
  saveAppSettings();
  renderOutput();
  updateTranscriptCharacterCount();
  updateTranscriptStats();
  showMessage(t("copyOptionsChanged"));
});

formatAutomaticTranscript.addEventListener("change", () => {
  appSettings.formatAutomaticTranscript = formatAutomaticTranscript.checked;
  saveAppSettings();
  renderOutput();
  updateTranscriptCharacterCount();
  updateTranscriptStats();
  showMessage(t("copyOptionsChanged"));
});

transcriptDisplayModeInputs.forEach((input) => {
  input.addEventListener("change", () => {
    if (input.checked && isTranscriptDisplayMode(input.value)) {
      appSettings.transcriptDisplayMode = input.value;
      saveAppSettings();
      renderTranscriptDisplayMode();
      renderOutput();
      updateTranscriptCharacterCount();
      updateTranscriptStats();
      showMessage(t("copyOptionsChanged"));
    }
  });
});

transcriptSearchInput.addEventListener("input", () => {
  renderTranscriptSearch();
});

transcriptSearchResults.addEventListener("click", async (event) => {
  const target = event.target;

  if (!(target instanceof HTMLElement)) {
    return;
  }

  const clickable = target.closest<HTMLElement>("[data-timestamp-url]");

  if (!clickable) {
    return;
  }

  await openTimestampUrl(clickable.dataset.timestampUrl);
});

transcriptSearchResults.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  const target = event.target;

  if (!(target instanceof HTMLElement)) {
    return;
  }

  const clickable = target.closest<HTMLElement>(".search-result[data-timestamp-url]");

  if (!clickable) {
    return;
  }

  event.preventDefault();
  await openTimestampUrl(clickable.dataset.timestampUrl);
});

outputTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const mode = tab.dataset.outputMode;
    if (mode === "transcript" || mode === "copyPrompt") {
      setOutputMode(mode);
    }
  });
});

settingsTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const section = tab.dataset.settingsSection;
    if (section === "prompts" || section === "display") {
      showSettingsSection(section);
    }
  });
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

document.addEventListener("keydown", (event) => {
  if (promptSettingsModal.hidden) {
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    closePromptSettings();
    return;
  }

  if (event.key === "Tab") {
    trapSettingsFocus(event);
  }
});

settingsTemplateSelect.addEventListener("change", () => {
  renderPromptSettingsEditor(settingsTemplateSelect.value);
});

settingsAddTemplate.addEventListener("click", () => {
  const template: PromptTemplate = {
    id: `custom-${Date.now()}`,
    label: t("newPrompt"),
    description: t("newPromptDescription"),
    instruction: t("newPromptInstruction")
  };

  promptSettings.templates.push(template);
  savePromptSettings();
  renderPromptSettings(template.id);
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
  renderPromptSettings(nextTemplateId);
});

settingsResetTemplate.addEventListener("click", () => {
  promptSettings = createDefaultPromptSettings();
  savePromptSettings();
  renderPromptSettings(promptSettings.defaultTemplateId);
  showMessage(t("settingsReset"));
});

settingsSaveTemplate.addEventListener("click", () => {
  const templateId = settingsTemplateSelect.value;
  const template = promptSettings.templates.find((item) => item.id === templateId);

  if (!template) {
    return;
  }

  template.label = settingsTemplateTitle.value.trim() || t("untitledPrompt");
  template.description = settingsTemplateDescription.value.trim();
  template.instruction = settingsTemplateBody.value.trim() || t("newPromptInstruction");

  if (settingsTemplateDefault.checked) {
    promptSettings.defaultTemplateId = template.id;
  }

  savePromptSettings();
  renderPromptSettings(template.id);
  showMessage(t("settingsSaved"));
});

settingsSaveDisplay.addEventListener("click", () => {
  appSettings.uiLanguage = settingsUiLanguage.value === "en" ? "en" : "ja";
  saveAppSettings();
  applyUiLanguage();
  renderPromptSettingsList(settingsTemplateSelect.value || promptSettings.defaultTemplateId);
  showMessage(t("languageSaved"));
});

function renderCaptionOptions(captions: CaptionOption[]) {
  const selectedIndex = selectedCaption
    ? captions.findIndex(
        (caption) =>
          caption.language === selectedCaption?.language &&
          caption.source === selectedCaption?.source
      )
    : 0;
  captionList.innerHTML = captions
    .map(
      (caption, index) => `
        <label class="caption-option">
          <input
            type="radio"
            name="caption-option"
            value="${index}"
            ${index === Math.max(selectedIndex, 0) ? "checked" : ""}
          />
          <span class="caption-option-body">
            <strong>${escapeHtml(caption.name || caption.language)}</strong>
            <span>${escapeHtml(caption.language)} / ${caption.source === "manual" ? t("manualCaption") : t("automaticCaption")}</span>
          </span>
        </label>
      `
    )
    .join("");
  captionCount.textContent = t("captionCount", captions.length);
  captionPanel.hidden = captions.length === 0;
}

function setCaptionLoading(isLoading: boolean) {
  captionButton.disabled = isLoading;
  captionButton.textContent = isLoading ? t("captionButtonLoading") : t("captionButton");
  message.textContent = isLoading ? t("fetchingCaptions") : message.textContent;
}

function setTranscriptLoading(isLoading: boolean) {
  transcriptButton.disabled = isLoading || !selectedCaption;
  transcriptButton.textContent = isLoading ? t("fetchTranscriptLoading") : t("fetchTranscript");
  message.textContent = isLoading ? t("fetchingTranscript") : message.textContent;
}

function clearResult() {
  latestCaptionList = null;
  selectedCaption = null;
  captionList.innerHTML = "";
  captionCount.textContent = t("captionCount", 0);
  captionPanel.hidden = true;
  title.textContent = t("transcriptTitle");
  videoId.textContent = "-";
  language.textContent = "-";
  videoDuration.textContent = "-";
  renderCanonicalUrl(undefined);
  viewCount.textContent = "-";
  updateCaptionSource();
  transcriptButton.disabled = true;
  clearTranscript();
  message.classList.remove("error");
}

function clearTranscript() {
  latestTranscript = null;
  charCount.textContent = "0";
  segmentCount.textContent = "0";
  copyButton.disabled = true;
  transcriptSearchInput.value = "";
  renderTranscriptSearch();
  renderOutput();
}

function showError(text: string) {
  latestTranscript = null;
  showMessage(text, true);
  copyButton.disabled = true;
  renderOutput();
}

function showMessage(text: string, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

function formatInvokeError(error: unknown, fallback: string) {
  let message = "";

  if (typeof error === "string" && error.trim()) {
    message = error;
  } else if (error instanceof Error && error.message.trim()) {
    message = error.message;
  } else if (typeof error === "object" && error && "error" in error) {
    const value = (error as ApiFailure).error;
    message = value || "";
  }

  if (!message) {
    message = fallback;
  }

  if (message.includes("yt-dlp") && !message.includes("brew install yt-dlp")) {
    return `${message}\n${t("ytDlpInstallHint")}`;
  }

  return message;
}

function updateSelectedLanguage() {
  language.textContent = selectedCaption ? formatCaptionLabel(selectedCaption) : "-";
}

function updateCaptionSource() {
  const source = latestTranscript?.source ?? selectedCaption?.source;
  captionSource.textContent = source ? formatCaptionSource(source) : "-";
}

function renderCanonicalUrl(url: string | undefined) {
  if (!url) {
    canonicalUrl.textContent = "-";
    return;
  }

  canonicalUrl.innerHTML = `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a>`;
}

function formatCount(value: number | undefined) {
  return typeof value === "number"
    ? value.toLocaleString(appSettings.uiLanguage === "ja" ? "ja-JP" : "en-US")
    : "-";
}

function formatCaptionLabel(caption: CaptionOption) {
  return `${caption.language} (${formatCaptionSource(caption.source)})`;
}

function formatCaptionSource(source: CaptionSource) {
  return source === "manual" ? t("manualCaption") : t("automaticCaption");
}

async function copyTranscriptToClipboard(transcript: TranscriptSuccess, template: PromptTemplate) {
  const clipboardText = buildAnalysisPrompt(transcript, template);

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(clipboardText);
  } else {
    copyTextWithSelectionFallback(clipboardText);
  }

  showMessage(t("copiedWithPrompt", template.label));
}

function setOutputMode(mode: "transcript" | "copyPrompt") {
  outputMode = mode;
  outputTabs.forEach((tab) => {
    const isActive = tab.dataset.outputMode === mode;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
  renderOutput();
}

function renderOutput() {
  if (!latestTranscript) {
    output.value = "";
    return;
  }

  output.value =
    outputMode === "copyPrompt"
      ? buildAnalysisPrompt(latestTranscript, getSelectedPromptTemplate())
      : getTranscriptTextForDisplay(latestTranscript);
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

function getTranscriptTextForDisplay(transcript: TranscriptSuccess) {
  if (appSettings.transcriptDisplayMode === "timestamped") {
    const timestampedText = buildTimestampedTranscriptText(transcript);

    if (timestampedText) {
      return timestampedText;
    }
  }

  return getPlainTranscriptText(transcript);
}

function getPlainTranscriptText(transcript: TranscriptSuccess) {
  if (transcript.source !== "automatic" || !appSettings.formatAutomaticTranscript) {
    return transcript.text;
  }

  const formatted = formatAutomaticTranscriptText(transcript);
  return formatted || transcript.text;
}

function buildTimestampedTranscriptText(transcript: TranscriptSuccess) {
  const segments = getSearchableSegments(transcript);

  if (segments.length === 0) {
    return "";
  }

  return segments
    .map((segment) => `${segment.startLabel} ${segment.text}`)
    .join("\n");
}

function formatAutomaticTranscriptText(transcript: TranscriptSuccess) {
  const segments = getDisplaySegments(transcript);

  if (segments.length === 0) {
    return transcript.text
      .split(/\n+/)
      .map(normalizeTranscriptSegment)
      .filter(Boolean)
      .join("\n");
  }

  const joinedText = joinTranscriptParts(segments.map((segment) => segment.text));
  const paragraphs = formatTranscriptParagraphs(joinedText);
  return paragraphs.length > 0 ? paragraphs.join("\n\n") : joinedText;
}

function formatTranscriptParagraphs(text: string) {
  const normalized = normalizeTranscriptSegment(text);

  if (!normalized) {
    return [];
  }

  const sentences = splitTranscriptSentences(normalized);
  const targetParagraphLength = 650;
  const maxParagraphLength = 950;
  const paragraphs: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const normalizedSentence = normalizeTranscriptSegment(sentence);

    if (!normalizedSentence) {
      continue;
    }

    const next = current ? joinTranscriptParts([current, normalizedSentence]) : normalizedSentence;

    if (current && next.length > maxParagraphLength) {
      paragraphs.push(current);
      current = normalizedSentence;
    } else {
      current = next;
    }

    if (current.length >= targetParagraphLength && endsSentence(normalizedSentence)) {
      paragraphs.push(current);
      current = "";
    }
  }

  if (current) {
    paragraphs.push(current);
  }

  return paragraphs;
}

function normalizeTranscriptSegment(text: string) {
  return removeUnnaturalJapaneseSpaces(text.replace(/\s+/g, " ").trim());
}

function removeUnnaturalJapaneseSpaces(text: string) {
  return text
    .replace(
      /([\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}])\s+([\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}、。！？])/gu,
      "$1$2"
    )
    .replace(
      /([、。！？])\s+([\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}])/gu,
      "$1$2"
    );
}

function splitTranscriptSentences(text: string) {
  const sentences: string[] = [];
  let current = "";

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? "";
    current += character;

    if (isSentenceBoundary(text, index)) {
      const sentence = normalizeTranscriptSegment(current);
      if (sentence) {
        sentences.push(sentence);
      }
      current = "";
    }
  }

  const rest = normalizeTranscriptSegment(current);
  if (rest) {
    sentences.push(rest);
  }

  return sentences.length > 0 ? sentences : [text];
}

function isSentenceBoundary(text: string, index: number) {
  const character = text[index] ?? "";

  if (/[。！？!?]/.test(character)) {
    return true;
  }

  if (character !== ".") {
    return false;
  }

  const previous = text[index - 1] ?? "";
  const next = text[index + 1] ?? "";
  return !/\d/.test(previous) && (!next || /\s/.test(next));
}

function joinTranscriptParts(parts: string[]) {
  return parts.reduce((joined, part) => {
    if (!joined) {
      return part;
    }

    return shouldJoinWithoutSpace(joined, part) ? `${joined}${part}` : `${joined} ${part}`;
  }, "");
}

function shouldJoinWithoutSpace(left: string, right: string) {
  return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]$/u.test(left) ||
    /^[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}、。！？]/u.test(right);
}

function endsSentence(text: string) {
  return /[。！？.!?]$/.test(text);
}

function updateTranscriptCharacterCount() {
  const count = latestTranscript ? getTranscriptTextForDisplay(latestTranscript).length : 0;
  charCount.textContent = count.toLocaleString(appSettings.uiLanguage === "ja" ? "ja-JP" : "en-US");
}

function updateTranscriptStats() {
  if (!latestTranscript) {
    segmentCount.textContent = "0";
    return;
  }

  const segmentTotal = getSearchableSegments(latestTranscript).length;
  segmentCount.textContent = segmentTotal.toLocaleString(appSettings.uiLanguage === "ja" ? "ja-JP" : "en-US");
}

function renderTranscriptDisplayMode() {
  transcriptDisplayModeInputs.forEach((input) => {
    input.checked = input.value === appSettings.transcriptDisplayMode;
  });
}

function isTranscriptDisplayMode(value: unknown): value is TranscriptDisplayMode {
  return value === "plain" || value === "timestamped";
}

function renderTranscriptSearch() {
  const segments = latestTranscript ? getSearchableSegments(latestTranscript) : [];
  transcriptSearchPanel.hidden = !latestTranscript;
  transcriptSearchInput.disabled = segments.length === 0;

  if (!latestTranscript) {
    transcriptSearchCount.textContent = t("transcriptSearchDisabled");
    transcriptSearchResults.innerHTML = "";
    return;
  }

  if (segments.length === 0) {
    transcriptSearchCount.textContent = t("transcriptSearchDisabled");
    transcriptSearchResults.innerHTML = "";
    return;
  }

  const query = normalizeSearchText(transcriptSearchInput.value);

  if (!query) {
    transcriptSearchCount.textContent = t("transcriptSearchReady");
    transcriptSearchResults.innerHTML = "";
    return;
  }

  const matches = segments
    .filter((segment) => normalizeSearchText(segment.text).includes(query))
    .slice(0, 50);

  transcriptSearchCount.textContent =
    matches.length === 0 ? t("transcriptSearchEmpty") : t("transcriptSearchCount", matches.length);
  transcriptSearchResults.innerHTML = matches
    .map(
      (segment) => `
        <div class="search-result" role="button" tabindex="0" data-timestamp-url="${escapeHtml(buildTimestampUrl(segment.startSeconds))}">
          <div class="search-result-body">
            <strong>${escapeHtml(segment.startLabel)}</strong>
            <p>${escapeHtml(truncateSearchResult(segment.text))}</p>
          </div>
          <button class="secondary-button compact-button" type="button" data-timestamp-url="${escapeHtml(buildTimestampUrl(segment.startSeconds))}" data-i18n="openTimestamp">${t("openTimestamp")}</button>
        </div>
      `
    )
    .join("");
}

function getSearchableSegments(transcript: TranscriptSuccess) {
  return getDisplaySegments(transcript);
}

function getDisplaySegments(transcript: TranscriptSuccess) {
  const segments = (transcript.timedSegments ?? [])
    .map((segment) => ({
      ...segment,
      text: normalizeTranscriptSegment(segment.text)
    }))
    .filter((segment) => segment.text.length > 0);

  if (transcript.source !== "automatic" || !appSettings.formatAutomaticTranscript) {
    return segments;
  }

  return removeRollingCaptionOverlaps(segments);
}

function removeRollingCaptionOverlaps(segments: NormalizedTranscriptSegment[]) {
  const cleaned: NormalizedTranscriptSegment[] = [];

  for (const segment of segments) {
    const text = normalizeTranscriptSegment(segment.text);

    if (!text) {
      continue;
    }

    if (cleaned.length === 0) {
      cleaned.push({ ...segment, text });
      continue;
    }

    const previous = cleaned[cleaned.length - 1];
    const previousText = previous.text;
    const normalizedPrevious = normalizeForOverlap(previousText);
    const normalizedCurrent = normalizeForOverlap(text);

    if (!normalizedCurrent || normalizedCurrent === normalizedPrevious) {
      continue;
    }

    if (normalizedCurrent.startsWith(normalizedPrevious)) {
      cleaned[cleaned.length - 1] = { ...segment, text };
      continue;
    }

    if (normalizedPrevious.includes(normalizedCurrent)) {
      continue;
    }

    const overlapLength = findRollingOverlapLength(previousText, text);
    const nextText = overlapLength > 0 ? normalizeTranscriptSegment(text.slice(overlapLength)) : text;

    if (!nextText) {
      continue;
    }

    cleaned.push({ ...segment, text: nextText });
  }

  return cleaned;
}

function normalizeForOverlap(text: string) {
  return normalizeTranscriptSegment(text).toLocaleLowerCase();
}

function findRollingOverlapLength(previousText: string, currentText: string) {
  const previous = normalizeForOverlap(previousText);
  const current = normalizeForOverlap(currentText);
  const minimumOverlapLength = 1;
  const maximumOverlapLength = Math.min(previous.length, current.length);

  for (let length = maximumOverlapLength; length >= minimumOverlapLength; length -= 1) {
    if (previous.slice(-length) === current.slice(0, length)) {
      return length;
    }
  }

  return 0;
}

function normalizeSearchText(value: string) {
  return value.trim().toLocaleLowerCase();
}

function truncateSearchResult(text: string) {
  const normalized = normalizeTranscriptSegment(text);
  return normalized.length > 160 ? `${normalized.slice(0, 160)}...` : normalized;
}

async function openTimestampUrl(url: string | undefined) {
  if (!url) {
    return;
  }

  try {
    await invoke("open_youtube_url", { url });
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function buildAnalysisPrompt(transcript: TranscriptSuccess, template: PromptTemplate) {
  const transcriptText = getTranscriptTextForDisplay(transcript);
  const captionLabel = selectedCaption
    ? formatCaptionLabel({
        language: transcript.language,
        name: selectedCaption.name,
        source: transcript.source,
        isAutoCaption: transcript.source === "automatic"
      })
    : `${transcript.language} (${formatCaptionSource(transcript.source)})`;
  const metadata = [
    `動画タイトル: ${transcript.title || transcript.videoId}`,
    transcript.channelName ? `チャンネル名: ${transcript.channelName}` : null,
    transcript.publishedDate ? `公開日: ${transcript.publishedDate}` : null,
    transcript.duration ? `動画時間: ${transcript.duration}` : null,
    `YouTube URL: ${transcript.webpageUrl || urlInput.value.trim()}`,
    `動画ID: ${transcript.videoId}`,
    typeof transcript.viewCount === "number" ? `再生数: ${transcript.viewCount.toLocaleString("ja-JP")}` : null,
    transcript.thumbnailUrl ? `サムネイルURL: ${transcript.thumbnailUrl}` : null,
    `字幕: ${captionLabel}`,
    `文字数: ${transcriptText.length.toLocaleString("ja-JP")}`
  ].filter(Boolean);
  const caution =
    transcript.source === "automatic"
      ? [
          "",
          "注意: この字幕はYouTubeの自動字幕なので、誤認識が含まれる可能性があります。文脈から補正しながら解説してください。"
        ]
      : [];

  return [
    "以下のYouTube動画字幕をもとに、必ず次の2つを順番に行ってください。",
    "1. まず、文章で動画の内容を説明・整理してください。",
    "2. その後、説明とは別に、動画内容を1枚にまとめた画像を生成してください。",
    "",
    "最初から画像だけを生成せず、必ず文章での説明を先に出力してください。",
    "",
    "文章での説明指示:",
    template.instruction,
    "",
    "補足情報の扱い:",
    "動画字幕だけでは固有名詞、出来事、製品名、人物名、専門用語、時事的背景が不明確な場合は、必要に応じてインターネット上の信頼できる情報も参照して補足してください。",
    "ただし、字幕から読み取れる内容と外部情報から補った内容は混同せず、不確かな点は不確かだと明示してください。",
    "",
    "動画情報:",
    ...metadata,
    "",
    buildDescriptionSection(transcript),
    "",
    buildChapterSection(transcript),
    ...caution,
    "",
    "字幕:",
    transcriptText,
    "",
    appSettings.transcriptDisplayMode === "timestamped" ? null : buildTimedReference(transcript),
    "",
    appSettings.includeImagePrompt ? buildImageGenerationInstruction(template) : null
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function buildImageGenerationInstruction(template: PromptTemplate) {
  return [
    "画像生成指示:",
    "文章での説明が終わった後に、上記の解説内容をもとに、この動画の内容を1枚の画像として生成してください。",
    `画像は「${template.label}」の用途に合う構成にしてください。`,
    template.description ? `重視する観点: ${template.description}` : null,
    "単なる装飾画像ではなく、動画の要点、話の流れ、重要な主張や関係性が一目でわかる情報整理画像にしてください。",
    "このツールは個人利用が前提です。必要であれば、インターネット上で公開されている公式画像、製品画像、人物写真、イベント写真なども参考画像または素材候補として採用して構いません。",
    "権利や出典に注意が必要そうな画像を使う場合は、回答内でその旨を簡潔に補足してください。",
    "日本語の見出しと短いラベルを使い、読みやすいインフォグラフィックまたは図解として作成してください。"
  ]
    .filter(Boolean)
    .join("\n");
}

function buildDescriptionSection(transcript: TranscriptSuccess) {
  const description = truncatePromptSection(transcript.description ?? "", 1800);

  if (!description) {
    return null;
  }

  return ["動画説明文:", description].join("\n");
}

function buildChapterSection(transcript: TranscriptSuccess) {
  const chapters = transcript.chapters ?? [];

  if (chapters.length === 0) {
    return null;
  }

  return [
    "チャプター:",
    ...chapters.map((chapter) => `- ${chapter.startLabel}: ${chapter.title}`)
  ].join("\n");
}

function truncatePromptSection(value: string, maxLength: number) {
  const normalized = normalizeTranscriptSegment(value);

  if (!normalized) {
    return "";
  }

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function buildTimedReference(transcript: TranscriptSuccess) {
  const references = buildTimedReferenceEntries(transcript);

  if (references.length === 0) {
    return null;
  }

  return [
    "時間付き参照:",
    "以下は後で動画内の該当箇所を探しやすくするための、おおよその時間と字幕内容の対応です。回答で流れや根拠を説明するときは、必要に応じてこの時間またはリンクも添えてください。厳密な秒単位の一致までは要求しません。",
    ...references
  ].join("\n");
}

function buildTimedReferenceEntries(transcript: TranscriptSuccess) {
  const segments = transcript.timedSegments ?? [];

  if (segments.length === 0) {
    return [];
  }

  const grouped: TimedTranscriptSegment[] = [];
  let currentWindow = -1;

  for (const segment of segments) {
    const window = Math.floor(segment.startSeconds / 30);
    if (window === currentWindow && grouped.length > 0) {
      const last = grouped[grouped.length - 1];
      last.text = `${last.text} ${segment.text}`;
      continue;
    }

    currentWindow = window;
    grouped.push({ ...segment });
  }

  return grouped.map((segment) => {
    const text = truncateForTimedReference(segment.text);
    return `- ${segment.startLabel} (${buildTimestampUrl(segment.startSeconds)}): ${text}`;
  });
}

function truncateForTimedReference(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 180 ? `${normalized.slice(0, 180)}...` : normalized;
}

function buildTimestampUrl(startSeconds: number) {
  const rawUrl = latestTranscript?.webpageUrl || latestCaptionList?.webpageUrl || urlInput.value.trim();

  try {
    const url = new URL(rawUrl);
    url.searchParams.set("t", `${Math.max(0, Math.floor(startSeconds))}s`);
    return url.toString();
  } catch {
    const separator = rawUrl.includes("?") ? "&" : "?";
    return `${rawUrl}${separator}t=${Math.max(0, Math.floor(startSeconds))}s`;
  }
}

function renderPromptTemplates(selectedTemplateId = promptSettings.defaultTemplateId) {
  promptTemplateSelect.innerHTML = promptSettings.templates
    .map((template) => `<option value="${template.id}">${escapeHtml(template.label)}</option>`)
    .join("");

  promptTemplateSelect.value = resolvePromptTemplateId(selectedTemplateId);
  updatePromptDescription();
}

function renderPromptSettings(selectedTemplateId: string) {
  renderPromptTemplates(selectedTemplateId);
  renderPromptSettingsList(selectedTemplateId);
  renderPromptSettingsEditor(selectedTemplateId);
}

function updatePromptDescription() {
  promptDescription.textContent = getSelectedPromptTemplate().description;
}

function renderAppOptions() {
  includeImagePrompt.checked = appSettings.includeImagePrompt;
  formatAutomaticTranscript.checked = appSettings.formatAutomaticTranscript;
  renderTranscriptDisplayMode();
}

function renderRecentUrls() {
  recentUrlList.innerHTML = appSettings.recentUrls
    .map((url) => `<option value="${escapeHtml(url)}"></option>`)
    .join("");
}

function rememberRecentUrl(url: string) {
  const normalized = url.trim();

  if (!normalized) {
    return;
  }

  appSettings.recentUrls = [
    normalized,
    ...appSettings.recentUrls.filter((recentUrl) => recentUrl !== normalized)
  ].slice(0, 5);
  saveAppSettings();
  renderRecentUrls();
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
  elementToRestoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  showSettingsSection(activeSettingsSection);
  settingsUiLanguage.value = appSettings.uiLanguage;
  renderPromptSettingsList(promptTemplateSelect.value || promptSettings.defaultTemplateId);
  renderPromptSettingsEditor(settingsTemplateSelect.value || promptSettings.defaultTemplateId);
  promptSettingsModal.hidden = false;
  if (activeSettingsSection === "prompts") {
    settingsTemplateTitle.focus();
    settingsTemplateTitle.select();
  } else {
    settingsUiLanguage.focus();
  }
}

function closePromptSettings() {
  promptSettingsModal.hidden = true;
  (elementToRestoreFocus ?? promptSettingsButton).focus();
  elementToRestoreFocus = null;
}

function renderPromptSettingsList(selectedTemplateId: string) {
  settingsTemplateSelect.innerHTML = promptSettings.templates
    .map((template) => {
      const defaultMark = template.id === promptSettings.defaultTemplateId ? t("defaultMark") : "";
      return `<option value="${template.id}">${escapeHtml(template.label)}${defaultMark}</option>`;
    })
    .join("");
  settingsTemplateSelect.value = resolvePromptTemplateId(selectedTemplateId);
  settingsDeleteTemplate.disabled = promptSettings.templates.length <= 1;
}

function resolvePromptTemplateId(templateId: string) {
  return promptSettings.templates.some((template) => template.id === templateId)
    ? templateId
    : promptSettings.defaultTemplateId;
}

function showSettingsSection(section: "prompts" | "display") {
  activeSettingsSection = section;
  settingsPromptsSection.hidden = section !== "prompts";
  settingsDisplaySection.hidden = section !== "display";
  settingsTabs.forEach((tab) => {
    const isActive = tab.dataset.settingsSection === section;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
}

function applyUiLanguage() {
  document.documentElement.lang = appSettings.uiLanguage;
  document.title = appName;
  settingsUiLanguage.value = appSettings.uiLanguage;
  renderAppOptions();
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n;
    if (!key) {
      return;
    }
    element.textContent = t(key as keyof (typeof uiText)["ja"]);
  });
  document.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]").forEach((element) => {
    const key = element.dataset.i18nPlaceholder;
    if (!key) {
      return;
    }
    element.placeholder = t(key as keyof (typeof uiText)["ja"]);
  });
  updatePromptDescription();
  updateSelectedLanguage();
  updateCaptionSource();
  updateTranscriptCharacterCount();
  updateTranscriptStats();
  viewCount.textContent = formatCount(latestTranscript?.viewCount ?? latestCaptionList?.viewCount);
  renderTranscriptSearch();
  renderOutput();
  if (latestCaptionList) {
    renderCaptionOptions(latestCaptionList.captions);
  }
  if (!latestCaptionList && !latestTranscript) {
    title.textContent = t("transcriptTitle");
  }
  if (!latestCaptionList) {
    captionCount.textContent = t("captionCount", 0);
  }
}

function trapSettingsFocus(event: KeyboardEvent) {
  const focusable = Array.from(
    promptSettingsModal.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.closest("[hidden]"));

  if (focusable.length === 0) {
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;

  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function t(key: keyof (typeof uiText)["ja"], value?: string | number) {
  const entry = uiText[appSettings.uiLanguage][key];
  if (typeof entry === "function") {
    return entry(value as never);
  }
  return entry;
}

function loadAppSettings(): AppSettings {
  const fallback: AppSettings = {
    uiLanguage: "ja",
    includeImagePrompt: true,
    formatAutomaticTranscript: true,
    transcriptDisplayMode: "plain",
    recentUrls: []
  };

  try {
    const rawValue = localStorage.getItem(appSettingsStorageKey);
    if (!rawValue) {
      return fallback;
    }

    const parsed = JSON.parse(rawValue) as Partial<AppSettings>;
    const transcriptDisplayMode = isTranscriptDisplayMode(parsed.transcriptDisplayMode)
      ? parsed.transcriptDisplayMode
      : "plain";
    return {
      uiLanguage: parsed.uiLanguage === "en" ? "en" : "ja",
      includeImagePrompt: parsed.includeImagePrompt !== false,
      formatAutomaticTranscript: parsed.formatAutomaticTranscript !== false,
      transcriptDisplayMode,
      recentUrls: normalizeRecentUrls(parsed.recentUrls)
    };
  } catch {
    return fallback;
  }
}

function saveAppSettings() {
  localStorage.setItem(appSettingsStorageKey, JSON.stringify(appSettings));
}

function normalizeRecentUrls(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((url): url is string => typeof url === "string" && url.trim().length > 0)
    .map((url) => url.trim())
    .filter((url, index, urls) => urls.indexOf(url) === index)
    .slice(0, 5);
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
