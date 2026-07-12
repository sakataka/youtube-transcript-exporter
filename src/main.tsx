import "./style.css";
import "./theme";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { AppShell } from "./components/AppShell";
import { CaptionOptions, HistoryList, SearchResults } from "./components/DynamicUi";
import { invokeBackend } from "./backendClient";
import { getCodexAnswerTextForCopy, normalizeCodexAnswerMarkdown } from "./codexAnswerText";
import { escapeHtml, renderMarkdown as renderMarkdownOutput } from "./markdownRenderer";
import {
  buildAnalysisPrompt as buildAnalysisPromptText,
  buildFollowUpPrompt as buildFollowUpPromptText
} from "./promptBuilder";
import { buildTimestampUrl as buildTimestampUrlFromBase } from "./timestamp";
import {
  getSearchableSegments,
  getTranscriptTextForDisplay as buildTranscriptTextForDisplay,
  normalizeTranscriptSegment
} from "./transcriptText";
import type {
  ApiFailure,
  AppSettings,
  CaptionListSuccess,
  CaptionOption,
  CaptionSource,
  CodexAnswerContext,
  CodexHistoryEntry,
  CodexJobStartSuccess,
  CodexJobStatus,
  CodexOutputMode,
  CodexQuestionKind,
  PendingCodexRequest,
  PromptSettings,
  PromptTemplate,
  StoredAppSettings,
  TimedTranscriptSegment,
  TranscriptDisplayMode,
  TranscriptSuccess
} from "./types";

type DebugLogReadResult = {
  path: string;
  content: string;
};

type SearchableTranscriptEntry = {
  segment: TimedTranscriptSegment;
  normalizedText: string;
};

const promptSettingsStorageKey = "youtube-transcript-exporter.prompt-settings.v1";
const appSettingsStorageKey = "youtube-transcript-exporter.app-settings.v1";
const codexHistoryStorageKey = "youtube-ai-brief.codex-history.v1";
const codexHistoryLimit = 20;
const codexPollIntervalMs = 900;
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
      "5. 現時点の最新状況と照らした客観的な確認",
      "6. 自分ならどう判断すべきか"
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
let activeSettingsSection: "prompts" | "copy" | "display" = "prompts";

const uiText = {
  ja: {
    eyebrow: "YouTube to AI prompt tool",
    heading: "YouTube動画をAI向けに整理",
    urlLabel: "YouTube URL",
    mediaPathLabel: "ローカル動画ファイル",
    mediaPathPlaceholder: "/Users/you/Movies/video.mp4",
    transcribeMedia: "動画を文字起こし",
    transcribeMediaLoading: "文字起こし中",
    hint: "自動翻訳字幕は除外し、動画に紐づく字幕・自動字幕のみ表示します。",
    videoId: "動画ID",
    selectedLanguage: "選択言語",
    characterCount: "文字数",
    videoDuration: "動画時間",
    canonicalUrl: "動画URL",
    canonicalUrlLink: "リンク",
    viewCount: "再生数",
    captionSourceLabel: "字幕種別",
    copyPrompt: "生成AIプロンプト",
    copyOptions: "コピー設定",
    includeImagePrompt: "画像生成指示を含む",
    formatAutomaticTranscript: "自動字幕を整形",
    transcriptDisplayModeLabel: "字幕表示のタイムスタンプ",
    plainTranscript: "なし",
    timestampedTranscript: "あり",
    transcriptView: "字幕本文",
    copyPromptView: "生成AIプロンプト",
    codexAnswerView: "AI回答",
    transcriptSearchTitle: "字幕内検索",
    transcriptSearchToggle: "検索",
    transcriptSearchLabel: "検索語",
    transcriptSearchPlaceholder: "字幕を検索",
    transcriptSearchDisabled: "字幕取得後に検索できます。",
    transcriptSearchReady: "検索語を入力してください。",
    transcriptSearchEmpty: "一致する字幕がありません。",
    transcriptSearchCount: (count: number) => `${count.toLocaleString("ja-JP")}件一致`,
    openTimestamp: "YouTubeで開く",
    reloadButton: "更新",
    settingsButton: "設定",
    fetchTranscript: "字幕を取得",
    fetchTranscriptLoading: "取得中",
    copy: "コピー",
    askCodex: "AIに聞く",
    askCodexLoading: "取得・質問中",
    codexWorking: "Codexが回答を生成しています",
    codexHistoryTitle: "AI回答履歴",
    codexHistoryEmpty: "AI回答の履歴はまだありません。",
    codexHistoryRestored: "履歴からAI回答を復元しました。",
    clearCodexHistory: "履歴をクリア",
    codexHistoryCleared: "AI回答履歴を削除しました。",
    copyAnswer: "回答をコピー",
    saveMarkdown: "Markdown保存",
    rerunAnswer: "再実行",
    followUpAnswer: "追加質問",
    askSelection: "選択範囲で質問",
    cancelCodex: "キャンセル",
    codexCancelled: "Codexへの質問をキャンセルしました。",
    codexAnswerCopied: "AI回答をクリップボードにコピーしました。",
    codexNoAnswer: "コピーできるAI回答がありません。",
    codexNoSelection: "質問に使う選択範囲がありません。",
    followUpTitle: "追加質問",
    followUpLabel: "質問内容",
    followUpPlaceholder: "この回答や選択範囲について追加で聞きたいこと",
    followUpSubmit: "質問する",
    followUpCancel: "閉じる",
    followUpRequired: "追加質問を入力してください。",
    historyRestoredPrefix: "履歴",
    transcriptTitle: "AI向け入力",
    initialMessage: "URLを入力して字幕候補を確認してください。",
    captionsTitle: "取得可能な字幕",
    settingsEyebrow: "Settings",
    settingsTitle: "設定",
    close: "閉じる",
    promptsTab: "プロンプト",
    copyTab: "コピー",
    displayTab: "表示",
    copySettingsTitle: "コピー設定",
    copySettingsDescription: "字幕取得後にクリップボードへ入れる内容と、AIへ渡す追加指示をまとめて管理します。",
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
    completionSound: "AI回答の完了時に音を鳴らす",
    debugLog: "デバッグログ",
    debugLogDescription: "取得時間、生成AIへの依頼内容、応答タイミング、表示処理のタイミングをローカルログへ記録します。外部アプリを開かず、この画面で確認できます。",
    showDebugLog: "ログを表示",
    refreshDebugLog: "ログを更新",
    debugLogLoaded: "デバッグログを表示しました。",
    debugLogLoadFailed: "デバッグログを読み込めませんでした。",
    debugLogEmpty: "ログはまだありません。",
    debugLogPath: "保存先",
    japanese: "日本語",
    english: "English",
    urlRequired: "YouTube URLを入力してください。",
    mediaPathRequired: "ローカル動画ファイルのパスを入力してください。",
    transcribingMedia: "Kanaryで動画を文字起こししています。",
    transcribeMediaFailed: "動画の文字起こしに失敗しました。",
    mediaTranscriptReady: "動画の文字起こしを取得しました。",
    chooseCaption: "取得する字幕を選んでください。",
    noCaptions: "字幕が見つかりません。",
    listCaptionsFailed: "字幕候補の取得に失敗しました。",
    ytDlpInstallHint: "Homebrewの場合は `brew install yt-dlp` を実行してから、アプリを再起動してください。",
    captionReady: "選択した字幕を取得しました。",
    selectCaption: "取得する字幕を選択してください。",
    fetchingCaptions: "字幕候補を確認しています。",
    fetchingTranscript: "選択した字幕を取得しています。",
    fetchTranscriptFailed: "取得に失敗しました。",
    transcriptCopyFailed: "取得しましたが、クリップボードにコピーできませんでした。コピーボタンを押すか、本文を選択して手動でコピーしてください。",
    copyFailed: "クリップボードにコピーできませんでした。本文を選択して手動でコピーしてください。",
    codexPromptRequired: "字幕を取得してから生成AIに質問してください。",
    askingCodex: "",
    codexAnswerReady: "Codexの回答を取得しました。",
    codexAnswerFailed: "Codexから回答を取得できませんでした。",
    promptChanged: "プロンプトを変更しました。コピーするとこの形式でクリップボードに入ります。",
    copyOptionsChanged: "コピー設定を変更しました。表示とコピー内容に反映しました。",
    settingsReset: "プロンプト設定を初期状態に戻しました。",
    settingsSaved: "プロンプト設定を保存しました。",
    languageSaved: "UI言語を保存しました。",
    displaySaved: "表示設定を保存しました。",
    newPrompt: "新しいプロンプト",
    newPromptDescription: "説明を入力してください",
    newPromptInstruction: "以下はYouTube動画の字幕です。内容を日本語で整理してください。",
    untitledPrompt: "無題のプロンプト",
    copiedWithPrompt: (label: string) => `取得しました。「${label}」プロンプト付きでクリップボードにコピーしました。`,
    defaultMark: " / デフォルト",
    manualCaption: "字幕",
    automaticCaption: "自動字幕",
    kanaryTranscript: "Kanary文字起こし",
    captionCount: (count: number) => `${count.toLocaleString("ja-JP")}件`
  },
  en: {
    eyebrow: "YouTube to AI prompt tool",
    heading: "Prepare YouTube Videos for AI",
    urlLabel: "YouTube URL",
    mediaPathLabel: "Local video file",
    mediaPathPlaceholder: "/Users/you/Movies/video.mp4",
    transcribeMedia: "Transcribe video",
    transcribeMediaLoading: "Transcribing",
    hint: "Shows only captions and auto captions attached to the video, excluding auto-translated captions.",
    videoId: "Video ID",
    selectedLanguage: "Selected language",
    characterCount: "Characters",
    videoDuration: "Duration",
    canonicalUrl: "Video URL",
    canonicalUrlLink: "Link",
    viewCount: "Views",
    captionSourceLabel: "Caption type",
    copyPrompt: "Generative AI prompt",
    copyOptions: "Copy settings",
    includeImagePrompt: "Include image prompt",
    formatAutomaticTranscript: "Clean auto captions",
    transcriptDisplayModeLabel: "Transcript timestamps",
    plainTranscript: "Off",
    timestampedTranscript: "On",
    transcriptView: "Transcript",
    copyPromptView: "Generative AI prompt",
    codexAnswerView: "AI answer",
    transcriptSearchTitle: "Search transcript",
    transcriptSearchToggle: "Search",
    transcriptSearchLabel: "Search term",
    transcriptSearchPlaceholder: "Search transcript",
    transcriptSearchDisabled: "Search is available after fetching a transcript.",
    transcriptSearchReady: "Enter a search term.",
    transcriptSearchEmpty: "No matching captions found.",
    transcriptSearchCount: (count: number) => `${count.toLocaleString("en-US")} match${count === 1 ? "" : "es"}`,
    openTimestamp: "Open in YouTube",
    reloadButton: "Reload",
    settingsButton: "Settings",
    fetchTranscript: "Fetch",
    fetchTranscriptLoading: "Getting",
    copy: "Copy",
    askCodex: "Ask AI",
    askCodexLoading: "Getting and asking",
    codexWorking: "Codex is generating an answer",
    codexHistoryTitle: "AI answer history",
    codexHistoryEmpty: "No AI answer history yet.",
    codexHistoryRestored: "Restored an AI answer from history.",
    clearCodexHistory: "Clear history",
    codexHistoryCleared: "Cleared AI answer history.",
    copyAnswer: "Copy answer",
    saveMarkdown: "Save Markdown",
    rerunAnswer: "Rerun",
    followUpAnswer: "Follow up",
    askSelection: "Ask about selection",
    cancelCodex: "Cancel",
    codexCancelled: "Cancelled the Codex request.",
    codexAnswerCopied: "Copied the AI answer.",
    codexNoAnswer: "There is no AI answer to copy.",
    codexNoSelection: "Select text to ask about.",
    followUpTitle: "Follow-up question",
    followUpLabel: "Question",
    followUpPlaceholder: "Ask a follow-up about this answer or selection",
    followUpSubmit: "Ask",
    followUpCancel: "Close",
    followUpRequired: "Enter a follow-up question.",
    historyRestoredPrefix: "History",
    transcriptTitle: "AI-ready input",
    initialMessage: "Enter a URL to check available captions.",
    captionsTitle: "Available captions",
    settingsEyebrow: "Settings",
    settingsTitle: "Settings",
    close: "Close",
    promptsTab: "Prompts",
    copyTab: "Copy",
    displayTab: "Display",
    copySettingsTitle: "Copy settings",
    copySettingsDescription: "Controls copied transcript content and the extra instructions sent to AI after fetching captions.",
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
    completionSound: "Play a sound when the AI answer completes",
    debugLog: "Debug log",
    debugLogDescription: "Writes local timing logs for caption fetching, AI prompts, response timing, and rendering. You can read it here without opening another app.",
    showDebugLog: "Show log",
    refreshDebugLog: "Refresh log",
    debugLogLoaded: "Debug log loaded.",
    debugLogLoadFailed: "Could not read the debug log.",
    debugLogEmpty: "No log entries yet.",
    debugLogPath: "Path",
    japanese: "Japanese",
    english: "English",
    urlRequired: "Enter a YouTube URL.",
    mediaPathRequired: "Enter a local video file path.",
    transcribingMedia: "Transcribing the video with Kanary.",
    transcribeMediaFailed: "Failed to transcribe the video.",
    mediaTranscriptReady: "Fetched the video transcription.",
    chooseCaption: "Choose the caption to fetch.",
    noCaptions: "No captions found.",
    listCaptionsFailed: "Failed to fetch caption candidates.",
    ytDlpInstallHint: "If you use Homebrew, run `brew install yt-dlp`, then restart the app.",
    captionReady: "Fetched the selected caption.",
    selectCaption: "Select a caption to fetch.",
    fetchingCaptions: "Checking caption candidates.",
    fetchingTranscript: "Getting the selected caption.",
    fetchTranscriptFailed: "Failed to fetch the transcript.",
    transcriptCopyFailed: "Fetched the transcript, but could not copy it to the clipboard. Press Copy or select the text manually.",
    copyFailed: "Could not copy to the clipboard. Select the text and copy it manually.",
    codexPromptRequired: "Fetch a transcript before asking AI.",
    askingCodex: "",
    codexAnswerReady: "Codex answer is ready.",
    codexAnswerFailed: "Could not get a Codex answer.",
    promptChanged: "Prompt changed. Copy will use this format.",
    copyOptionsChanged: "Copy settings updated. Display and copied text now use them.",
    settingsReset: "Prompt settings were reset to defaults.",
    settingsSaved: "Prompt settings saved.",
    languageSaved: "UI language saved.",
    displaySaved: "Display settings saved.",
    newPrompt: "New prompt",
    newPromptDescription: "Enter a description",
    newPromptInstruction: "The following is a YouTube video transcript. Please organize the content clearly.",
    untitledPrompt: "Untitled prompt",
    copiedWithPrompt: (label: string) => `Copied with the "${label}" prompt.`,
    defaultMark: " / Default",
    manualCaption: "Caption",
    automaticCaption: "Auto caption",
    kanaryTranscript: "Kanary transcription",
    captionCount: (count: number) => `${count.toLocaleString("en-US")} item${count === 1 ? "" : "s"}`
  }
};

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root was not found.");
}
flushSync(() => {
  createRoot(app).render(<AppShell />);
});

const form = document.querySelector<HTMLFormElement>("#caption-form")!;
const urlInput = document.querySelector<HTMLInputElement>("#youtube-url")!;
const mediaPathInput = document.querySelector<HTMLInputElement>("#local-media-path")!;
const askCodexButton = document.querySelector<HTMLButtonElement>("#ask-codex-button")!;
const askCodexButtonLabel = document.querySelector<HTMLElement>("#ask-codex-button-label")!;
const transcribeMediaButton = document.querySelector<HTMLButtonElement>("#transcribe-media-button")!;
const transcribeMediaButtonLabel = document.querySelector<HTMLElement>("#transcribe-media-button-label")!;
const promptTemplateSelect = document.querySelector<HTMLSelectElement>("#prompt-template")!;
const promptDescription = document.querySelector<HTMLParagraphElement>("#prompt-description")!;
const reloadAppButton = document.querySelector<HTMLButtonElement>("#reload-app-button")!;
const promptSettingsButton = document.querySelector<HTMLButtonElement>("#prompt-settings-button")!;
const includeImagePrompt = document.querySelector<HTMLInputElement>("#include-image-prompt")!;
const formatAutomaticTranscript = document.querySelector<HTMLInputElement>("#format-automatic-transcript")!;
const promptSettingsModal = document.querySelector<HTMLElement>("#prompt-settings-modal")!;
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
const settingsUiLanguage = document.querySelector<HTMLSelectElement>("#settings-ui-language")!;
const settingsCompletionSound = document.querySelector<HTMLInputElement>("#settings-completion-sound")!;
const settingsOpenDebugLog = document.querySelector<HTMLButtonElement>("#settings-open-debug-log")!;
const settingsDebugLogViewer = document.querySelector<HTMLDivElement>("#settings-debug-log-viewer")!;
const settingsDebugLogPath = document.querySelector<HTMLElement>("#settings-debug-log-path")!;
const settingsDebugLogContent = document.querySelector<HTMLTextAreaElement>("#settings-debug-log-content")!;
const settingsSaveDisplay = document.querySelector<HTMLButtonElement>("#settings-save-display")!;
const captionPanel = document.querySelector<HTMLElement>("#caption-panel")!;
const captionList = document.querySelector<HTMLDivElement>("#caption-list")!;
const captionCount = document.querySelector<HTMLElement>("#caption-count")!;
const output = document.querySelector<HTMLTextAreaElement>("#transcript-output")!;
const codexAnswerOutput = document.querySelector<HTMLDivElement>("#codex-answer-output")!;
const message = document.querySelector<HTMLElement>("#message")!;
const title = document.querySelector<HTMLHeadingElement>("#video-title")!;
const language = document.querySelector<HTMLElement>("#language")!;
const charCount = document.querySelector<HTMLElement>("#char-count")!;
const videoDuration = document.querySelector<HTMLElement>("#video-duration")!;
const canonicalUrl = document.querySelector<HTMLElement>("#canonical-url")!;
const viewCount = document.querySelector<HTMLElement>("#view-count")!;
const captionSource = document.querySelector<HTMLElement>("#caption-source")!;
const transcriptDisplayModeInputs = Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="transcript-display-mode"]')
);
const transcriptSearchPanel = document.querySelector<HTMLElement>("#transcript-search-panel")!;
const transcriptSearchToggle = document.querySelector<HTMLButtonElement>("#transcript-search-toggle")!;
const transcriptSearchInput = document.querySelector<HTMLInputElement>("#transcript-search")!;
const transcriptSearchCount = document.querySelector<HTMLElement>("#transcript-search-count")!;
const transcriptSearchResults = document.querySelector<HTMLDivElement>("#transcript-search-results")!;
const outputTabDivider = document.querySelector<HTMLSpanElement>(".output-tab-divider")!;
const codexToolbar = document.querySelector<HTMLDivElement>("#codex-toolbar")!;
const copyCodexAnswerButton = document.querySelector<HTMLButtonElement>("#copy-codex-answer")!;
const saveCodexMarkdownButton = document.querySelector<HTMLButtonElement>("#save-codex-markdown")!;
const rerunCodexAnswerButton = document.querySelector<HTMLButtonElement>("#rerun-codex-answer")!;
const followUpCodexAnswerButton = document.querySelector<HTMLButtonElement>("#follow-up-codex-answer")!;
const askSelectionCodexButton = document.querySelector<HTMLButtonElement>("#ask-selection-codex")!;
const cancelCodexAnswerButton = document.querySelector<HTMLButtonElement>("#cancel-codex-answer")!;
const codexHistoryPanel = document.querySelector<HTMLElement>("#codex-history-panel")!;
const codexHistoryList = document.querySelector<HTMLDivElement>("#codex-history-list")!;
const codexHistoryCount = document.querySelector<HTMLElement>("#codex-history-count")!;
const clearCodexHistoryButton = document.querySelector<HTMLButtonElement>("#clear-codex-history")!;
const videoPreview = document.querySelector<HTMLDivElement>("#video-preview")!;
const videoThumbnail = document.querySelector<HTMLImageElement>("#video-thumbnail")!;
const videoPreviewTitle = document.querySelector<HTMLElement>("#video-preview-title")!;
const followUpModal = document.querySelector<HTMLElement>("#follow-up-modal")!;
const followUpQuestion = document.querySelector<HTMLTextAreaElement>("#follow-up-question")!;
const followUpClose = document.querySelector<HTMLButtonElement>("#follow-up-close")!;
const followUpSubmit = document.querySelector<HTMLButtonElement>("#follow-up-submit")!;
const captionListRoot = createRoot(captionList);
const transcriptSearchResultsRoot = createRoot(transcriptSearchResults);
const codexHistoryListRoot = createRoot(codexHistoryList);

let latestCaptionList: CaptionListSuccess | null = null;
let selectedCaption: CaptionOption | null = null;
let latestTranscript: TranscriptSuccess | null = null;
let latestCodexAnswer = "";
let latestCodexQuestionKind: CodexQuestionKind = "initial";
let latestCodexQuestionText = "";
let latestCodexSelectedExcerpt = "";
let latestCodexAnswerContext: CodexAnswerContext | null = null;
let pendingCodexRequest: PendingCodexRequest | null = null;
let captionRequestToken = 0;
let transcriptRequestToken = 0;
let codexRequestToken = 0;
let captionAutoCheckTimer: number | undefined;
let lastCaptionCheckUrl = "";
let mediaTranscriptRequestToken = 0;
let isStartingCodexRequest = false;
let codexPollTimer: number | undefined;
let codexHistory = loadCodexHistory();
let outputMode: CodexOutputMode = "transcript";
let isTranscriptSearchExpanded = false;
let latestSelectedOutputText = "";
let completionAudioContext: AudioContext | null = null;
let completionAudioPrimed = false;
let elementToRestoreFocus: HTMLElement | null = null;
let followUpContext: { kind: CodexQuestionKind; selectedExcerpt: string } | null = null;
let transcriptDerivedCache: {
  transcript: TranscriptSuccess;
  formatAutomaticTranscript: boolean;
  transcriptDisplayMode: TranscriptDisplayMode;
  displayText?: string;
  searchableSegments?: TimedTranscriptSegment[];
  searchableIndex?: SearchableTranscriptEntry[];
} | null = null;
let codexMarkdownCache: { markdown: string; timestampBaseUrl: string; html: string } | null = null;

clearUrlInputOnLaunch();
renderPromptTemplates();
renderAppOptions();
renderTranscriptDisplayMode();
renderTranscriptSearch();
renderCodexControls();
renderCodexHistory();
applyUiLanguage();
focusUrlInput();
window.addEventListener("load", focusUrlInput);
window.addEventListener("resize", resizeTextOutput);
window.addEventListener("pointerdown", primeCompletionAudio, { capture: true });
window.addEventListener("keydown", primeCompletionAudio, { capture: true });

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = urlInput.value.trim();

  if (!url) {
    showError(t("urlRequired"));
    return;
  }

  await checkCaptionCandidates(url);
});

transcribeMediaButton.addEventListener("click", async () => {
  await transcribeLocalMedia();
});

mediaPathInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") {
    return;
  }

  event.preventDefault();
  void transcribeLocalMedia();
});

urlInput.addEventListener("input", scheduleCaptionAutoCheck);

urlInput.addEventListener("paste", () => {
  requestAnimationFrame(scheduleCaptionAutoCheck);
});

captionList.addEventListener("change", (event) => {
  const target = event.target;

  if (!(target instanceof HTMLInputElement) || target.name !== "caption-option") {
    return;
  }

  selectedCaption = latestCaptionList?.captions[Number(target.value)] ?? null;
  transcriptRequestToken += 1;
  clearTranscript();
  askCodexButton.disabled = !selectedCaption;
  updateSelectedLanguage();
  updateCaptionSource();
  if (selectedCaption) {
    void fetchSelectedTranscript({ copyAfterFetch: false });
  }
});

askCodexButton.addEventListener("click", async () => {
  const transcript = latestTranscript ?? (await fetchSelectedTranscript({ copyAfterFetch: false }));
  if (!transcript) {
    showError(t("codexPromptRequired"));
    return;
  }

  await askCodexWithTranscript(transcript);
});

async function askCodexWithTranscript(transcript: TranscriptSuccess) {
  const template = getSelectedPromptTemplate();
  const prompt = buildAnalysisPrompt(transcript, template, {
    includeImageInstruction: false
  });
  appendDebugLog("frontend.codex_prompt.built", {
    templateId: template.id,
    generateImage: appSettings.includeImagePrompt,
    promptChars: prompt.length,
    promptPreview: truncateForLog(prompt, 8000)
  });
  await startCodexRequest(prompt, {
    questionKind: "initial",
    questionText: template.label,
    selectedExcerpt: "",
    templateId: template.id,
    generateImage: appSettings.includeImagePrompt,
    answerContext: getTranscriptAnswerContext(transcript)
  });
}

copyCodexAnswerButton.addEventListener("click", async () => {
  await copyLatestCodexAnswer();
});

saveCodexMarkdownButton.addEventListener("click", () => {
  saveLatestCodexAnswerAsMarkdown();
});

rerunCodexAnswerButton.addEventListener("click", async () => {
  await rerunLatestCodexRequest();
});

followUpCodexAnswerButton.addEventListener("click", () => {
  openFollowUpModal("followup", "");
});

askSelectionCodexButton.addEventListener("click", () => {
  const selectedExcerpt = getSelectedOutputText();
  if (!selectedExcerpt) {
    showMessage(t("codexNoSelection"), true);
    return;
  }
  openFollowUpModal("selection", selectedExcerpt);
});

cancelCodexAnswerButton.addEventListener("click", async () => {
  await cancelActiveCodexRequest();
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
  showMessage(t("copyOptionsChanged"));
});

formatAutomaticTranscript.addEventListener("change", () => {
  appSettings.formatAutomaticTranscript = formatAutomaticTranscript.checked;
  saveAppSettings();
  renderOutput();
  updateTranscriptCharacterCount();
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
      showMessage(t("copyOptionsChanged"));
    }
  });
});

transcriptSearchInput.addEventListener("input", () => {
  renderTranscriptSearch();
});

output.addEventListener("select", () => {
  cacheSelectedOutputText();
});

codexAnswerOutput.addEventListener("mouseup", () => {
  cacheSelectedOutputText();
});

codexAnswerOutput.addEventListener("keyup", () => {
  cacheSelectedOutputText();
});

transcriptSearchToggle.addEventListener("click", () => {
  if (!latestTranscript) {
    return;
  }

  isTranscriptSearchExpanded = !isTranscriptSearchExpanded;
  renderTranscriptSearch();
  if (isTranscriptSearchExpanded) {
    transcriptSearchInput.focus();
  }
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

codexAnswerOutput.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const timestampLink = target.closest<HTMLElement>("[data-timestamp-url]");
  if (timestampLink) {
    event.preventDefault();
    await openTimestampUrl(timestampLink.dataset.timestampUrl);
    return;
  }

  const link = target.closest<HTMLAnchorElement>("a[href]");
  if (!link) {
    return;
  }

  event.preventDefault();
  if (isYouTubeUrl(link.href)) {
    await openTimestampUrl(link.href);
    return;
  }

  await openExternalUrl(link.href);
});

document.addEventListener("ui:output-mode-change", (event) => {
  const mode = (event as CustomEvent<string>).detail;
  if (mode === "transcript" || mode === "copyPrompt" || mode === "codexAnswer") {
    setOutputMode(mode, false);
  }
});

document.addEventListener("ui:settings-section-change", (event) => {
  const section = (event as CustomEvent<string>).detail;
  if (section === "prompts" || section === "copy" || section === "display") {
    activeSettingsSection = section;
  }
});

promptSettingsButton.addEventListener("click", () => {
  openPromptSettings();
});

reloadAppButton.addEventListener("click", () => {
  window.location.reload();
});

promptSettingsClose.addEventListener("click", () => {
  closePromptSettings();
});

followUpClose.addEventListener("click", () => {
  closeFollowUpModal();
});

document.addEventListener("ui:settings-dialog-close-request", closePromptSettings);
document.addEventListener("ui:follow-up-dialog-close-request", closeFollowUpModal);

followUpSubmit.addEventListener("click", async () => {
  await submitFollowUpQuestion();
});

codexHistoryList.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const item = target.closest<HTMLElement>("[data-history-id]");
  if (!item) {
    return;
  }

  restoreCodexHistoryEntry(item.dataset.historyId);
});

clearCodexHistoryButton.addEventListener("click", () => {
  clearCodexHistory();
});

document.addEventListener("keydown", (event) => {
  if (isDialogOpen(followUpModal) && event.key === "Escape") {
    event.preventDefault();
    closeFollowUpModal();
    return;
  }

  if (isDialogOpen(followUpModal) && (event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    void submitFollowUpQuestion();
    return;
  }

  if (!isDialogOpen(promptSettingsModal)) {
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    closePromptSettings();
    return;
  }

});

document.addEventListener("selectionchange", () => {
  cacheSelectedOutputText();
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
  appSettings.completionSoundEnabled = settingsCompletionSound.checked;
  completionAudioPrimed = false;
  saveAppSettings();
  applyUiLanguage();
  renderPromptSettingsList(settingsTemplateSelect.value || promptSettings.defaultTemplateId);
  primeCompletionAudio();
  showMessage(t("displaySaved"));
});

settingsOpenDebugLog.addEventListener("click", async () => {
  try {
    await loadDebugLogIntoSettings();
    showMessage(t("debugLogLoaded"));
  } catch (error) {
    showMessage(formatInvokeError(error, t("debugLogLoadFailed")), true);
  }
});

async function loadDebugLogIntoSettings() {
  const log = await invokeBackend<DebugLogReadResult>("read_debug_log");
  settingsDebugLogPath.textContent = log.path;
  settingsDebugLogContent.value = log.content.trim() || t("debugLogEmpty");
  settingsDebugLogViewer.hidden = false;
  settingsOpenDebugLog.textContent = t("refreshDebugLog");
}

function renderCaptionOptions(captions: CaptionOption[]) {
  const selectedIndex = selectedCaption
    ? captions.findIndex(
        (caption) =>
          caption.language === selectedCaption?.language &&
          caption.source === selectedCaption?.source
      )
    : 0;
  flushSync(() => {
    captionListRoot.render(
      <CaptionOptions
        options={captions.map((caption, index) => ({
          index,
          language: caption.language,
          name: caption.name,
          selected: index === Math.max(selectedIndex, 0),
          source: formatCaptionSource(caption.source)
        }))}
      />
    );
  });
  captionCount.textContent = t("captionCount", captions.length);
  captionPanel.hidden = captions.length <= 1;
}

function setCaptionLoading(isLoading: boolean) {
  urlInput.toggleAttribute("aria-busy", isLoading);
}

function setTranscriptLoading(isLoading: boolean) {
  askCodexButton.disabled = isLoading || (!latestTranscript && !selectedCaption);
  askCodexButtonLabel.textContent = isLoading ? t("fetchTranscriptLoading") : t("askCodex");
  askCodexButton.setAttribute("aria-busy", String(isLoading));
  askCodexButton.classList.toggle("is-loading", isLoading);
}

function setMediaTranscriptionLoading(isLoading: boolean) {
  transcribeMediaButton.disabled = isLoading;
  transcribeMediaButtonLabel.textContent = isLoading ? t("transcribeMediaLoading") : t("transcribeMedia");
  transcribeMediaButton.setAttribute("aria-busy", String(isLoading));
  transcribeMediaButton.classList.toggle("is-loading", isLoading);
  mediaPathInput.toggleAttribute("aria-busy", isLoading);
}

function setCodexLoading(isLoading: boolean) {
  askCodexButton.disabled = isLoading || (!latestTranscript && !selectedCaption);
  askCodexButtonLabel.textContent = isLoading ? t("askCodexLoading") : t("askCodex");
  askCodexButton.setAttribute("aria-busy", String(isLoading));
  askCodexButton.classList.toggle("is-loading", isLoading);
  cancelCodexAnswerButton.hidden = !isLoading;
  renderCodexControls();
}

async function transcribeLocalMedia() {
  const path = mediaPathInput.value.trim();

  if (!path) {
    showError(t("mediaPathRequired"));
    return null;
  }

  const requestToken = (mediaTranscriptRequestToken += 1);
  captionRequestToken += 1;
  transcriptRequestToken += 1;
  clearResult();
  setMediaTranscriptionLoading(true);
  askCodexButton.disabled = true;
  showMessage(t("transcribingMedia"));
  appendDebugLog("frontend.transcribe_media.request", {
    path
  });

  try {
    const payload = await invokeBackend<TranscriptSuccess>("transcribe_media", { path });

    if (requestToken !== mediaTranscriptRequestToken) {
      return null;
    }

    const caption: CaptionOption = {
      language: payload.language,
      name: t("kanaryTranscript"),
      source: payload.source,
      isAutoCaption: false
    };
    selectedCaption = caption;
    applyTranscriptPayload(payload, caption);
    appendDebugLog("frontend.transcribe_media.applied", {
      textChars: payload.text.length,
      sourcePath: payload.sourcePath
    });
    showMessage(t("mediaTranscriptReady"));
    return payload;
  } catch (error) {
    if (requestToken !== mediaTranscriptRequestToken) {
      return null;
    }

    showError(formatInvokeError(error, t("transcribeMediaFailed")));
    return null;
  } finally {
    if (requestToken === mediaTranscriptRequestToken) {
      setMediaTranscriptionLoading(false);
      askCodexButton.disabled = !latestTranscript;
    }
  }
}

async function fetchSelectedTranscript(options: { copyAfterFetch: boolean }) {
  const url = urlInput.value.trim();

  if (!url || !selectedCaption) {
    showError(t("selectCaption"));
    return null;
  }

  const requestToken = (transcriptRequestToken += 1);
  const requestedCaption = selectedCaption;
  const startedAt = performance.now();
  clearTranscript();
  setTranscriptLoading(true);
  askCodexButton.disabled = true;
  appendDebugLog("frontend.fetch_transcript.request", {
    language: requestedCaption.language,
    source: requestedCaption.source,
    copyAfterFetch: options.copyAfterFetch
  });

  try {
    const payload = await invokeBackend<TranscriptSuccess>("fetch_transcript", {
      url,
      language: requestedCaption.language,
      source: requestedCaption.source
    });

    if (requestToken !== transcriptRequestToken) {
      return null;
    }

    applyTranscriptPayload(payload, requestedCaption);
    appendDebugLog("frontend.fetch_transcript.applied", {
      elapsedMs: Math.round(performance.now() - startedAt),
      textChars: payload.text.length,
      timedSegments: payload.timedSegments.length
    });

    if (options.copyAfterFetch) {
      try {
        await copyTranscriptToClipboard(payload, getDefaultPromptTemplate());
      } catch {
        showMessage(t("transcriptCopyFailed"), true);
      }
    }

    showMessage(t("captionReady"));
    return payload;
  } catch (error) {
    if (requestToken !== transcriptRequestToken) {
      return null;
    }

    showError(formatInvokeError(error, t("fetchTranscriptFailed")));
    return null;
  } finally {
    if (requestToken === transcriptRequestToken) {
      setTranscriptLoading(false);
      askCodexButton.disabled = !latestTranscript && !selectedCaption;
    }
  }
}

function applyTranscriptPayload(payload: TranscriptSuccess, requestedCaption: CaptionOption) {
  latestTranscript = payload;
  title.textContent = payload.title || t("transcriptTitle");
  renderVideoPreview(payload.title, payload.thumbnailUrl);
  videoDuration.textContent = payload.duration || "-";
  renderCanonicalUrl(payload.webpageUrl);
  viewCount.textContent = formatCount(payload.viewCount);
  language.textContent = formatCaptionLabel({
    language: payload.language,
    name: requestedCaption.name,
    source: payload.source,
    isAutoCaption: payload.source === "automatic"
  });
  updateCaptionSource();
  updateTranscriptCharacterCount();
  renderTranscriptSearch();
  askCodexButton.disabled = payload.text.length === 0;
  renderOutput();
}

function renderVideoPreview(videoTitle = "", thumbnailUrl?: string) {
  const titleText = videoTitle.trim();
  videoPreviewTitle.textContent = titleText || "-";

  if (!thumbnailUrl) {
    videoThumbnail.removeAttribute("src");
    videoPreview.hidden = !titleText;
    videoPreview.classList.add("is-text-only");
    return;
  }

  videoThumbnail.src = thumbnailUrl;
  videoPreview.hidden = false;
  videoPreview.classList.remove("is-text-only");
}

async function checkCaptionCandidates(url: string) {
  const requestToken = (captionRequestToken += 1);
  transcriptRequestToken += 1;
  lastCaptionCheckUrl = url;
  setCaptionLoading(true);
  clearResult();

  try {
    const payload = await invokeBackend<CaptionListSuccess>("list_captions", { url });

    if (requestToken !== captionRequestToken) {
      return;
    }

    latestCaptionList = payload;
    selectedCaption = payload.captions[0] ?? null;
    title.textContent = payload.title || t("transcriptTitle");
    renderVideoPreview(payload.title, payload.thumbnailUrl);
    videoDuration.textContent = payload.duration || "-";
    renderCanonicalUrl(payload.webpageUrl);
    viewCount.textContent = formatCount(payload.viewCount);
    renderCaptionOptions(payload.captions);
    askCodexButton.disabled = !selectedCaption;
    updateSelectedLanguage();
    updateCaptionSource();

    if (!selectedCaption) {
      showMessage(t("noCaptions"));
      return;
    }

    if (payload.captions.length === 1) {
      showMessage(t("fetchingTranscript"));
      const transcript = await fetchSelectedTranscript({ copyAfterFetch: false });
      if (requestToken === captionRequestToken && transcript) {
        await askCodexWithTranscript(transcript);
      }
      return;
    }

    showMessage(t("chooseCaption"));
  } catch (error) {
    if (requestToken !== captionRequestToken) {
      return;
    }

    showError(formatInvokeError(error, t("listCaptionsFailed")));
    lastCaptionCheckUrl = "";
  } finally {
    if (requestToken === captionRequestToken) {
      setCaptionLoading(false);
    }
  }
}

function scheduleCaptionAutoCheck() {
  if (captionAutoCheckTimer !== undefined) {
    window.clearTimeout(captionAutoCheckTimer);
  }

  captionAutoCheckTimer = window.setTimeout(() => {
    captionAutoCheckTimer = undefined;
    const url = urlInput.value.trim();

    if (!isLikelyYoutubeUrl(url) || url === lastCaptionCheckUrl) {
      return;
    }

    void checkCaptionCandidates(url);
  }, 450);
}

function clearResult() {
  latestCaptionList = null;
  selectedCaption = null;
  flushSync(() => captionListRoot.render(null));
  captionCount.textContent = t("captionCount", 0);
  captionPanel.hidden = true;
  title.textContent = t("transcriptTitle");
  renderVideoPreview();
  language.textContent = "-";
  videoDuration.textContent = "-";
  renderCanonicalUrl(undefined);
  viewCount.textContent = "-";
  updateCaptionSource();
  clearTranscript();
  message.classList.remove("error");
  message.hidden = true;
}

function clearTranscript() {
  latestTranscript = null;
  latestCodexAnswer = "";
  latestCodexQuestionKind = "initial";
  latestCodexQuestionText = "";
  latestCodexSelectedExcerpt = "";
  latestCodexAnswerContext = null;
  pendingCodexRequest = null;
  isStartingCodexRequest = false;
  codexRequestToken += 1;
  stopCodexPolling();
  charCount.textContent = "0";
  askCodexButton.disabled = !selectedCaption;
  isTranscriptSearchExpanded = false;
  transcriptSearchInput.value = "";
  latestSelectedOutputText = "";
  renderTranscriptSearch();
  renderCodexControls();
  renderOutput();
}

function showError(text: string) {
  latestTranscript = null;
  showMessage(text, true);
  askCodexButton.disabled = true;
  renderOutput();
}

function showMessage(text: string, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
  message.hidden = !text.trim();
}

function appendDebugLog(event: string, details: Record<string, unknown>) {
  void invokeBackend("append_debug_log", { entry: { event, details } }).catch(() => {
    // Debug logging must never block the primary workflow.
  });
}

function truncateForLog(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
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

  canonicalUrl.innerHTML = `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(t("canonicalUrlLink"))}</a>`;
}

canonicalUrl.addEventListener("click", async (event) => {
  const target = event.target;

  if (!(target instanceof HTMLElement)) {
    return;
  }

  const link = target.closest<HTMLAnchorElement>("a[href]");

  if (!link) {
    return;
  }

  event.preventDefault();
  await openTimestampUrl(link.href);
});

function formatCount(value: number | undefined) {
  return typeof value === "number"
    ? value.toLocaleString(appSettings.uiLanguage === "ja" ? "ja-JP" : "en-US")
    : "-";
}

function formatCaptionLabel(caption: CaptionOption) {
  return `${caption.language} (${formatCaptionSource(caption.source)})`;
}

function formatCaptionSource(source: CaptionSource) {
  if (source === "manual") {
    return t("manualCaption");
  }

  if (source === "kanary") {
    return t("kanaryTranscript");
  }

  return t("automaticCaption");
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

function setOutputMode(mode: CodexOutputMode, syncTabs = true) {
  outputMode = mode;
  if (syncTabs) {
    document.dispatchEvent(new CustomEvent("ui:output-mode-request", { detail: mode }));
  }
  renderOutput();
}

function renderOutput() {
  const renderStartedAt = performance.now();
  const isMarkdownOutput = outputMode === "codexAnswer";
  output.hidden = isMarkdownOutput;
  codexAnswerOutput.hidden = !isMarkdownOutput;
  codexToolbar.hidden = !isMarkdownOutput;
  outputTabDivider.hidden = !isMarkdownOutput;

  if (!latestTranscript) {
    output.value = "";
    codexAnswerOutput.innerHTML = isMarkdownOutput ? renderCodexMarkdown(latestCodexAnswer) : "";
    resizeTextOutput();
    renderCodexControls();
    logRenderOutput(renderStartedAt);
    return;
  }

  if (outputMode === "copyPrompt") {
    output.value = buildAnalysisPrompt(latestTranscript, getSelectedPromptTemplate());
    codexAnswerOutput.innerHTML = "";
    resizeTextOutput();
    logRenderOutput(renderStartedAt);
    return;
  }

  if (outputMode === "codexAnswer") {
    output.value = "";
    codexAnswerOutput.innerHTML = renderCodexMarkdown(latestCodexAnswer);
    resizeTextOutput();
    renderCodexControls();
    logRenderOutput(renderStartedAt);
    return;
  }

  codexAnswerOutput.innerHTML = "";
  output.value = getTranscriptTextForDisplay(latestTranscript);
  resizeTextOutput();
  renderCodexControls();
  logRenderOutput(renderStartedAt);
}

function resizeTextOutput() {
  if (output.hidden) {
    return;
  }

  output.style.height = "auto";
  output.style.height = `${output.scrollHeight}px`;
}

function logRenderOutput(renderStartedAt: number) {
  appendDebugLog("frontend.output.rendered", {
    mode: outputMode,
    elapsedMs: Math.round(performance.now() - renderStartedAt),
    transcriptChars: latestTranscript?.text.length ?? 0,
    answerChars: latestCodexAnswer.length
  });
}

function renderCodexMarkdown(markdown: string) {
  const timestampBaseUrl = getTimestampBaseUrl();
  if (
    codexMarkdownCache &&
    codexMarkdownCache.markdown === markdown &&
    codexMarkdownCache.timestampBaseUrl === timestampBaseUrl
  ) {
    return codexMarkdownCache.html;
  }

  codexMarkdownCache = {
    markdown,
    timestampBaseUrl,
    html: renderMarkdownOutput(markdown, { buildTimestampUrl })
  };
  return codexMarkdownCache.html;
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

async function startCodexRequest(
  prompt: string,
  options: {
    questionKind: CodexQuestionKind;
    questionText: string;
    selectedExcerpt: string;
    templateId: string;
    generateImage: boolean;
    answerContext: CodexAnswerContext | null;
  }
) {
  if (pendingCodexRequest || isStartingCodexRequest) {
    return;
  }

  primeCompletionAudio();
  stopCodexPolling();
  const token = codexRequestToken + 1;
  codexRequestToken = token;
  isStartingCodexRequest = true;
  latestCodexAnswer = "";
  latestCodexAnswerContext = options.answerContext;
  setOutputMode("codexAnswer");
  setCodexLoading(true);
  showMessage(t("askingCodex"));

  try {
    const started = await invokeBackend<CodexJobStartSuccess>("start_codex_request", {
      prompt,
      generateImage: options.generateImage
    });
    if (token !== codexRequestToken) {
      isStartingCodexRequest = false;
      setCodexLoading(false);
      void invokeBackend("cancel_codex_request", { jobId: started.jobId });
      return;
    }

    pendingCodexRequest = {
      jobId: started.jobId,
      token,
      prompt,
      questionKind: options.questionKind,
      questionText: options.questionText,
      selectedExcerpt: options.selectedExcerpt,
      templateId: options.templateId,
      answerContext: options.answerContext
    };
    isStartingCodexRequest = false;
    setCodexLoading(true);
    pollCodexRequest(started.jobId, token);
  } catch (error) {
    if (token !== codexRequestToken) {
      isStartingCodexRequest = false;
      setCodexLoading(false);
      return;
    }

    isStartingCodexRequest = false;
    latestCodexAnswer = formatInvokeError(error, t("codexAnswerFailed"));
    pendingCodexRequest = null;
    setCodexLoading(false);
    renderOutput();
    showMessage(latestCodexAnswer, true);
  }
}

function pollCodexRequest(jobId: string, token: number) {
  stopCodexPolling();
  codexPollTimer = window.setTimeout(async () => {
    if (!pendingCodexRequest || pendingCodexRequest.jobId !== jobId || pendingCodexRequest.token !== token) {
      return;
    }

    try {
      const status = await invokeBackend<CodexJobStatus>("get_codex_request", { jobId });
      handleCodexJobStatus(status, token);
    } catch (error) {
      latestCodexAnswer = formatInvokeError(error, t("codexAnswerFailed"));
      pendingCodexRequest = null;
      setCodexLoading(false);
      renderOutput();
      showMessage(latestCodexAnswer, true);
    }
  }, codexPollIntervalMs);
}

function handleCodexJobStatus(status: CodexJobStatus, token: number) {
  if (!pendingCodexRequest || pendingCodexRequest.token !== token) {
    return;
  }

  if (status.status === "running") {
    pollCodexRequest(pendingCodexRequest.jobId, token);
    return;
  }

  const completedRequest = pendingCodexRequest;
  pendingCodexRequest = null;
  stopCodexPolling();
  setCodexLoading(false);

  if (status.status === "completed" && status.answer) {
    latestCodexAnswer = normalizeCodexAnswerMarkdown(status.answer);
    latestCodexQuestionKind = completedRequest.questionKind;
    latestCodexQuestionText = completedRequest.questionText;
    latestCodexSelectedExcerpt = completedRequest.selectedExcerpt;
    latestCodexAnswerContext = completedRequest.answerContext;
    saveCodexHistoryEntry(completedRequest, latestCodexAnswer);
    renderOutput();
    playCompletionSound();
    return;
  }

  const fallback = status.status === "cancelled" ? t("codexCancelled") : t("codexAnswerFailed");
  latestCodexAnswer = status.error || fallback;
  renderOutput();
  showMessage(latestCodexAnswer, status.status !== "cancelled");
}

function stopCodexPolling() {
  if (codexPollTimer !== undefined) {
    window.clearTimeout(codexPollTimer);
    codexPollTimer = undefined;
  }
}

async function cancelActiveCodexRequest() {
  if (!pendingCodexRequest) {
    return;
  }

  const request = pendingCodexRequest;
  pendingCodexRequest = null;
  codexRequestToken += 1;
  stopCodexPolling();

  try {
    await invokeBackend<CodexJobStatus>("cancel_codex_request", { jobId: request.jobId });
  } catch {
    // The local UI should still recover even if the process already exited.
  }

  latestCodexAnswer = t("codexCancelled");
  setCodexLoading(false);
  renderOutput();
  showMessage(t("codexCancelled"));
}

async function copyLatestCodexAnswer() {
  const answerText = getCodexAnswerTextForCopy(latestCodexAnswer);

  if (!answerText) {
    showMessage(t("codexNoAnswer"), true);
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(answerText);
    } else {
      copyTextWithSelectionFallback(answerText);
    }
    showMessage(t("codexAnswerCopied"));
  } catch {
    showMessage(t("copyFailed"), true);
  }
}

function saveLatestCodexAnswerAsMarkdown() {
  if (!latestCodexAnswer.trim()) {
    showMessage(t("codexNoAnswer"), true);
    return;
  }

  const markdown = buildCodexAnswerMarkdown();
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const context = getActiveCodexAnswerContext();
  link.href = url;
  link.download = `${slugifyFileName(context?.title || "youtube-ai-brief")}.md`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildCodexAnswerMarkdown() {
  const context = getActiveCodexAnswerContext();
  const metadata = context
    ? [
        `# ${context.title || context.videoId}`,
        "",
        `- YouTube URL: ${context.url}`,
        `- 動画ID: ${context.videoId}`,
        `- 字幕: ${context.language} (${formatCaptionSource(context.source)})`,
        latestCodexQuestionText ? `- 質問: ${latestCodexQuestionText}` : null,
        ""
      ].filter(Boolean)
    : [`# ${appName}`, ""];

  return [...metadata, latestCodexAnswer.trim(), ""].join("\n");
}

async function rerunLatestCodexRequest() {
  if (!latestTranscript) {
    showError(t("codexPromptRequired"));
    return;
  }

  const template = getSelectedPromptTemplate();
  const prompt =
    latestCodexQuestionKind === "followup" || latestCodexQuestionKind === "selection"
      ? buildFollowUpPrompt(latestCodexQuestionText || template.label, latestCodexSelectedExcerpt)
      : buildAnalysisPrompt(latestTranscript, template, { includeImageInstruction: false });

  await startCodexRequest(prompt, {
    questionKind: "rerun",
    questionText: latestCodexQuestionText || template.label,
    selectedExcerpt: latestCodexSelectedExcerpt,
    templateId: template.id,
    generateImage: appSettings.includeImagePrompt,
    answerContext: getTranscriptAnswerContext(latestTranscript)
  });
}

function openFollowUpModal(kind: CodexQuestionKind, selectedExcerpt: string) {
  if (!latestTranscript && !latestCodexAnswer.trim()) {
    showError(t("codexPromptRequired"));
    return;
  }

  followUpContext = { kind, selectedExcerpt };
  followUpQuestion.value = "";
  document.dispatchEvent(new CustomEvent("ui:follow-up-dialog-request", { detail: true }));
  requestAnimationFrame(() => followUpQuestion.focus());
}

function closeFollowUpModal() {
  document.dispatchEvent(new CustomEvent("ui:follow-up-dialog-request", { detail: false }));
  followUpContext = null;
}

function isDialogOpen(dialog: HTMLElement) {
  return dialog.dataset.state === "open";
}

async function submitFollowUpQuestion() {
  const question = followUpQuestion.value.trim();
  if (!question) {
    showMessage(t("followUpRequired"), true);
    return;
  }

  const context = followUpContext ?? { kind: "followup" as CodexQuestionKind, selectedExcerpt: "" };
  closeFollowUpModal();
  const selectedExcerpt = context.selectedExcerpt;
  const prompt = buildFollowUpPrompt(question, selectedExcerpt);
  await startCodexRequest(prompt, {
    questionKind: context.kind,
    questionText: question,
    selectedExcerpt,
    templateId: getSelectedPromptTemplate().id,
    generateImage: false,
    answerContext: getActiveCodexAnswerContext()
  });
}

function buildFollowUpPrompt(question: string, selectedExcerpt: string) {
  return buildFollowUpPromptText({
    question,
    selectedExcerpt,
    transcript: latestTranscript,
    context: getActiveCodexAnswerContext(),
    sourceAnswer: latestCodexAnswer.trim(),
    fallbackUrl: urlInput.value.trim(),
    formatCaptionSource
  });
}

function renderCodexControls() {
  const hasAnswer = latestCodexAnswer.trim().length > 0;
  const isRunning = Boolean(pendingCodexRequest) || isStartingCodexRequest;
  copyCodexAnswerButton.disabled = !hasAnswer || isRunning;
  saveCodexMarkdownButton.disabled = !hasAnswer || isRunning;
  rerunCodexAnswerButton.disabled = !latestTranscript || latestCodexQuestionKind === "history" || isRunning;
  followUpCodexAnswerButton.disabled = !hasAnswer || isRunning;
  askSelectionCodexButton.disabled = isRunning || (!latestTranscript && !hasAnswer);
  cancelCodexAnswerButton.hidden = !pendingCodexRequest;
}

function getSelectedOutputText() {
  if (outputMode !== "codexAnswer" && !output.hidden) {
    const start = output.selectionStart ?? 0;
    const end = output.selectionEnd ?? 0;
    const selectedText = output.value.slice(Math.min(start, end), Math.max(start, end)).trim();
    latestSelectedOutputText = selectedText || latestSelectedOutputText;
    return selectedText || latestSelectedOutputText;
  }

  const selection = window.getSelection();
  const selectedText = selection?.toString().trim() ?? "";
  if (selectedText && codexAnswerOutput.contains(selection?.anchorNode ?? null)) {
    latestSelectedOutputText = selectedText;
    return selectedText;
  }

  return latestSelectedOutputText;
}

function cacheSelectedOutputText() {
  const selectedText = readSelectedOutputText();
  if (selectedText) {
    latestSelectedOutputText = selectedText;
  }
}

function readSelectedOutputText() {
  if (!output.hidden) {
    const start = output.selectionStart ?? 0;
    const end = output.selectionEnd ?? 0;
    return output.value.slice(Math.min(start, end), Math.max(start, end)).trim();
  }

  const selection = window.getSelection();
  const selectedText = selection?.toString().trim() ?? "";
  if (!selectedText || !codexAnswerOutput.contains(selection?.anchorNode ?? null)) {
    return "";
  }

  return selectedText;
}

function saveCodexHistoryEntry(request: PendingCodexRequest, answerMarkdown: string) {
  const context = request.answerContext ?? (latestTranscript ? getTranscriptAnswerContext(latestTranscript) : null);
  if (!context) {
    return;
  }

  const entry: CodexHistoryEntry = {
    id: `history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    videoId: context.videoId,
    title: context.title || context.videoId,
    url: context.url,
    language: context.language,
    source: context.source,
    templateId: request.templateId,
    questionKind: request.questionKind,
    questionText: request.questionText,
    selectedExcerpt: request.selectedExcerpt,
    answerMarkdown
  };

  const nextHistory = [entry, ...codexHistory.filter((item) => item.id !== entry.id)].slice(0, codexHistoryLimit);

  try {
    localStorage.setItem(codexHistoryStorageKey, JSON.stringify(nextHistory));
    codexHistory = nextHistory;
  } catch {
    // History is best-effort; a full or unavailable localStorage must not discard the completed answer.
  }

  renderCodexHistory();
}

function renderCodexHistory() {
  codexHistoryPanel.hidden = codexHistory.length === 0;
  codexHistoryCount.textContent = codexHistory.length.toLocaleString(appSettings.uiLanguage === "ja" ? "ja-JP" : "en-US");

  if (codexHistory.length === 0) {
    flushSync(() => codexHistoryListRoot.render(<HistoryList entries={[]} emptyLabel={t("codexHistoryEmpty")} />));
    return;
  }

  flushSync(() => {
    codexHistoryListRoot.render(
      <HistoryList
        entries={codexHistory.map((entry) => {
          const date = new Date(entry.createdAt).toLocaleString(appSettings.uiLanguage === "ja" ? "ja-JP" : "en-US");
          const question = entry.questionText ? ` / ${entry.questionText}` : "";
          return {
            id: entry.id,
            metadata: `${date} / ${formatCaptionSource(entry.source)}${question}`,
            title: entry.title
          };
        })}
        emptyLabel={t("codexHistoryEmpty")}
      />
    );
  });
}

function restoreCodexHistoryEntry(historyId: string | undefined) {
  const entry = codexHistory.find((item) => item.id === historyId);
  if (!entry) {
    return;
  }

  latestCodexAnswer = normalizeCodexAnswerMarkdown(entry.answerMarkdown);
  latestCodexQuestionKind = "history";
  latestCodexQuestionText = `${t("historyRestoredPrefix")}: ${entry.questionText}`;
  latestCodexSelectedExcerpt = entry.selectedExcerpt;
  latestCodexAnswerContext = getHistoryAnswerContext(entry);
  setOutputMode("codexAnswer");
  renderOutput();
  showMessage(t("codexHistoryRestored"));
}

function clearCodexHistory() {
  if (codexHistory.length === 0) {
    return;
  }

  codexHistory = [];
  localStorage.removeItem(codexHistoryStorageKey);
  renderCodexHistory();
  showMessage(t("codexHistoryCleared"));
}

function getTranscriptAnswerContext(transcript: TranscriptSuccess): CodexAnswerContext {
  return {
    videoId: transcript.videoId,
    title: transcript.title || transcript.videoId,
    url: transcript.webpageUrl || transcript.sourcePath || urlInput.value.trim(),
    language: transcript.language,
    source: transcript.source
  };
}

function getHistoryAnswerContext(entry: CodexHistoryEntry): CodexAnswerContext {
  return {
    videoId: entry.videoId,
    title: entry.title || entry.videoId,
    url: entry.url,
    language: entry.language,
    source: entry.source
  };
}

function getActiveCodexAnswerContext() {
  return latestCodexAnswerContext ?? (latestTranscript ? getTranscriptAnswerContext(latestTranscript) : null);
}

function loadCodexHistory(): CodexHistoryEntry[] {
  try {
    const rawValue = localStorage.getItem(codexHistoryStorageKey);
    if (!rawValue) {
      return [];
    }

    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map(normalizeCodexHistoryEntry)
      .filter((entry): entry is CodexHistoryEntry => Boolean(entry))
      .slice(0, codexHistoryLimit);
  } catch {
    return [];
  }
}

function normalizeCodexHistoryEntry(value: unknown): CodexHistoryEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<CodexHistoryEntry>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.videoId !== "string" ||
    typeof candidate.title !== "string" ||
    typeof candidate.url !== "string" ||
    typeof candidate.language !== "string" ||
    (candidate.source !== "manual" && candidate.source !== "automatic" && candidate.source !== "kanary") ||
    typeof candidate.templateId !== "string" ||
    typeof candidate.questionKind !== "string" ||
    typeof candidate.questionText !== "string" ||
    typeof candidate.selectedExcerpt !== "string" ||
    typeof candidate.answerMarkdown !== "string"
  ) {
    return null;
  }

  return {
    ...(candidate as CodexHistoryEntry),
    answerMarkdown: normalizeCodexAnswerMarkdown(candidate.answerMarkdown)
  };
}

function getTranscriptTextForDisplay(transcript: TranscriptSuccess) {
  const cache = getTranscriptDerivedCache(transcript);
  if (cache.displayText === undefined) {
    cache.displayText = buildTranscriptTextForDisplay(transcript, appSettings);
  }
  return cache.displayText;
}

function getSearchableTranscriptSegments(transcript: TranscriptSuccess) {
  const cache = getTranscriptDerivedCache(transcript);
  if (cache.searchableSegments === undefined) {
    cache.searchableSegments = getSearchableSegments(transcript, appSettings);
  }
  return cache.searchableSegments;
}

function getSearchableTranscriptIndex(transcript: TranscriptSuccess) {
  const cache = getTranscriptDerivedCache(transcript);
  if (cache.searchableIndex === undefined) {
    cache.searchableIndex = getSearchableTranscriptSegments(transcript).map((segment) => ({
      segment,
      normalizedText: normalizeSearchText(segment.text)
    }));
  }
  return cache.searchableIndex;
}

function getTranscriptDerivedCache(transcript: TranscriptSuccess) {
  if (
    transcriptDerivedCache &&
    transcriptDerivedCache.transcript === transcript &&
    transcriptDerivedCache.formatAutomaticTranscript === appSettings.formatAutomaticTranscript &&
    transcriptDerivedCache.transcriptDisplayMode === appSettings.transcriptDisplayMode
  ) {
    return transcriptDerivedCache;
  }

  transcriptDerivedCache = {
    transcript,
    formatAutomaticTranscript: appSettings.formatAutomaticTranscript,
    transcriptDisplayMode: appSettings.transcriptDisplayMode
  };
  return transcriptDerivedCache;
}

function updateTranscriptCharacterCount() {
  const count = latestTranscript ? getTranscriptTextForDisplay(latestTranscript).length : 0;
  charCount.textContent = count.toLocaleString(appSettings.uiLanguage === "ja" ? "ja-JP" : "en-US");
}

function renderTranscriptDisplayMode() {
  transcriptDisplayModeInputs.forEach((input) => {
    input.checked = input.value === appSettings.transcriptDisplayMode;
  });
  document.dispatchEvent(new CustomEvent("ui:display-mode-request", { detail: appSettings.transcriptDisplayMode }));
}

function isTranscriptDisplayMode(value: unknown): value is TranscriptDisplayMode {
  return value === "plain" || value === "timestamped";
}

function renderTranscriptSearch() {
  const searchIndex = latestTranscript ? getSearchableTranscriptIndex(latestTranscript) : [];
  transcriptSearchPanel.hidden = !latestTranscript || !isTranscriptSearchExpanded;
  transcriptSearchToggle.disabled = !latestTranscript;
  transcriptSearchToggle.setAttribute("aria-expanded", String(Boolean(latestTranscript && isTranscriptSearchExpanded)));
  transcriptSearchInput.disabled = searchIndex.length === 0;

  if (!latestTranscript) {
    transcriptSearchCount.textContent = t("transcriptSearchDisabled");
    flushSync(() => transcriptSearchResultsRoot.render(null));
    return;
  }

  if (searchIndex.length === 0) {
    transcriptSearchCount.textContent = t("transcriptSearchDisabled");
    flushSync(() => transcriptSearchResultsRoot.render(null));
    return;
  }

  const query = normalizeSearchText(transcriptSearchInput.value);

  if (!query) {
    transcriptSearchCount.textContent = t("transcriptSearchReady");
    flushSync(() => transcriptSearchResultsRoot.render(null));
    return;
  }

  const matches = searchIndex
    .filter((entry) => entry.normalizedText.includes(query))
    .map((entry) => entry.segment)
    .slice(0, 50);

  transcriptSearchCount.textContent =
    matches.length === 0 ? t("transcriptSearchEmpty") : t("transcriptSearchCount", matches.length);
  flushSync(() => {
    transcriptSearchResultsRoot.render(
      <SearchResults
        results={matches.map((segment) => ({
          startLabel: segment.startLabel,
          text: truncateSearchResult(segment.text),
          timestampUrl: buildTimestampUrl(segment.startSeconds)
        }))}
        openLabel={t("openTimestamp")}
      />
    );
  });
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
    await invokeBackend("open_youtube_url", { url });
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

async function openExternalUrl(url: string | undefined) {
  if (!url) {
    return;
  }

  try {
    await invokeBackend("open_external_url", { url });
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function buildAnalysisPrompt(
  transcript: TranscriptSuccess,
  template: PromptTemplate,
  options: { includeImageInstruction?: boolean } = {}
) {
  const captionLabel = selectedCaption
    ? formatCaptionLabel({
        language: transcript.language,
        name: selectedCaption.name,
        source: transcript.source,
        isAutoCaption: transcript.source === "automatic"
      })
    : `${transcript.language} (${formatCaptionSource(transcript.source)})`;

  return buildAnalysisPromptText(transcript, template, {
    includeImageInstruction: options.includeImageInstruction ?? appSettings.includeImagePrompt,
    transcriptText: getTranscriptTextForDisplay(transcript),
    captionLabel,
    fallbackUrl: urlInput.value.trim(),
    promptCreatedDate: new Date().toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }),
    transcriptDisplayMode: appSettings.transcriptDisplayMode,
    buildTimestampUrl
  });
}

function buildTimestampUrl(startSeconds: number) {
  return buildTimestampUrlFromBase(getTimestampBaseUrl(), startSeconds);
}

function getTimestampBaseUrl() {
  return latestTranscript?.webpageUrl || latestCaptionList?.webpageUrl || "";
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
  syncCheckbox(includeImagePrompt, appSettings.includeImagePrompt);
  syncCheckbox(formatAutomaticTranscript, appSettings.formatAutomaticTranscript);
  syncCheckbox(settingsCompletionSound, appSettings.completionSoundEnabled);
  renderTranscriptDisplayMode();
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
  syncCheckbox(settingsCompletionSound, appSettings.completionSoundEnabled);
  renderPromptSettingsList(promptTemplateSelect.value || promptSettings.defaultTemplateId);
  renderPromptSettingsEditor(settingsTemplateSelect.value || promptSettings.defaultTemplateId);
  document.dispatchEvent(new CustomEvent("ui:settings-dialog-request", { detail: true }));
  requestAnimationFrame(() => {
    if (activeSettingsSection === "prompts") {
      settingsTemplateTitle.focus();
      settingsTemplateTitle.select();
    } else if (activeSettingsSection === "copy") {
      document.querySelector<HTMLButtonElement>("#include-image-prompt-control")?.focus();
    } else {
      settingsUiLanguage.focus();
    }
  });
}

function closePromptSettings() {
  document.dispatchEvent(new CustomEvent("ui:settings-dialog-request", { detail: false }));
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

function showSettingsSection(section: "prompts" | "copy" | "display") {
  activeSettingsSection = section;
  document.dispatchEvent(new CustomEvent("ui:settings-section-request", { detail: section }));
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
  if (!settingsDebugLogViewer.hidden) {
    settingsOpenDebugLog.textContent = t("refreshDebugLog");
    if (!settingsDebugLogContent.value.trim() || settingsDebugLogContent.value === uiText.ja.debugLogEmpty || settingsDebugLogContent.value === uiText.en.debugLogEmpty) {
      settingsDebugLogContent.value = t("debugLogEmpty");
    }
  }
  updatePromptDescription();
  updateSelectedLanguage();
  updateCaptionSource();
  updateTranscriptCharacterCount();
  viewCount.textContent = formatCount(latestTranscript?.viewCount ?? latestCaptionList?.viewCount);
  renderTranscriptSearch();
  renderCodexHistory();
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

function playCompletionSound() {
  if (!appSettings.completionSoundEnabled) {
    return;
  }

  const audioContext = getCompletionAudioContext();
  if (!audioContext) {
    return;
  }

  const play = () => {
    const now = audioContext.currentTime;
    playCompletionTone(audioContext, now, 660, 0.055);
    playCompletionTone(audioContext, now + 0.075, 880, 0.075);
  };

  if (audioContext.state === "suspended") {
    void audioContext
      .resume()
      .then(play)
      .catch((error) => {
        appendDebugLog("frontend.completion_sound.failed", {
          reason: "resume",
          message: error instanceof Error ? error.message : String(error)
        });
      });
  } else {
    play();
  }
}

function primeCompletionAudio() {
  if (!appSettings.completionSoundEnabled || completionAudioPrimed) {
    return;
  }

  const audioContext = getCompletionAudioContext();
  if (!audioContext) {
    return;
  }

  if (audioContext.state === "suspended") {
    void audioContext
      .resume()
      .then(() => {
        completionAudioPrimed = audioContext.state === "running";
      })
      .catch((error) => {
        appendDebugLog("frontend.completion_sound.prime_failed", {
          reason: "resume",
          message: error instanceof Error ? error.message : String(error)
        });
      });
    return;
  }

  completionAudioPrimed = true;
}

function getCompletionAudioContext() {
  const audioContext = completionAudioContext ?? new AudioContext();
  completionAudioContext = audioContext;
  return audioContext;
}

function playCompletionTone(audioContext: AudioContext, startAt: number, frequency: number, duration: number) {
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.045, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.01);
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
    completionSoundEnabled: true
  };

  try {
    const rawValue = localStorage.getItem(appSettingsStorageKey);
    if (!rawValue) {
      return fallback;
    }

    const parsed = JSON.parse(rawValue) as StoredAppSettings;
    const transcriptDisplayMode = isTranscriptDisplayMode(parsed.transcriptDisplayMode)
      ? parsed.transcriptDisplayMode
      : "plain";
    const settings: AppSettings = {
      uiLanguage: parsed.uiLanguage === "en" ? "en" : "ja",
      includeImagePrompt: parsed.includeImagePrompt !== false,
      formatAutomaticTranscript: parsed.formatAutomaticTranscript !== false,
      transcriptDisplayMode,
      completionSoundEnabled: parsed.completionSoundEnabled !== false
    };

    return settings;
  } catch {
    return fallback;
  }
}

function saveAppSettings() {
  localStorage.setItem(appSettingsStorageKey, JSON.stringify(appSettings));
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
  syncCheckbox(settingsTemplateDefault, template.id === promptSettings.defaultTemplateId);
}

function syncCheckbox(input: HTMLInputElement, checked: boolean) {
  input.checked = checked;
  document.dispatchEvent(new CustomEvent("ui:checkbox-request", { detail: { id: input.id, checked } }));
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

function clearUrlInputOnLaunch() {
  urlInput.value = "";
  lastCaptionCheckUrl = "";
}

function isLikelyYoutubeUrl(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "youtu.be" || host.endsWith(".youtu.be") || host === "youtube.com" || host.endsWith(".youtube.com");
  } catch {
    return false;
  }
}

function isYouTubeUrl(value: string) {
  return isLikelyYoutubeUrl(value);
}

function slugifyFileName(value: string) {
  const slug = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return slug || "youtube-ai-brief";
}
