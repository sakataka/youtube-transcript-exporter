import "./style.css";
import { invokeBackend } from "./backendClient";
import { getCodexAnswerTextForCopy } from "./codexAnswerText";
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
  TranscriptDisplayMode,
  TranscriptSuccess
} from "./types";

type DebugLogReadResult = {
  path: string;
  content: string;
};

const promptSettingsStorageKey = "youtube-transcript-exporter.prompt-settings.v1";
const appSettingsStorageKey = "youtube-transcript-exporter.app-settings.v1";
const codexHistoryStorageKey = "youtube-ai-brief.codex-history.v1";
const codexHistoryLimit = 20;
const codexPollIntervalMs = 900;
const defaultPromptTemplateId = "default";
const appName = "YouTube AI Brief";
const defaultMarkdownThemeCss = [
  ".markdown-output {",
  "  color: #17202a;",
  "  background: #ffffff;",
  "  font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif;",
  "  line-height: 1.58;",
  "}",
  "",
  ".markdown-output h1,",
  ".markdown-output h2,",
  ".markdown-output h3,",
  ".markdown-output h4 {",
  "  color: #111827;",
  "  line-height: 1.25;",
  "  margin: 1.35em 0 0.55em;",
  "}",
  "",
  ".markdown-output h1 {",
  "  color: #0f3d5e;",
  "  font-size: 2rem;",
  "}",
  "",
  ".markdown-output h2 {",
  "  border-bottom: 2px solid #d9e4ee;",
  "  color: #174a87;",
  "  font-size: 1.48rem;",
  "  padding-bottom: 0.32em;",
  "}",
  "",
  ".markdown-output h3 {",
  "  color: #243447;",
  "  font-size: 1.14rem;",
  "}",
  "",
  ".markdown-output strong {",
  "  color: #111827;",
  "  font-weight: 800;",
  "}",
  "",
  ".markdown-output li::marker {",
  "  color: #31506e;",
  "  font-weight: 800;",
  "}",
  "",
  ".markdown-output ul,",
  ".markdown-output ol {",
  "  gap: 0.18em;",
  "  margin-bottom: 0.85em;",
  "}",
  "",
  ".markdown-output blockquote {",
  "  border-left: 4px solid #9fb2c5;",
  "  background: #f6f9fb;",
  "  color: #3c4f61;",
  "  padding: 0.7em 1em;",
  "}",
  "",
  ".markdown-output th {",
  "  background: #f6f9fb;",
  "  color: #111827;",
  "}",
  "",
  ".markdown-output code {",
  "  background: #f5f7f8;",
  "  color: #111827;",
  "}",
  "",
  ".markdown-output pre {",
  "  background: #111827;",
  "}",
  "",
  ".markdown-output a {",
  "  color: #174a87;",
  "  text-decoration: underline;",
  "  text-underline-offset: 2px;",
  "}"
].join("\n");
const legacyPromptTemplateInstructions: Record<string, string> = {
  default: [
    "以下はYouTube動画の字幕です。内容を日本語でわかりやすく整理してください。",
    "",
    "次の形式で回答してください。",
    "1. この動画の概要",
    "2. 重要なポイント",
    "3. 話の流れの詳細",
    "4. 結論・主張"
  ].join("\n"),
  quick: [
    "以下はYouTube動画の字幕です。内容を日本語で簡潔に要約してください。",
    "",
    "次の形式で回答してください。",
    "1. 30秒でわかる要約",
    "2. 重要なポイント5つ",
    "3. 最後に覚えておくべき結論"
  ].join("\n"),
  detailed: [
    "以下はYouTube動画の字幕です。内容を日本語で詳しく解説してください。",
    "",
    "次の形式で回答してください。",
    "1. 全体の概要",
    "2. 話題ごとの詳しい解説",
    "3. 背景知識や前提",
    "4. 専門用語の説明",
    "5. 実務や学習に使える示唆",
    "6. 注意点や不確かな点"
  ].join("\n"),
  argument: [
    "以下はYouTube動画の字幕です。話者の主張、根拠、結論を日本語で整理してください。",
    "",
    "次の形式で回答してください。",
    "1. 話者が一番言いたいこと",
    "2. 主張ごとの根拠",
    "3. 反論や弱い前提がありそうな点",
    "4. 結論",
    "5. 自分ならどう判断すべきか"
  ].join("\n"),
  study: [
    "以下はYouTube動画の字幕です。内容を日本語で解説し、学習にも使える形で整理してください。",
    "",
    "次の形式で回答してください。",
    "1. 内容の概要",
    "2. 重要な表現やキーワード",
    "3. 文脈上わかりにくい表現の説明",
    "4. 日本語での自然な言い換え",
    "5. この動画から学べること"
  ].join("\n")
};
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
    status: "ローカル実行",
    urlLabel: "YouTube URL",
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
    markdownThemeCss: "Markdown表示CSS",
    markdownThemeCssDescription: "AI回答タブのMarkdown表示だけに適用するCSSです。`.markdown-output` から始まるセレクタで見出し、色、フォント、背景を調整できます。",
    resetMarkdownTheme: "初期CSSに戻す",
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
    codexPromptRequired: "字幕候補を選択してから生成AIに質問してください。",
    askingCodex: "",
    codexAnswerReady: "Codexの回答を取得しました。",
    codexAnswerFailed: "Codexから回答を取得できませんでした。",
    promptChanged: "プロンプトを変更しました。コピーするとこの形式でクリップボードに入ります。",
    copyOptionsChanged: "コピー設定を変更しました。表示とコピー内容に反映しました。",
    settingsReset: "プロンプト設定を初期状態に戻しました。",
    settingsSaved: "プロンプト設定を保存しました。",
    languageSaved: "UI言語を保存しました。",
    displaySaved: "表示設定を保存しました。",
    markdownThemeReset: "Markdown表示CSSを初期状態に戻しました。",
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
    markdownThemeCss: "Markdown display CSS",
    markdownThemeCssDescription: "CSS applied only to the AI answer Markdown view. Use selectors starting with `.markdown-output` to adjust headings, colors, fonts, and backgrounds.",
    resetMarkdownTheme: "Reset CSS",
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
    codexPromptRequired: "Choose a caption before asking AI.",
    askingCodex: "",
    codexAnswerReady: "Codex answer is ready.",
    codexAnswerFailed: "Could not get a Codex answer.",
    promptChanged: "Prompt changed. Copy will use this format.",
    copyOptionsChanged: "Copy settings updated. Display and copied text now use them.",
    settingsReset: "Prompt settings were reset to defaults.",
    settingsSaved: "Prompt settings saved.",
    languageSaved: "UI language saved.",
    displaySaved: "Display settings saved.",
    markdownThemeReset: "Markdown display CSS was reset.",
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
    <header class="app-header">
      <div class="brand-lockup">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M21 7.3a3 3 0 0 0-2.1-2.1C17 4.7 12 4.7 12 4.7s-5 0-6.9.5A3 3 0 0 0 3 7.3 31.4 31.4 0 0 0 2.5 12c0 1.6.1 3.2.5 4.7a3 3 0 0 0 2.1 2.1c1.9.5 6.9.5 6.9.5s5 0 6.9-.5a3 3 0 0 0 2.1-2.1c.4-1.5.5-3.1.5-4.7 0-1.6-.1-3.2-.5-4.7Z"></path>
            <path d="m10 9 5 3-5 3V9Z"></path>
          </svg>
        </span>
        <div>
          <h1>${appName}</h1>
          <p data-i18n="heading">YouTube動画をAI向けに整理</p>
        </div>
      </div>
      <form class="input-panel" id="caption-form">
        <div class="command-row">
          <input
            id="youtube-url"
            name="url"
            type="url"
            aria-label="YouTube URL"
            placeholder="https://www.youtube.com/watch?v=..."
            autocomplete="off"
            autofocus
            required
          />
          <button id="transcript-button" type="button" disabled data-i18n="fetchTranscript">選択した字幕を取得</button>
          <button id="ask-codex-button" type="button" disabled data-i18n="askCodex">Codexに質問</button>
          <button class="secondary-button compact-button icon-label-button" id="transcript-search-toggle" type="button" disabled aria-expanded="false" aria-controls="transcript-search-panel">
            <svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="6"></circle>
              <path d="m16 16 4 4"></path>
            </svg>
            <span data-i18n="transcriptSearchToggle">検索</span>
          </button>
        </div>
        <p class="status-message" id="message" hidden></p>
      </form>
      <div class="app-header-actions">
        <button class="secondary-button compact-button icon-label-button" id="reload-app-button" type="button">
          <svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-2.6-6.4"></path>
            <path d="M21 3v6h-6"></path>
          </svg>
          <span data-i18n="reloadButton">更新</span>
        </button>
        <button class="secondary-button compact-button icon-label-button" id="prompt-settings-button" type="button">
          <svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19 12a7 7 0 0 0-.1-1.1l2-1.5-2-3.5-2.4 1a7 7 0 0 0-1.9-1.1L14.2 3h-4.4l-.4 2.8A7 7 0 0 0 7.5 7L5.1 6l-2 3.5 2 1.5a7 7 0 0 0 0 2.2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 1.9 1.1l.4 2.8h4.4l.4-2.8a7 7 0 0 0 1.9-1.1l2.4 1 2-3.5-2-1.5c.1-.3.1-.7.1-1.1Z"></path>
          </svg>
          <span data-i18n="settingsButton">設定</span>
        </button>
      </div>
    </header>

    <section class="result-layout" aria-live="polite">
      <div class="meta-panel">
        <div class="meta-summary-item">
          <span class="label" data-i18n="selectedLanguage">選択言語</span>
          <strong id="language">-</strong>
        </div>
        <div class="meta-summary-item">
          <span class="label" data-i18n="characterCount">文字数</span>
          <strong id="char-count">0</strong>
        </div>
        <div class="meta-summary-item">
          <span class="label" data-i18n="videoDuration">動画時間</span>
          <strong id="video-duration">-</strong>
        </div>
        <div class="meta-summary-item">
          <span class="label" data-i18n="canonicalUrl">動画URL</span>
          <strong id="canonical-url">-</strong>
        </div>
        <div class="meta-summary-item">
          <span class="label" data-i18n="viewCount">再生数</span>
          <strong id="view-count">-</strong>
        </div>
        <div class="meta-summary-item">
          <span class="label" data-i18n="captionSourceLabel">字幕種別</span>
          <strong id="caption-source">-</strong>
        </div>
        <div class="meta-prompt-settings">
          <label class="label" for="prompt-template" data-i18n="copyPrompt">生成AIプロンプト</label>
          <select id="prompt-template"></select>
          <p class="prompt-description" id="prompt-description"></p>
        </div>
      </div>

      <div class="output-panel">
        <h2 id="video-title" hidden>AI向け入力</h2>
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
          <button class="output-tab" id="copy-prompt-view-tab" type="button" data-output-mode="copyPrompt" role="tab" aria-selected="false" aria-controls="transcript-output" data-i18n="copyPromptView">生成AIプロンプト</button>
          <button class="output-tab" id="codex-answer-view-tab" type="button" data-output-mode="codexAnswer" role="tab" aria-selected="false" aria-controls="transcript-output" data-i18n="codexAnswerView">AI回答</button>
          <span class="output-tab-divider" aria-hidden="true"></span>
          <div class="codex-toolbar" id="codex-toolbar" hidden>
            <button class="secondary-button compact-button" id="copy-codex-answer" type="button" data-i18n="copyAnswer">回答をコピー</button>
            <button class="secondary-button compact-button" id="save-codex-markdown" type="button" data-i18n="saveMarkdown" hidden>Markdown保存</button>
            <button class="secondary-button compact-button" id="rerun-codex-answer" type="button" data-i18n="rerunAnswer">再実行</button>
            <button class="secondary-button compact-button" id="follow-up-codex-answer" type="button" data-i18n="followUpAnswer">追加質問</button>
            <button class="secondary-button compact-button" id="ask-selection-codex" type="button" data-i18n="askSelection">選択範囲で質問</button>
            <button class="secondary-button compact-button danger-button" id="cancel-codex-answer" type="button" data-i18n="cancelCodex" hidden>キャンセル</button>
          </div>
        </div>
        <textarea id="transcript-output" spellcheck="false" readonly></textarea>
        <div id="codex-answer-output" class="markdown-output" hidden></div>
        <section class="history-panel" id="codex-history-panel" hidden>
          <div class="history-header">
            <h3 data-i18n="codexHistoryTitle">AI回答履歴</h3>
            <div class="history-header-actions">
              <span id="codex-history-count">0</span>
              <button class="secondary-button compact-button" id="clear-codex-history" type="button" data-i18n="clearCodexHistory">履歴をクリア</button>
            </div>
          </div>
          <div class="history-list" id="codex-history-list"></div>
        </section>
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
          <button class="settings-tab" id="settings-copy-tab" type="button" role="tab" aria-selected="false" aria-controls="settings-copy-section" data-settings-section="copy" data-i18n="copyTab">コピー</button>
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

          <section class="settings-section settings-section-single" id="settings-copy-section" role="tabpanel" aria-labelledby="settings-copy-tab" hidden>
            <div class="settings-editor">
              <div>
                <h3 class="settings-section-title" data-i18n="copySettingsTitle">コピー設定</h3>
                <p class="hint" data-i18n="copySettingsDescription">字幕取得後にクリップボードへ入れる内容と、AIへ渡す追加指示をまとめて管理します。</p>
              </div>

              <div class="copy-option-row">
                <label class="option-toggle">
                  <input id="include-image-prompt" type="checkbox" />
                  <span data-i18n="includeImagePrompt">画像生成指示を含む</span>
                </label>
                <label class="option-toggle">
                  <input id="format-automatic-transcript" type="checkbox" />
                  <span data-i18n="formatAutomaticTranscript">自動字幕を整形</span>
                </label>
              </div>

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
          </section>

          <section class="settings-section settings-section-single" id="settings-display-section" role="tabpanel" aria-labelledby="settings-display-tab" hidden>
            <div class="settings-editor">
              <label class="label" for="settings-ui-language" data-i18n="uiLanguage">UI言語</label>
              <select id="settings-ui-language">
                <option value="ja" data-i18n="japanese">日本語</option>
                <option value="en" data-i18n="english">English</option>
              </select>
              <p class="hint" data-i18n="uiLanguageDescription">アプリ画面の表示言語を切り替えます。コピーされるプロンプト本文は、各テンプレートの内容をそのまま使います。</p>

              <label class="default-template-toggle">
                <input id="settings-completion-sound" type="checkbox" />
                <span data-i18n="completionSound">AI回答の完了時に音を鳴らす</span>
              </label>

              <div class="markdown-theme-settings" hidden>
                <label class="label" for="settings-markdown-theme-css" data-i18n="markdownThemeCss">Markdown表示CSS</label>
                <textarea id="settings-markdown-theme-css" class="settings-markdown-theme-css" spellcheck="false"></textarea>
                <p class="hint" data-i18n="markdownThemeCssDescription">AI回答タブのMarkdown表示だけに適用するCSSです。\`.markdown-output\` から始まるセレクタで見出し、色、フォント、背景を調整できます。</p>
              </div>

              <div class="debug-log-settings">
                <span class="label" data-i18n="debugLog">デバッグログ</span>
                <p class="hint" data-i18n="debugLogDescription">取得時間、生成AIへの依頼内容、応答タイミング、表示処理のタイミングをローカルログへ記録します。通常は見る必要はありません。</p>
                <button class="secondary-button" id="settings-open-debug-log" type="button" data-i18n="showDebugLog">ログを表示</button>
                <div class="debug-log-viewer" id="settings-debug-log-viewer" hidden>
                  <span class="debug-log-path-label" data-i18n="debugLogPath">保存先</span>
                  <code id="settings-debug-log-path"></code>
                  <textarea id="settings-debug-log-content" class="debug-log-content" spellcheck="false" readonly></textarea>
                </div>
              </div>

              <div class="settings-footer">
                <button class="secondary-button" id="settings-reset-markdown-theme" type="button" data-i18n="resetMarkdownTheme" hidden>初期CSSに戻す</button>
                <button id="settings-save-display" type="button" data-i18n="save">保存</button>
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
    <div class="settings-backdrop" id="follow-up-modal" hidden>
      <section class="follow-up-panel" role="dialog" aria-modal="true" aria-labelledby="follow-up-title">
        <div class="settings-header">
          <div>
            <p class="eyebrow">Codex</p>
            <h2 id="follow-up-title" data-i18n="followUpTitle">追加質問</h2>
          </div>
          <button class="secondary-button compact-button" id="follow-up-close" type="button" data-i18n="followUpCancel">閉じる</button>
        </div>
        <div class="follow-up-body">
          <label class="label" for="follow-up-question" data-i18n="followUpLabel">質問内容</label>
          <textarea id="follow-up-question" class="follow-up-question" spellcheck="true" data-i18n-placeholder="followUpPlaceholder"></textarea>
          <div class="settings-footer">
            <button id="follow-up-submit" type="button" data-i18n="followUpSubmit">質問する</button>
          </div>
        </div>
      </section>
    </div>
  </section>
`;

const form = document.querySelector<HTMLFormElement>("#caption-form")!;
const urlInput = document.querySelector<HTMLInputElement>("#youtube-url")!;
const transcriptButton = document.querySelector<HTMLButtonElement>("#transcript-button")!;
const askCodexButton = document.querySelector<HTMLButtonElement>("#ask-codex-button")!;
const promptTemplateSelect = document.querySelector<HTMLSelectElement>("#prompt-template")!;
const promptDescription = document.querySelector<HTMLParagraphElement>("#prompt-description")!;
const reloadAppButton = document.querySelector<HTMLButtonElement>("#reload-app-button")!;
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
const settingsCopySection = document.querySelector<HTMLElement>("#settings-copy-section")!;
const settingsDisplaySection = document.querySelector<HTMLElement>("#settings-display-section")!;
const settingsUiLanguage = document.querySelector<HTMLSelectElement>("#settings-ui-language")!;
const settingsCompletionSound = document.querySelector<HTMLInputElement>("#settings-completion-sound")!;
const settingsMarkdownThemeCss = document.querySelector<HTMLTextAreaElement>("#settings-markdown-theme-css")!;
const settingsResetMarkdownTheme = document.querySelector<HTMLButtonElement>("#settings-reset-markdown-theme")!;
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
const message = document.querySelector<HTMLParagraphElement>("#message")!;
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
const followUpModal = document.querySelector<HTMLDivElement>("#follow-up-modal")!;
const followUpQuestion = document.querySelector<HTMLTextAreaElement>("#follow-up-question")!;
const followUpClose = document.querySelector<HTMLButtonElement>("#follow-up-close")!;
const followUpSubmit = document.querySelector<HTMLButtonElement>("#follow-up-submit")!;
const markdownThemeStyle = document.createElement("style");
markdownThemeStyle.id = "markdown-theme-style";
document.head.append(markdownThemeStyle);

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

clearUrlInputOnLaunch();
renderPromptTemplates();
renderAppOptions();
applyMarkdownTheme();
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
  transcriptButton.disabled = !selectedCaption;
  clearTranscript();
  askCodexButton.disabled = !selectedCaption;
  updateSelectedLanguage();
  updateCaptionSource();
  showMessage(t("captionReady"));
});

transcriptButton.addEventListener("click", async () => {
  await fetchSelectedTranscript({ copyAfterFetch: true });
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
  const prompt = buildAnalysisPrompt(transcript, getSelectedPromptTemplate(), {
    includeImageInstruction: false
  });
  appendDebugLog("frontend.codex_prompt.built", {
    templateId: getSelectedPromptTemplate().id,
    generateImage: appSettings.includeImagePrompt,
    promptChars: prompt.length,
    promptPreview: truncateForLog(prompt, 8000)
  });
  await startCodexRequest(prompt, {
    questionKind: "initial",
    questionText: getSelectedPromptTemplate().label,
    selectedExcerpt: "",
    templateId: getSelectedPromptTemplate().id,
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

outputTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const mode = tab.dataset.outputMode;
    if (mode === "transcript" || mode === "copyPrompt" || mode === "codexAnswer") {
      setOutputMode(mode);
    }
  });
});

settingsTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const section = tab.dataset.settingsSection;
    if (section === "prompts" || section === "copy" || section === "display") {
      showSettingsSection(section);
    }
  });
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

promptSettingsModal.addEventListener("click", (event) => {
  if (event.target === promptSettingsModal) {
    closePromptSettings();
  }
});

followUpClose.addEventListener("click", () => {
  closeFollowUpModal();
});

followUpModal.addEventListener("click", (event) => {
  if (event.target === followUpModal) {
    closeFollowUpModal();
  }
});

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
  if (!followUpModal.hidden && event.key === "Escape") {
    event.preventDefault();
    closeFollowUpModal();
    return;
  }

  if (!followUpModal.hidden && (event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    void submitFollowUpQuestion();
    return;
  }

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
  appSettings.markdownThemeCss = settingsMarkdownThemeCss.value;
  saveAppSettings();
  applyMarkdownTheme();
  applyUiLanguage();
  renderPromptSettingsList(settingsTemplateSelect.value || promptSettings.defaultTemplateId);
  primeCompletionAudio();
  showMessage(t("displaySaved"));
});

settingsResetMarkdownTheme.addEventListener("click", () => {
  settingsMarkdownThemeCss.value = defaultMarkdownThemeCss;
  appSettings.markdownThemeCss = defaultMarkdownThemeCss;
  saveAppSettings();
  applyMarkdownTheme();
  showMessage(t("markdownThemeReset"));
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
  captionPanel.hidden = true;
}

function setCaptionLoading(isLoading: boolean) {
  urlInput.toggleAttribute("aria-busy", isLoading);
}

function setTranscriptLoading(isLoading: boolean) {
  transcriptButton.disabled = isLoading || !selectedCaption;
  transcriptButton.textContent = isLoading ? t("fetchTranscriptLoading") : t("fetchTranscript");
  transcriptButton.classList.toggle("is-loading", isLoading);
}

function setCodexLoading(isLoading: boolean) {
  askCodexButton.disabled = isLoading || (!latestTranscript && !selectedCaption);
  askCodexButton.textContent = isLoading ? t("askCodexLoading") : t("askCodex");
  askCodexButton.classList.toggle("is-loading", isLoading);
  cancelCodexAnswerButton.hidden = !isLoading;
  renderCodexControls();
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
    videoDuration.textContent = payload.duration || "-";
    renderCanonicalUrl(payload.webpageUrl);
    viewCount.textContent = formatCount(payload.viewCount);
    renderCaptionOptions(payload.captions);
    transcriptButton.disabled = !selectedCaption;
    askCodexButton.disabled = !selectedCaption;
    showMessage(selectedCaption ? t("chooseCaption") : t("noCaptions"));
    updateSelectedLanguage();
    updateCaptionSource();
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
  captionList.innerHTML = "";
  captionCount.textContent = t("captionCount", 0);
  captionPanel.hidden = true;
  title.textContent = t("transcriptTitle");
  language.textContent = "-";
  videoDuration.textContent = "-";
  renderCanonicalUrl(undefined);
  viewCount.textContent = "-";
  updateCaptionSource();
  transcriptButton.disabled = true;
  transcriptButton.textContent = t("fetchTranscript");
  transcriptButton.classList.remove("is-loading");
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
  transcriptButton.textContent = t("fetchTranscript");
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

function setOutputMode(mode: CodexOutputMode) {
  outputMode = mode;
  outputTabs.forEach((tab) => {
    const isActive = tab.dataset.outputMode === mode;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
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
  return renderMarkdownOutput(markdown, { buildTimestampUrl });
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
    latestCodexAnswer = status.answer;
    latestCodexQuestionKind = completedRequest.questionKind;
    latestCodexQuestionText = completedRequest.questionText;
    latestCodexSelectedExcerpt = completedRequest.selectedExcerpt;
    latestCodexAnswerContext = completedRequest.answerContext;
    saveCodexHistoryEntry(completedRequest, status.answer);
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
  followUpModal.hidden = false;
  requestAnimationFrame(() => followUpQuestion.focus());
}

function closeFollowUpModal() {
  followUpModal.hidden = true;
  followUpContext = null;
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
    codexHistoryList.innerHTML = `<p class="history-empty">${escapeHtml(t("codexHistoryEmpty"))}</p>`;
    return;
  }

  codexHistoryList.innerHTML = codexHistory
    .map((entry) => {
      const date = new Date(entry.createdAt).toLocaleString(appSettings.uiLanguage === "ja" ? "ja-JP" : "en-US");
      const question = entry.questionText ? ` / ${entry.questionText}` : "";
      return `
        <button class="history-item" type="button" data-history-id="${escapeHtml(entry.id)}">
          <strong>${escapeHtml(entry.title)}</strong>
          <span>${escapeHtml(date)} / ${escapeHtml(formatCaptionSource(entry.source))}${escapeHtml(question)}</span>
        </button>
      `;
    })
    .join("");
}

function restoreCodexHistoryEntry(historyId: string | undefined) {
  const entry = codexHistory.find((item) => item.id === historyId);
  if (!entry) {
    return;
  }

  latestCodexAnswer = entry.answerMarkdown;
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
    url: transcript.webpageUrl || urlInput.value.trim(),
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
    (candidate.source !== "manual" && candidate.source !== "automatic") ||
    typeof candidate.templateId !== "string" ||
    typeof candidate.questionKind !== "string" ||
    typeof candidate.questionText !== "string" ||
    typeof candidate.selectedExcerpt !== "string" ||
    typeof candidate.answerMarkdown !== "string"
  ) {
    return null;
  }

  return candidate as CodexHistoryEntry;
}

function getTranscriptTextForDisplay(transcript: TranscriptSuccess) {
  return buildTranscriptTextForDisplay(transcript, appSettings);
}

function getSearchableTranscriptSegments(transcript: TranscriptSuccess) {
  return getSearchableSegments(transcript, appSettings);
}

function updateTranscriptCharacterCount() {
  const count = latestTranscript ? getTranscriptTextForDisplay(latestTranscript).length : 0;
  charCount.textContent = count.toLocaleString(appSettings.uiLanguage === "ja" ? "ja-JP" : "en-US");
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
  const segments = latestTranscript ? getSearchableTranscriptSegments(latestTranscript) : [];
  transcriptSearchPanel.hidden = !latestTranscript || !isTranscriptSearchExpanded;
  transcriptSearchToggle.disabled = !latestTranscript;
  transcriptSearchToggle.setAttribute("aria-expanded", String(Boolean(latestTranscript && isTranscriptSearchExpanded)));
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
  const rawUrl = latestTranscript?.webpageUrl || latestCaptionList?.webpageUrl || urlInput.value.trim();
  return buildTimestampUrlFromBase(rawUrl, startSeconds);
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
  settingsCompletionSound.checked = appSettings.completionSoundEnabled;
  settingsMarkdownThemeCss.value = appSettings.markdownThemeCss;
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
  settingsCompletionSound.checked = appSettings.completionSoundEnabled;
  settingsMarkdownThemeCss.value = appSettings.markdownThemeCss;
  renderPromptSettingsList(promptTemplateSelect.value || promptSettings.defaultTemplateId);
  renderPromptSettingsEditor(settingsTemplateSelect.value || promptSettings.defaultTemplateId);
  promptSettingsModal.hidden = false;
  if (activeSettingsSection === "prompts") {
    settingsTemplateTitle.focus();
    settingsTemplateTitle.select();
  } else if (activeSettingsSection === "copy") {
    includeImagePrompt.focus();
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

function showSettingsSection(section: "prompts" | "copy" | "display") {
  activeSettingsSection = section;
  settingsPromptsSection.hidden = section !== "prompts";
  settingsCopySection.hidden = section !== "copy";
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

function applyMarkdownTheme() {
  markdownThemeStyle.textContent = appSettings.markdownThemeCss || defaultMarkdownThemeCss;
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
  const AudioContextConstructor =
    window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) {
    return null;
  }

  const audioContext = completionAudioContext ?? new AudioContextConstructor();
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
    markdownThemeCss: defaultMarkdownThemeCss,
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
      markdownThemeCss:
        typeof parsed.markdownThemeCss === "string" && parsed.markdownThemeCss.trim()
          ? parsed.markdownThemeCss
          : defaultMarkdownThemeCss,
      completionSoundEnabled: parsed.completionSoundEnabled !== false
    };

    if ("recentUrls" in parsed) {
      localStorage.setItem(appSettingsStorageKey, JSON.stringify(settings));
    }

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
          .map(migrateBuiltInPromptTemplate)
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

function migrateBuiltInPromptTemplate(template: PromptTemplate): PromptTemplate {
  const currentTemplate = defaultPromptTemplates.find((item) => item.id === template.id);
  const legacyInstruction = legacyPromptTemplateInstructions[template.id];

  if (!currentTemplate || template.instruction !== legacyInstruction) {
    return template;
  }

  return {
    ...template,
    instruction: currentTemplate.instruction
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
