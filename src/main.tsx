import "./style.css";
import "./theme";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { RotateCwIcon, SearchIcon, SettingsIcon } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { invokeBackend } from "./backendClient";
import { getCodexAnswerTextForCopy, normalizeCodexAnswerMarkdown } from "./codexAnswerText";
import { renderMarkdown as renderMarkdownOutput } from "./markdownRenderer";
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
const legacyDefaultPromptTemplate: PromptTemplate = {
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
};
const defaultPromptTemplates: PromptTemplate[] = [
  {
    id: "default",
    label: "概要 + 詳細",
    description: "動画の全体像と詳しい流れを約10分で理解",
    instruction: [
      "以下はYouTube動画の字幕です。内容を日本語でわかりやすく、約10分で読める分量に整理してください。",
      "",
      "次の2項目だけで回答してください。ほかの独立した項目は追加せず、必要な内容は概要または詳細に含めてください。",
      "1. この動画の概要",
      "2. 話の流れの詳細"
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

const uiText = {
  ja: {
    heading: "YouTube動画をAI向けに整理",
    mediaPathLabel: "ローカル動画ファイル",
    mediaPathPlaceholder: "/Users/you/Movies/video.mp4",
    transcribeMedia: "動画を文字起こし",
    transcribeMediaLoading: "文字起こし中",
    selectedLanguage: "選択言語",
    characterCount: "文字数",
    videoDuration: "動画時間",
    canonicalUrl: "動画URL",
    canonicalUrlLink: "リンク",
    viewCount: "再生数",
    captionSourceLabel: "字幕種別",
    copyPrompt: "生成AIプロンプト",
    includeImagePrompt: "画像生成指示を含む",
    formatAutomaticTranscript: "自動字幕を整形",
    transcriptDisplayModeLabel: "字幕表示のタイムスタンプ",
    plainTranscript: "なし",
    timestampedTranscript: "あり",
    transcriptView: "字幕本文",
    copyPromptView: "生成AIプロンプト",
    codexAnswerView: "AI回答",
    transcriptSearchTitle: "字幕内検索",
    transcriptSearchToggle: "字幕内検索",
    transcriptSearchLabel: "検索語",
    transcriptSearchPlaceholder: "字幕を検索",
    transcriptSearchDisabled: "字幕取得後に検索できます。",
    transcriptSearchReady: "検索語を入力してください。",
    transcriptSearchEmpty: "一致する字幕がありません。",
    transcriptSearchCount: (count: number) => `${count.toLocaleString("ja-JP")}件一致`,
    openTimestamp: "YouTubeで開く",
    reloadButton: "更新",
    settingsButton: "設定",
    fetchTranscriptLoading: "取得中",
    askCodex: "AIに聞く",
    askCodexLoading: "取得・質問中",
    codexHistoryTitle: "AI回答履歴",
    codexHistoryEmpty: "AI回答の履歴はまだありません。",
    codexHistoryRestored: "履歴からAI回答を復元しました。",
    clearCodexHistory: "履歴をクリア",
    codexHistoryCleared: "AI回答履歴を削除しました。",
    copyAnswer: "回答をコピー",
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
    copyFailed: "クリップボードにコピーできませんでした。本文を選択して手動でコピーしてください。",
    codexPromptRequired: "字幕を取得してから生成AIに質問してください。",
    askingCodex: "",
    codexAnswerFailed: "Codexから回答を取得できませんでした。",
    promptChanged: "プロンプトを変更しました。コピーするとこの形式でクリップボードに入ります。",
    copyOptionsChanged: "コピー設定を変更しました。表示とコピー内容に反映しました。",
    settingsReset: "プロンプト設定を初期状態に戻しました。",
    settingsSaved: "プロンプト設定を保存しました。",
    displaySaved: "表示設定を保存しました。",
    newPrompt: "新しいプロンプト",
    newPromptDescription: "説明を入力してください",
    newPromptInstruction: "以下はYouTube動画の字幕です。内容を日本語で整理してください。",
    untitledPrompt: "無題のプロンプト",
    defaultMark: " / デフォルト",
    manualCaption: "字幕",
    automaticCaption: "自動字幕",
    kanaryTranscript: "Kanary文字起こし",
    captionCount: (count: number) => `${count.toLocaleString("ja-JP")}件`
  },
  en: {
    heading: "Prepare YouTube Videos for AI",
    mediaPathLabel: "Local video file",
    mediaPathPlaceholder: "/Users/you/Movies/video.mp4",
    transcribeMedia: "Transcribe video",
    transcribeMediaLoading: "Transcribing",
    selectedLanguage: "Selected language",
    characterCount: "Characters",
    videoDuration: "Duration",
    canonicalUrl: "Video URL",
    canonicalUrlLink: "Link",
    viewCount: "Views",
    captionSourceLabel: "Caption type",
    copyPrompt: "Generative AI prompt",
    includeImagePrompt: "Include image prompt",
    formatAutomaticTranscript: "Clean auto captions",
    transcriptDisplayModeLabel: "Transcript timestamps",
    plainTranscript: "Off",
    timestampedTranscript: "On",
    transcriptView: "Transcript",
    copyPromptView: "Generative AI prompt",
    codexAnswerView: "AI answer",
    transcriptSearchTitle: "Search transcript",
    transcriptSearchToggle: "Search transcript",
    transcriptSearchLabel: "Search term",
    transcriptSearchPlaceholder: "Search transcript",
    transcriptSearchDisabled: "Search is available after fetching a transcript.",
    transcriptSearchReady: "Enter a search term.",
    transcriptSearchEmpty: "No matching captions found.",
    transcriptSearchCount: (count: number) => `${count.toLocaleString("en-US")} match${count === 1 ? "" : "es"}`,
    openTimestamp: "Open in YouTube",
    reloadButton: "Reload",
    settingsButton: "Settings",
    fetchTranscriptLoading: "Getting",
    askCodex: "Ask AI",
    askCodexLoading: "Getting and asking",
    codexHistoryTitle: "AI answer history",
    codexHistoryEmpty: "No AI answer history yet.",
    codexHistoryRestored: "Restored an AI answer from history.",
    clearCodexHistory: "Clear history",
    codexHistoryCleared: "Cleared AI answer history.",
    copyAnswer: "Copy answer",
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
    copyFailed: "Could not copy to the clipboard. Select the text and copy it manually.",
    codexPromptRequired: "Fetch a transcript before asking AI.",
    askingCodex: "",
    codexAnswerFailed: "Could not get a Codex answer.",
    promptChanged: "Prompt changed. Copy will use this format.",
    copyOptionsChanged: "Copy settings updated. Display and copied text now use them.",
    settingsReset: "Prompt settings were reset to defaults.",
    settingsSaved: "Prompt settings saved.",
    displaySaved: "Display settings saved.",
    newPrompt: "New prompt",
    newPromptDescription: "Enter a description",
    newPromptInstruction: "The following is a YouTube video transcript. Please organize the content clearly.",
    untitledPrompt: "Untitled prompt",
    defaultMark: " / Default",
    manualCaption: "Caption",
    automaticCaption: "Auto caption",
    kanaryTranscript: "Kanary transcription",
    captionCount: (count: number) => `${count.toLocaleString("en-US")} item${count === 1 ? "" : "s"}`
  }
};

const secondaryButtonProps = { variant: "outline" as const, size: "lg" as const };

type StatusMessage = { text: string; error: boolean };
type TemplateDraft = PromptTemplate & { isDefault: boolean };
type FollowUpContext = { kind: CodexQuestionKind; selectedExcerpt: string };

function App() {
  const [url, setUrl] = useState("");
  const [mediaPath, setMediaPath] = useState("");
  const [promptSettings, setPromptSettings] = useState(loadPromptSettings);
  const [appSettings, setAppSettings] = useState(loadAppSettings);
  const [selectedTemplateId, setSelectedTemplateId] = useState(promptSettings.defaultTemplateId);
  const [captionList, setCaptionList] = useState<CaptionListSuccess | null>(null);
  const [selectedCaption, setSelectedCaption] = useState<CaptionOption | null>(null);
  const [transcript, setTranscript] = useState<TranscriptSuccess | null>(null);
  const [answer, setAnswer] = useState("");
  const [answerKind, setAnswerKind] = useState<CodexQuestionKind>("initial");
  const [answerQuestion, setAnswerQuestion] = useState("");
  const [answerExcerpt, setAnswerExcerpt] = useState("");
  const [answerContext, setAnswerContext] = useState<CodexAnswerContext | null>(null);
  const [outputMode, setOutputMode] = useState<CodexOutputMode>("transcript");
  const [history, setHistory] = useState(loadCodexHistory);
  const [status, setStatus] = useState<StatusMessage>({ text: "", error: false });
  const [captionLoading, setCaptionLoading] = useState(false);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [codexLoading, setCodexLoading] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<"prompts" | "copy" | "display">("prompts");
  const [settingsTemplateId, setSettingsTemplateId] = useState(promptSettings.defaultTemplateId);
  const [templateDraft, setTemplateDraft] = useState<TemplateDraft>(() => toTemplateDraft(promptSettings, promptSettings.defaultTemplateId));
  const [uiLanguageDraft, setUiLanguageDraft] = useState(appSettings.uiLanguage);
  const [completionSoundDraft, setCompletionSoundDraft] = useState(appSettings.completionSoundEnabled);
  const [debugLog, setDebugLog] = useState<DebugLogReadResult | null>(null);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpQuestion, setFollowUpQuestion] = useState("");
  const [followUpContext, setFollowUpContext] = useState<FollowUpContext | null>(null);

  const urlInputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLTextAreaElement>(null);
  const answerOutputRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsTitleRef = useRef<HTMLInputElement>(null);
  const followUpRef = useRef<HTMLTextAreaElement>(null);
  const captionToken = useRef(0);
  const transcriptToken = useRef(0);
  const mediaToken = useRef(0);
  const codexToken = useRef(0);
  const pendingCodex = useRef<PendingCodexRequest | null>(null);
  const codexBusy = useRef(false);
  const autoCheckTimer = useRef<number | undefined>(undefined);
  const lastCaptionCheckUrl = useRef("");
  const selectedOutputText = useRef("");
  const audioContext = useRef<AudioContext | null>(null);
  const audioPrimed = useRef(false);
  const settingsRef = useRef(appSettings);
  settingsRef.current = appSettings;

  const t = (key: keyof (typeof uiText)["ja"], value?: string | number) => {
    const entry = uiText[appSettings.uiLanguage][key];
    return typeof entry === "function" ? entry(value as never) : entry;
  };

  const selectedTemplate =
    promptSettings.templates.find((template) => template.id === selectedTemplateId) ??
    promptSettings.templates.find((template) => template.id === promptSettings.defaultTemplateId) ??
    promptSettings.templates[0];
  const metadata = transcript ?? captionList;
  const transcriptText = useMemo(
    () => (transcript ? buildTranscriptTextForDisplay(transcript, appSettings) : ""),
    [transcript, appSettings.formatAutomaticTranscript, appSettings.transcriptDisplayMode]
  );
  const searchableSegments = useMemo(
    () => (transcript ? getSearchableSegments(transcript, appSettings) : []),
    [transcript, appSettings.formatAutomaticTranscript, appSettings.transcriptDisplayMode]
  );
  const timestampBaseUrl = transcript?.webpageUrl || captionList?.webpageUrl || "";
  const searchMatches = useMemo(() => {
    const query = normalizeSearchText(searchQuery);
    if (!query) return [];
    return searchableSegments
      .filter((segment) => normalizeSearchText(segment.text).includes(query))
      .slice(0, 50);
  }, [searchQuery, searchableSegments]);
  const promptOutput = useMemo(
    () => (transcript && selectedTemplate ? buildAnalysisPrompt(transcript, selectedTemplate) : ""),
    [transcript, selectedTemplate, selectedCaption, appSettings, url, timestampBaseUrl]
  );
  const outputValue = outputMode === "copyPrompt" ? promptOutput : transcriptText;
  const answerHtml = useMemo(
    () => renderMarkdownOutput(answer, { buildTimestampUrl }),
    [answer, timestampBaseUrl]
  );
  const codexRunning = codexLoading;
  const hasAnswer = answer.trim().length > 0;

  useEffect(() => {
    document.documentElement.lang = appSettings.uiLanguage;
    document.title = appName;
  }, [appSettings.uiLanguage]);

  useEffect(() => {
    requestAnimationFrame(() => {
      urlInputRef.current?.focus();
      urlInputRef.current?.select();
    });
  }, []);

  useLayoutEffect(() => {
    const element = outputRef.current;
    if (!element || outputMode === "codexAnswer") return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [outputMode, outputValue]);

  useEffect(() => {
    appendDebugLog("frontend.output.rendered", {
      mode: outputMode,
      transcriptChars: transcript?.text.length ?? 0,
      answerChars: answer.length
    });
  }, [outputMode, transcript?.text.length, answer.length]);

  useEffect(() => {
    const prime = () => primeCompletionAudio();
    window.addEventListener("pointerdown", prime, { capture: true });
    window.addEventListener("keydown", prime, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", prime, { capture: true });
      window.removeEventListener("keydown", prime, { capture: true });
    };
  }, []);

  useEffect(() => () => {
    captionToken.current += 1;
    transcriptToken.current += 1;
    mediaToken.current += 1;
    codexToken.current += 1;
    if (autoCheckTimer.current !== undefined) window.clearTimeout(autoCheckTimer.current);
  }, []);

  function showMessage(text: string, error = false) {
    setStatus({ text, error });
  }

  function formatError(error: unknown, fallback: string) {
    const message = formatInvokeError(error, fallback);
    return message.includes("yt-dlp") && !message.includes("brew install yt-dlp")
      ? `${message}\n${t("ytDlpInstallHint")}`
      : message;
  }

  function updateAppSettings(update: Partial<AppSettings>) {
    setAppSettings((current) => {
      const next = { ...current, ...update };
      localStorage.setItem(appSettingsStorageKey, JSON.stringify(next));
      return next;
    });
  }

  function clearTranscript() {
    transcriptToken.current += 1;
    codexToken.current += 1;
    pendingCodex.current = null;
    codexBusy.current = false;
    setTranscript(null);
    setAnswer("");
    setAnswerKind("initial");
    setAnswerQuestion("");
    setAnswerExcerpt("");
    setAnswerContext(null);
    setCodexLoading(false);
    setSearchExpanded(false);
    setSearchQuery("");
    selectedOutputText.current = "";
  }

  function clearResult() {
    setCaptionList(null);
    setSelectedCaption(null);
    clearTranscript();
    setStatus({ text: "", error: false });
  }

  function handleUrlChange(nextUrl: string) {
    setUrl(nextUrl);
    if (autoCheckTimer.current !== undefined) window.clearTimeout(autoCheckTimer.current);
    autoCheckTimer.current = window.setTimeout(() => {
      const trimmed = nextUrl.trim();
      if (isLikelyYoutubeUrl(trimmed) && trimmed !== lastCaptionCheckUrl.current) {
        void checkCaptionCandidates(trimmed);
      }
    }, 450);
  }

  async function checkCaptionCandidates(requestUrl = url.trim()) {
    if (!requestUrl) {
      showMessage(t("urlRequired"), true);
      return;
    }
    const token = ++captionToken.current;
    lastCaptionCheckUrl.current = requestUrl;
    clearResult();
    setCaptionLoading(true);
    showMessage(t("fetchingCaptions"));
    try {
      const payload = await invokeBackend<CaptionListSuccess>("list_captions", { url: requestUrl });
      if (token !== captionToken.current) return;
      const first = payload.captions[0] ?? null;
      setCaptionList(payload);
      setSelectedCaption(first);
      if (!first) {
        showMessage(t("noCaptions"));
      } else if (payload.captions.length === 1) {
        showMessage(t("fetchingTranscript"));
        const fetched = await fetchSelectedTranscript(first, requestUrl);
        if (token === captionToken.current && fetched) await askCodexWithTranscript(fetched, first);
      } else {
        showMessage(t("chooseCaption"));
      }
    } catch (error) {
      if (token !== captionToken.current) return;
      lastCaptionCheckUrl.current = "";
      showMessage(formatError(error, t("listCaptionsFailed")), true);
    } finally {
      if (token === captionToken.current) setCaptionLoading(false);
    }
  }

  async function chooseCaption(caption: CaptionOption) {
    setSelectedCaption(caption);
    await fetchSelectedTranscript(caption, url.trim());
  }

  async function fetchSelectedTranscript(caption = selectedCaption, requestUrl = url.trim()) {
    if (!requestUrl || !caption) {
      showMessage(t("selectCaption"), true);
      return null;
    }
    const startedAt = performance.now();
    clearTranscript();
    const token = ++transcriptToken.current;
    setTranscriptLoading(true);
    appendDebugLog("frontend.fetch_transcript.request", { language: caption.language, source: caption.source });
    try {
      const payload = await invokeBackend<TranscriptSuccess>("fetch_transcript", {
        url: requestUrl,
        language: caption.language,
        source: caption.source
      });
      if (token !== transcriptToken.current) return null;
      setTranscript(payload);
      setSelectedCaption(caption);
      appendDebugLog("frontend.fetch_transcript.applied", {
        elapsedMs: Math.round(performance.now() - startedAt),
        textChars: payload.text.length,
        timedSegments: payload.timedSegments.length
      });
      showMessage(t("captionReady"));
      return payload;
    } catch (error) {
      if (token !== transcriptToken.current) return null;
      setTranscript(null);
      showMessage(formatError(error, t("fetchTranscriptFailed")), true);
      return null;
    } finally {
      if (token === transcriptToken.current) setTranscriptLoading(false);
    }
  }

  async function transcribeLocalMedia() {
    const path = mediaPath.trim();
    if (!path) {
      showMessage(t("mediaPathRequired"), true);
      return;
    }
    const token = ++mediaToken.current;
    captionToken.current += 1;
    clearResult();
    setMediaLoading(true);
    showMessage(t("transcribingMedia"));
    appendDebugLog("frontend.transcribe_media.request", { path });
    try {
      const payload = await invokeBackend<TranscriptSuccess>("transcribe_media", { path });
      if (token !== mediaToken.current) return;
      const caption: CaptionOption = {
        language: payload.language,
        name: t("kanaryTranscript"),
        source: payload.source,
        isAutoCaption: false
      };
      setSelectedCaption(caption);
      setTranscript(payload);
      appendDebugLog("frontend.transcribe_media.applied", { textChars: payload.text.length, sourcePath: payload.sourcePath });
      showMessage(t("mediaTranscriptReady"));
    } catch (error) {
      if (token === mediaToken.current) showMessage(formatError(error, t("transcribeMediaFailed")), true);
    } finally {
      if (token === mediaToken.current) setMediaLoading(false);
    }
  }

  function buildTimestampUrl(startSeconds: number) {
    return buildTimestampUrlFromBase(timestampBaseUrl, startSeconds);
  }

  function formatCaptionSource(source: CaptionSource) {
    if (source === "manual") return t("manualCaption");
    if (source === "kanary") return t("kanaryTranscript");
    return t("automaticCaption");
  }

  function formatCaptionLabel(caption: CaptionOption) {
    return `${caption.language} (${formatCaptionSource(caption.source)})`;
  }

  function buildAnalysisPrompt(
    value: TranscriptSuccess,
    template: PromptTemplate,
    options: { includeImageInstruction?: boolean; caption?: CaptionOption | null } = {}
  ) {
    const caption = options.caption === undefined ? selectedCaption : options.caption;
    return buildAnalysisPromptText(value, template, {
      includeImageInstruction: options.includeImageInstruction ?? appSettings.includeImagePrompt,
      transcriptText: buildTranscriptTextForDisplay(value, appSettings),
      captionLabel: caption
        ? formatCaptionLabel({ ...caption, language: value.language, source: value.source })
        : `${value.language} (${formatCaptionSource(value.source)})`,
      fallbackUrl: url.trim(),
      promptCreatedDate: new Date().toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" }),
      transcriptDisplayMode: appSettings.transcriptDisplayMode,
      buildTimestampUrl
    });
  }

  function getTranscriptAnswerContext(value: TranscriptSuccess): CodexAnswerContext {
    return {
      videoId: value.videoId,
      title: value.title || value.videoId,
      url: value.webpageUrl || value.sourcePath || url.trim(),
      language: value.language,
      source: value.source
    };
  }

  function getActiveAnswerContext() {
    return answerContext ?? (transcript ? getTranscriptAnswerContext(transcript) : null);
  }

  async function askCodexWithTranscript(value: TranscriptSuccess, caption = selectedCaption) {
    if (!selectedTemplate) return;
    const prompt = buildAnalysisPrompt(value, selectedTemplate, { includeImageInstruction: false, caption });
    appendDebugLog("frontend.codex_prompt.built", {
      templateId: selectedTemplate.id,
      generateImage: appSettings.includeImagePrompt,
      promptChars: prompt.length,
      promptPreview: truncateForLog(prompt, 8000)
    });
    await startCodexRequest(prompt, {
      questionKind: "initial",
      questionText: selectedTemplate.label,
      selectedExcerpt: "",
      templateId: selectedTemplate.id,
      generateImage: appSettings.includeImagePrompt,
      answerContext: getTranscriptAnswerContext(value)
    });
  }

  async function askCodex() {
    const value = transcript ?? (await fetchSelectedTranscript());
    if (!value) {
      showMessage(t("codexPromptRequired"), true);
      return;
    }
    await askCodexWithTranscript(value);
  }

  async function startCodexRequest(
    prompt: string,
    options: Omit<PendingCodexRequest, "jobId" | "token" | "prompt"> & { generateImage: boolean }
  ) {
    if (codexBusy.current) return;
    codexBusy.current = true;
    primeCompletionAudio();
    const token = ++codexToken.current;
    setCodexLoading(true);
    setAnswer("");
    setAnswerContext(options.answerContext);
    setOutputMode("codexAnswer");
    showMessage(t("askingCodex"));
    try {
      const started = await invokeBackend<CodexJobStartSuccess>("start_codex_request", {
        prompt,
        generateImage: options.generateImage
      });
      if (token !== codexToken.current) {
        codexBusy.current = false;
        void invokeBackend("cancel_codex_request", { jobId: started.jobId });
        return;
      }
      const request: PendingCodexRequest = { ...options, jobId: started.jobId, token, prompt };
      pendingCodex.current = request;
      while (token === codexToken.current && pendingCodex.current?.jobId === started.jobId) {
        await wait(codexPollIntervalMs);
        if (token !== codexToken.current) return;
        const result = await invokeBackend<CodexJobStatus>("get_codex_request", { jobId: started.jobId });
        if (result.status === "running") continue;
        pendingCodex.current = null;
        codexBusy.current = false;
        setCodexLoading(false);
        if (result.status === "completed" && result.answer) {
          const normalized = normalizeCodexAnswerMarkdown(result.answer);
          setAnswer(normalized);
          setAnswerKind(request.questionKind);
          setAnswerQuestion(request.questionText);
          setAnswerExcerpt(request.selectedExcerpt);
          setAnswerContext(request.answerContext);
          saveHistoryEntry(request, normalized);
          playCompletionSound();
        } else {
          const fallback = result.status === "cancelled" ? t("codexCancelled") : t("codexAnswerFailed");
          const message = result.error || fallback;
          setAnswer(message);
          showMessage(message, result.status !== "cancelled");
        }
        return;
      }
    } catch (error) {
      if (token !== codexToken.current) return;
      pendingCodex.current = null;
      codexBusy.current = false;
      setCodexLoading(false);
      const message = formatError(error, t("codexAnswerFailed"));
      setAnswer(message);
      showMessage(message, true);
    }
  }

  async function cancelCodexRequest() {
    const request = pendingCodex.current;
    codexToken.current += 1;
    pendingCodex.current = null;
    codexBusy.current = false;
    setCodexLoading(false);
    if (request) {
      try {
        await invokeBackend<CodexJobStatus>("cancel_codex_request", { jobId: request.jobId });
      } catch {
        // The local UI should recover even if the child process already exited.
      }
    }
    setAnswer(t("codexCancelled"));
    showMessage(t("codexCancelled"));
  }

  async function copyAnswer() {
    const text = getCodexAnswerTextForCopy(answer);
    if (!text) {
      showMessage(t("codexNoAnswer"), true);
      return;
    }
    try {
      await copyText(text);
      showMessage(t("codexAnswerCopied"));
    } catch {
      showMessage(t("copyFailed"), true);
    }
  }

  async function rerunAnswer() {
    if (!transcript || !selectedTemplate) {
      showMessage(t("codexPromptRequired"), true);
      return;
    }
    const prompt =
      answerKind === "followup" || answerKind === "selection"
        ? buildFollowUpPrompt(answerQuestion || selectedTemplate.label, answerExcerpt)
        : buildAnalysisPrompt(transcript, selectedTemplate, { includeImageInstruction: false });
    await startCodexRequest(prompt, {
      questionKind: "rerun",
      questionText: answerQuestion || selectedTemplate.label,
      selectedExcerpt: answerExcerpt,
      templateId: selectedTemplate.id,
      generateImage: appSettings.includeImagePrompt,
      answerContext: getTranscriptAnswerContext(transcript)
    });
  }

  function buildFollowUpPrompt(question: string, excerpt: string) {
    return buildFollowUpPromptText({
      question,
      selectedExcerpt: excerpt,
      transcript,
      context: getActiveAnswerContext(),
      sourceAnswer: answer.trim(),
      fallbackUrl: url.trim(),
      formatCaptionSource
    });
  }

  function openFollowUp(kind: CodexQuestionKind, excerpt: string) {
    if (!transcript && !answer.trim()) {
      showMessage(t("codexPromptRequired"), true);
      return;
    }
    setFollowUpContext({ kind, selectedExcerpt: excerpt });
    setFollowUpQuestion("");
    setFollowUpOpen(true);
    requestAnimationFrame(() => followUpRef.current?.focus());
  }

  async function submitFollowUp() {
    const question = followUpQuestion.trim();
    if (!question) {
      showMessage(t("followUpRequired"), true);
      return;
    }
    const context = followUpContext ?? { kind: "followup" as CodexQuestionKind, selectedExcerpt: "" };
    setFollowUpOpen(false);
    setFollowUpContext(null);
    if (!selectedTemplate) return;
    await startCodexRequest(buildFollowUpPrompt(question, context.selectedExcerpt), {
      questionKind: context.kind,
      questionText: question,
      selectedExcerpt: context.selectedExcerpt,
      templateId: selectedTemplate.id,
      generateImage: false,
      answerContext: getActiveAnswerContext()
    });
  }

  function cacheSelectedText() {
    const textarea = outputRef.current;
    if (outputMode !== "codexAnswer" && textarea) {
      const start = textarea.selectionStart ?? 0;
      const end = textarea.selectionEnd ?? 0;
      const text = textarea.value.slice(Math.min(start, end), Math.max(start, end)).trim();
      if (text) selectedOutputText.current = text;
      return;
    }
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? "";
    if (text && answerOutputRef.current?.contains(selection?.anchorNode ?? null)) selectedOutputText.current = text;
  }

  function askAboutSelection() {
    cacheSelectedText();
    if (!selectedOutputText.current) {
      showMessage(t("codexNoSelection"), true);
      return;
    }
    openFollowUp("selection", selectedOutputText.current);
  }

  function saveHistoryEntry(request: PendingCodexRequest, answerMarkdown: string) {
    const context = request.answerContext ?? (transcript ? getTranscriptAnswerContext(transcript) : null);
    if (!context) return;
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
    setHistory((current) => {
      const next = [entry, ...current.filter((item) => item.id !== entry.id)].slice(0, codexHistoryLimit);
      try {
        localStorage.setItem(codexHistoryStorageKey, JSON.stringify(next));
      } catch {
        // History is best-effort and must not discard the completed answer.
      }
      return next;
    });
  }

  function restoreHistory(entry: CodexHistoryEntry) {
    setAnswer(normalizeCodexAnswerMarkdown(entry.answerMarkdown));
    setAnswerKind("history");
    setAnswerQuestion(`${t("historyRestoredPrefix")}: ${entry.questionText}`);
    setAnswerExcerpt(entry.selectedExcerpt);
    setAnswerContext({
      videoId: entry.videoId,
      title: entry.title || entry.videoId,
      url: entry.url,
      language: entry.language,
      source: entry.source
    });
    setOutputMode("codexAnswer");
    showMessage(t("codexHistoryRestored"));
  }

  function clearHistory() {
    setHistory([]);
    localStorage.removeItem(codexHistoryStorageKey);
    showMessage(t("codexHistoryCleared"));
  }

  function selectSettingsTemplate(id: string) {
    setSettingsTemplateId(id);
    setTemplateDraft(toTemplateDraft(promptSettings, id));
  }

  function openSettings() {
    setUiLanguageDraft(appSettings.uiLanguage);
    setCompletionSoundDraft(appSettings.completionSoundEnabled);
    selectSettingsTemplate(selectedTemplateId || promptSettings.defaultTemplateId);
    setSettingsOpen(true);
    requestAnimationFrame(() => {
      settingsTitleRef.current?.focus();
      settingsTitleRef.current?.select();
    });
  }

  function closeSettings() {
    setSettingsOpen(false);
    requestAnimationFrame(() => settingsButtonRef.current?.focus());
  }

  function addTemplate() {
    const template: PromptTemplate = {
      id: `custom-${Date.now()}`,
      label: t("newPrompt"),
      description: t("newPromptDescription"),
      instruction: t("newPromptInstruction")
    };
    const next = { ...promptSettings, templates: [...promptSettings.templates, template] };
    setPromptSettings(next);
    storePromptSettings(next);
    setSettingsTemplateId(template.id);
    setTemplateDraft({ ...template, isDefault: false });
  }

  function deleteTemplate() {
    if (promptSettings.templates.length <= 1) return;
    const templates = promptSettings.templates.filter((template) => template.id !== settingsTemplateId);
    const defaultTemplateId =
      promptSettings.defaultTemplateId === settingsTemplateId
        ? templates[0]?.id ?? defaultPromptTemplateId
        : promptSettings.defaultTemplateId;
    const next = { defaultTemplateId, templates };
    const nextId = templates[0]?.id ?? defaultTemplateId;
    setPromptSettings(next);
    storePromptSettings(next);
    setSelectedTemplateId(resolveTemplateId(next, selectedTemplateId));
    setSettingsTemplateId(nextId);
    setTemplateDraft(toTemplateDraft(next, nextId));
  }

  function resetTemplates() {
    const next = createDefaultPromptSettings();
    setPromptSettings(next);
    storePromptSettings(next);
    setSelectedTemplateId(next.defaultTemplateId);
    setSettingsTemplateId(next.defaultTemplateId);
    setTemplateDraft(toTemplateDraft(next, next.defaultTemplateId));
    showMessage(t("settingsReset"));
  }

  function saveTemplate() {
    const templates = promptSettings.templates.map((template) =>
      template.id === settingsTemplateId
        ? {
            ...template,
            label: templateDraft.label.trim() || t("untitledPrompt"),
            description: templateDraft.description.trim(),
            instruction: templateDraft.instruction.trim() || t("newPromptInstruction")
          }
        : template
    );
    const next = {
      templates,
      defaultTemplateId: templateDraft.isDefault ? settingsTemplateId : promptSettings.defaultTemplateId
    };
    setPromptSettings(next);
    storePromptSettings(next);
    setSelectedTemplateId(settingsTemplateId);
    setTemplateDraft(toTemplateDraft(next, settingsTemplateId));
    showMessage(t("settingsSaved"));
  }

  function saveDisplaySettings() {
    updateAppSettings({ uiLanguage: uiLanguageDraft, completionSoundEnabled: completionSoundDraft });
    audioPrimed.current = false;
    primeCompletionAudio();
    const nextText = uiText[uiLanguageDraft].displaySaved;
    showMessage(typeof nextText === "string" ? nextText : "");
  }

  async function loadDebugLog() {
    try {
      const log = await invokeBackend<DebugLogReadResult>("read_debug_log");
      setDebugLog(log);
      showMessage(t("debugLogLoaded"));
    } catch (error) {
      showMessage(formatError(error, t("debugLogLoadFailed")), true);
    }
  }

  function primeCompletionAudio() {
    if (!settingsRef.current.completionSoundEnabled || audioPrimed.current) return;
    const context = audioContext.current ?? new AudioContext();
    audioContext.current = context;
    if (context.state === "suspended") {
      void context.resume().then(() => { audioPrimed.current = context.state === "running"; }).catch(() => {});
    } else {
      audioPrimed.current = true;
    }
  }

  function playCompletionSound() {
    if (!settingsRef.current.completionSoundEnabled) return;
    const context = audioContext.current ?? new AudioContext();
    audioContext.current = context;
    const play = () => {
      const now = context.currentTime;
      playCompletionTone(context, now, 660, 0.055);
      playCompletionTone(context, now + 0.075, 880, 0.075);
    };
    if (context.state === "suspended") void context.resume().then(play).catch(() => {});
    else play();
  }

  async function openTimestampUrl(targetUrl: string | undefined) {
    if (!targetUrl) return;
    try {
      await invokeBackend("open_youtube_url", { url: targetUrl });
    } catch {
      window.open(targetUrl, "_blank", "noopener,noreferrer");
    }
  }

  async function openExternalUrl(targetUrl: string | undefined) {
    if (!targetUrl) return;
    try {
      await invokeBackend("open_external_url", { url: targetUrl });
    } catch {
      window.open(targetUrl, "_blank", "noopener,noreferrer");
    }
  }

  async function handleAnswerLink(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const timestampLink = target.closest<HTMLElement>("[data-timestamp-url]");
    if (timestampLink) {
      event.preventDefault();
      await openTimestampUrl(timestampLink.dataset.timestampUrl);
      return;
    }
    const link = target.closest<HTMLAnchorElement>("a[href]");
    if (!link) return;
    event.preventDefault();
    if (isLikelyYoutubeUrl(link.href)) await openTimestampUrl(link.href);
    else await openExternalUrl(link.href);
  }

  const source = transcript?.source ?? selectedCaption?.source;
  const locale = appSettings.uiLanguage === "ja" ? "ja-JP" : "en-US";
  const searchStatus = !transcript || searchableSegments.length === 0
    ? t("transcriptSearchDisabled")
    : !normalizeSearchText(searchQuery)
      ? t("transcriptSearchReady")
      : searchMatches.length === 0
        ? t("transcriptSearchEmpty")
        : t("transcriptSearchCount", searchMatches.length);

  return (
    <section className="workspace">
      <header className="app-section app-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M21 7.3a3 3 0 0 0-2.1-2.1C17 4.7 12 4.7 12 4.7s-5 0-6.9.5A3 3 0 0 0 3 7.3 31.4 31.4 0 0 0 2.5 12c0 1.6.1 3.2.5 4.7a3 3 0 0 0 2.1 2.1c1.9.5 6.9.5 6.9.5s5 0 6.9-.5a3 3 0 0 0 2.1-2.1c.4-1.5.5-3.1.5-4.7 0-1.6-.1-3.2-.5-4.7Z" /><path d="m10 9 5 3-5 3V9Z" /></svg></span>
          <div><h1>{appName}</h1><p>{t("heading")}</p></div>
        </div>
        <SectionMarker index="01" label="INPUT" />
        <form className="input-panel" id="caption-form" onSubmit={(event) => { event.preventDefault(); void checkCaptionCandidates(); }}>
          <div className="command-row">
            <Input ref={urlInputRef} id="youtube-url" name="url" type="url" aria-label="YouTube URL" placeholder="https://www.youtube.com/watch?v=..." autoComplete="off" required value={url} onChange={(event) => handleUrlChange(event.target.value)} aria-busy={captionLoading} />
            <Button id="ask-codex-button" type="button" size="lg" disabled={codexRunning || transcriptLoading || (!transcript && !selectedCaption)} className={codexRunning || transcriptLoading ? "is-loading" : undefined} aria-busy={codexRunning || transcriptLoading} onClick={() => void askCodex()}>
              <span>{codexRunning ? t("askCodexLoading") : transcriptLoading ? t("fetchTranscriptLoading") : t("askCodex")}</span><Spinner className="loading-indicator" data-icon="inline-end" />
            </Button>
            <Button {...secondaryButtonProps} id="transcript-search-toggle" type="button" disabled={!transcript} aria-expanded={Boolean(transcript && searchExpanded)} aria-controls="transcript-search-panel" onClick={() => { const next = !searchExpanded; setSearchExpanded(next); if (next) requestAnimationFrame(() => searchInputRef.current?.focus()); }}>
              <SearchIcon data-icon="inline-start" /><span>{t("transcriptSearchToggle")}</span>
            </Button>
          </div>
          <div className="media-command-row">
            <label className="sr-only" htmlFor="local-media-path">{t("mediaPathLabel")}</label>
            <Input id="local-media-path" name="media-path" type="text" placeholder={t("mediaPathPlaceholder")} autoComplete="off" value={mediaPath} onChange={(event) => setMediaPath(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void transcribeLocalMedia(); } }} aria-busy={mediaLoading} />
            <Button {...secondaryButtonProps} id="transcribe-media-button" type="button" disabled={mediaLoading} className={mediaLoading ? "is-loading" : undefined} aria-busy={mediaLoading} onClick={() => void transcribeLocalMedia()}>
              <span>{mediaLoading ? t("transcribeMediaLoading") : t("transcribeMedia")}</span><Spinner className="loading-indicator" data-icon="inline-end" />
            </Button>
          </div>
          <Alert className={`status-message${status.error ? " error" : ""}`} id="message" role="status" aria-live="polite" hidden={!status.text.trim()}>{status.text}</Alert>
        </form>
        <div className="app-header-actions">
          <Button {...secondaryButtonProps} id="reload-app-button" type="button" onClick={() => window.location.reload()}><RotateCwIcon data-icon="inline-start" /><span>{t("reloadButton")}</span></Button>
          <Button {...secondaryButtonProps} ref={settingsButtonRef} id="prompt-settings-button" type="button" onClick={openSettings}><SettingsIcon data-icon="inline-start" /><span>{t("settingsButton")}</span></Button>
        </div>
      </header>

      <section className="result-layout" aria-live="polite">
        <section className="app-section info-section">
          <SectionMarker index="02" label="VIDEO INFO" />
          <div className="meta-panel">
            <div className={`video-preview${metadata?.thumbnailUrl ? "" : " is-text-only"}`} id="video-preview" hidden={!metadata?.title}>
              {metadata?.thumbnailUrl ? <img id="video-thumbnail" src={metadata.thumbnailUrl} alt="" loading="lazy" /> : null}
              <div className="video-preview-body"><span className="label">{t("transcriptTitle")}</span><strong id="video-preview-title">{metadata?.title || "-"}</strong></div>
            </div>
            <MetaItem label={t("selectedLanguage")} value={selectedCaption ? formatCaptionLabel(selectedCaption) : "-"} />
            <MetaItem label={t("characterCount")} value={transcriptText.length.toLocaleString(locale)} />
            <MetaItem label={t("videoDuration")} value={metadata?.duration || "-"} />
            <div className="meta-summary-item"><span className="label">{t("canonicalUrl")}</span><strong id="canonical-url">{metadata?.webpageUrl ? <a href={metadata.webpageUrl} onClick={(event) => { event.preventDefault(); void openTimestampUrl(metadata.webpageUrl); }}>{t("canonicalUrlLink")}</a> : "-"}</strong></div>
            <MetaItem label={t("viewCount")} value={typeof metadata?.viewCount === "number" ? metadata.viewCount.toLocaleString(locale) : "-"} />
            <MetaItem label={t("captionSourceLabel")} value={source ? formatCaptionSource(source) : "-"} />
            <div className="meta-prompt-settings">
              <label className="label" htmlFor="prompt-template">{t("copyPrompt")}</label>
              <NativeSelect id="prompt-template" className="w-full" value={selectedTemplate?.id} onChange={(event) => { setSelectedTemplateId(event.target.value); if (transcript) showMessage(t("promptChanged")); }}>
                {promptSettings.templates.map((template) => <NativeSelectOption key={template.id} value={template.id}>{template.label}</NativeSelectOption>)}
              </NativeSelect>
              <p className="prompt-description" id="prompt-description">{selectedTemplate?.description}</p>
            </div>
          </div>
        </section>

        <section className="app-section output-section">
          <SectionMarker index="03" label="OUTPUT" />
          <div className="output-panel">
            <h2 id="video-title" hidden>{metadata?.title || t("transcriptTitle")}</h2>
            <section className="caption-panel" id="caption-panel" hidden={(captionList?.captions.length ?? 0) <= 1}>
              <div className="caption-panel-header"><h3>{t("captionsTitle")}</h3><span id="caption-count">{t("captionCount", captionList?.captions.length ?? 0)}</span></div>
              <div className="caption-list" id="caption-list">
                {captionList?.captions.map((caption, index) => (
                  <label className="caption-option" key={`${caption.language}-${caption.source}-${index}`}>
                    <input type="radio" name="caption-option" checked={caption.language === selectedCaption?.language && caption.source === selectedCaption?.source} onChange={() => void chooseCaption(caption)} />
                    <span className="caption-option-body"><strong>{caption.name || caption.language}</strong><span>{caption.language} <Badge variant="secondary">{formatCaptionSource(caption.source)}</Badge></span></span>
                  </label>
                ))}
              </div>
            </section>
            <section className="search-panel" id="transcript-search-panel" hidden={!transcript || !searchExpanded}>
              <div className="search-header"><h3>{t("transcriptSearchTitle")}</h3><span id="transcript-search-count">{searchStatus}</span></div>
              <label className="label" htmlFor="transcript-search">{t("transcriptSearchLabel")}</label>
              <Input ref={searchInputRef} id="transcript-search" type="search" autoComplete="off" disabled={searchableSegments.length === 0} placeholder={t("transcriptSearchPlaceholder")} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
              <div className="search-results" id="transcript-search-results">
                {searchMatches.map((segment) => <Button className="search-result" variant="ghost" type="button" key={`${segment.startLabel}-${segment.startSeconds}`} onClick={() => void openTimestampUrl(buildTimestampUrl(segment.startSeconds))}><span className="search-result-body"><strong>{segment.startLabel}</strong><span>{truncateSearchResult(segment.text)}</span></span><span className="search-result-action">{t("openTimestamp")}</span></Button>)}
              </div>
            </section>
            <Tabs value={outputMode} onValueChange={(value) => { if (isOutputMode(value)) setOutputMode(value); }} className="output-tabs-shell">
              <div className="output-tabs">
                <TabsList variant="line" aria-label="Output view" className="output-tabs-list">
                  <TabsTrigger className="output-tab" id="transcript-view-tab" value="transcript" data-output-mode="transcript" aria-controls="transcript-output">{t("transcriptView")}</TabsTrigger>
                  <TabsTrigger className="output-tab" id="copy-prompt-view-tab" value="copyPrompt" data-output-mode="copyPrompt" aria-controls="transcript-output">{t("copyPromptView")}</TabsTrigger>
                  <TabsTrigger className="output-tab" id="codex-answer-view-tab" value="codexAnswer" data-output-mode="codexAnswer" aria-controls="codex-answer-output">{t("codexAnswerView")}</TabsTrigger>
                </TabsList>
                <span className="output-tab-divider" aria-hidden="true" hidden={outputMode !== "codexAnswer"} />
                <div className="codex-toolbar" id="codex-toolbar" hidden={outputMode !== "codexAnswer"}>
                  <ToolbarButton id="copy-codex-answer" disabled={!hasAnswer || codexRunning} onClick={() => void copyAnswer()}>{t("copyAnswer")}</ToolbarButton>
                  <ToolbarButton id="rerun-codex-answer" disabled={!transcript || answerKind === "history" || codexRunning} onClick={() => void rerunAnswer()}>{t("rerunAnswer")}</ToolbarButton>
                  <ToolbarButton id="follow-up-codex-answer" disabled={!hasAnswer || codexRunning} onClick={() => openFollowUp("followup", "")}>{t("followUpAnswer")}</ToolbarButton>
                  <ToolbarButton id="ask-selection-codex" disabled={codexRunning || (!transcript && !hasAnswer)} onClick={askAboutSelection}>{t("askSelection")}</ToolbarButton>
                  <Button id="cancel-codex-answer" type="button" variant="destructive" size="sm" hidden={!codexRunning} onClick={() => void cancelCodexRequest()}>{t("cancelCodex")}</Button>
                </div>
              </div>
            </Tabs>
            <Textarea ref={outputRef} id="transcript-output" spellCheck={false} readOnly value={outputValue} hidden={outputMode === "codexAnswer"} onSelect={cacheSelectedText} />
            <div ref={answerOutputRef} id="codex-answer-output" className="markdown-output" hidden={outputMode !== "codexAnswer"} dangerouslySetInnerHTML={{ __html: answerHtml }} onClick={(event) => void handleAnswerLink(event)} onMouseUp={cacheSelectedText} onKeyUp={cacheSelectedText} />
            <section className="history-panel" id="codex-history-panel" hidden={history.length === 0}>
              <div className="history-header"><h3>{t("codexHistoryTitle")}</h3><div className="history-header-actions"><span id="codex-history-count">{history.length.toLocaleString(locale)}</span><ToolbarButton id="clear-codex-history" onClick={clearHistory}>{t("clearCodexHistory")}</ToolbarButton></div></div>
              <div className="history-list" id="codex-history-list">
                {history.length === 0 ? <Empty className="history-empty"><EmptyDescription>{t("codexHistoryEmpty")}</EmptyDescription></Empty> : history.map((entry) => {
                  const date = new Date(entry.createdAt).toLocaleString(locale);
                  const question = entry.questionText ? ` / ${entry.questionText}` : "";
                  return <Button className="history-item" variant="ghost" type="button" key={entry.id} onClick={() => restoreHistory(entry)}><strong>{entry.title}</strong><span>{date} / {formatCaptionSource(entry.source)}{question}</span></Button>;
                })}
              </div>
            </section>
          </div>
        </section>
      </section>

      <PersistentDialog id="prompt-settings-modal" open={settingsOpen} onClose={closeSettings} className="settings-dialog-content" titleId="prompt-settings-title">
        <section className="settings-panel">
          <div className="settings-header"><div><p className="eyebrow">{t("settingsEyebrow")}</p><h2 id="prompt-settings-title">{t("settingsTitle")}</h2></div><ToolbarButton id="prompt-settings-close" onClick={closeSettings}>{t("close")}</ToolbarButton></div>
          <Tabs value={settingsSection} onValueChange={(value) => { if (isSettingsSection(value)) setSettingsSection(value); }}>
            <TabsList variant="line" aria-label="Settings sections" className="settings-tabs">
              <TabsTrigger className="settings-tab" id="settings-prompts-tab" value="prompts" data-settings-section="prompts">{t("promptsTab")}</TabsTrigger>
              <TabsTrigger className="settings-tab" id="settings-copy-tab" value="copy" data-settings-section="copy">{t("copyTab")}</TabsTrigger>
              <TabsTrigger className="settings-tab" id="settings-display-tab" value="display" data-settings-section="display">{t("displayTab")}</TabsTrigger>
            </TabsList>
            <div className="settings-body">
              <section className="settings-section" id="settings-prompts-section" role="tabpanel" aria-labelledby="settings-prompts-tab" hidden={settingsSection !== "prompts"}>
                <div className="settings-template-list"><label className="label" htmlFor="settings-template-select">{t("template")}</label><select id="settings-template-select" size={6} value={settingsTemplateId} onChange={(event) => selectSettingsTemplate(event.target.value)}>{promptSettings.templates.map((template) => <option key={template.id} value={template.id}>{template.label}{template.id === promptSettings.defaultTemplateId ? t("defaultMark") : ""}</option>)}</select><div className="settings-actions"><ToolbarButton id="settings-add-template" onClick={addTemplate}>{t("add")}</ToolbarButton><ToolbarButton id="settings-delete-template" disabled={promptSettings.templates.length <= 1} onClick={deleteTemplate}>{t("delete")}</ToolbarButton></div></div>
                <div className="settings-editor">
                  <FormField id="settings-template-title" label={t("title")}><Input ref={settingsTitleRef} id="settings-template-title" type="text" value={templateDraft.label} onChange={(event) => setTemplateDraft((draft) => ({ ...draft, label: event.target.value }))} /></FormField>
                  <FormField id="settings-template-description" label={t("description")}><Input id="settings-template-description" type="text" value={templateDraft.description} onChange={(event) => setTemplateDraft((draft) => ({ ...draft, description: event.target.value }))} /></FormField>
                  <FormField id="settings-template-body" label={t("body")}><Textarea id="settings-template-body" className="settings-template-body" spellCheck={false} value={templateDraft.instruction} onChange={(event) => setTemplateDraft((draft) => ({ ...draft, instruction: event.target.value }))} /></FormField>
                  <ControlledCheckbox id="settings-template-default" checked={templateDraft.isDefault} onChange={(checked) => setTemplateDraft((draft) => ({ ...draft, isDefault: checked }))}>{t("defaultTemplate")}</ControlledCheckbox>
                  <div className="settings-footer"><ToolbarButton id="settings-reset-template" onClick={resetTemplates}>{t("reset")}</ToolbarButton><Button id="settings-save-template" type="button" size="lg" onClick={saveTemplate}>{t("save")}</Button></div>
                </div>
              </section>
              <section className="settings-section settings-section-single" id="settings-copy-section" role="tabpanel" aria-labelledby="settings-copy-tab" hidden={settingsSection !== "copy"}>
                <div className="settings-editor"><div><h3 className="settings-section-title">{t("copySettingsTitle")}</h3><p className="hint">{t("copySettingsDescription")}</p></div><div className="copy-option-row">
                  <ControlledCheckbox id="include-image-prompt" className="option-toggle" checked={appSettings.includeImagePrompt} onChange={(checked) => { updateAppSettings({ includeImagePrompt: checked }); showMessage(t("copyOptionsChanged")); }}>{t("includeImagePrompt")}</ControlledCheckbox>
                  <ControlledCheckbox id="format-automatic-transcript" className="option-toggle" checked={appSettings.formatAutomaticTranscript} onChange={(checked) => { updateAppSettings({ formatAutomaticTranscript: checked }); showMessage(t("copyOptionsChanged")); }}>{t("formatAutomaticTranscript")}</ControlledCheckbox>
                </div><div className="display-mode-control" role="group" aria-labelledby="transcript-display-mode-label"><span className="label" id="transcript-display-mode-label">{t("transcriptDisplayModeLabel")}</span><div className="segmented-control"><ToggleGroup type="single" value={appSettings.transcriptDisplayMode} onValueChange={(value) => { if (isTranscriptDisplayMode(value)) { updateAppSettings({ transcriptDisplayMode: value }); showMessage(t("copyOptionsChanged")); } }} variant="outline" className="w-full"><ToggleGroupItem value="plain" className="flex-1">{t("plainTranscript")}</ToggleGroupItem><ToggleGroupItem value="timestamped" className="flex-1">{t("timestampedTranscript")}</ToggleGroupItem></ToggleGroup></div></div></div>
              </section>
              <section className="settings-section settings-section-single" id="settings-display-section" role="tabpanel" aria-labelledby="settings-display-tab" hidden={settingsSection !== "display"}>
                <div className="settings-editor"><label className="label" htmlFor="settings-ui-language">{t("uiLanguage")}</label><NativeSelect id="settings-ui-language" className="w-full" value={uiLanguageDraft} onChange={(event) => setUiLanguageDraft(event.target.value === "en" ? "en" : "ja")}><NativeSelectOption value="ja">{t("japanese")}</NativeSelectOption><NativeSelectOption value="en">{t("english")}</NativeSelectOption></NativeSelect><p className="hint">{t("uiLanguageDescription")}</p>
                  <ControlledCheckbox id="settings-completion-sound" checked={completionSoundDraft} onChange={setCompletionSoundDraft}>{t("completionSound")}</ControlledCheckbox>
                  <div className="debug-log-settings"><span className="label">{t("debugLog")}</span><p className="hint">{t("debugLogDescription")}</p><ToolbarButton id="settings-open-debug-log" onClick={() => void loadDebugLog()}>{debugLog ? t("refreshDebugLog") : t("showDebugLog")}</ToolbarButton><div className="debug-log-viewer" id="settings-debug-log-viewer" hidden={!debugLog}>{debugLog ? <><span className="debug-log-path-label">{t("debugLogPath")}</span><code id="settings-debug-log-path">{debugLog.path}</code><Textarea id="settings-debug-log-content" className="debug-log-content" spellCheck={false} readOnly value={debugLog.content.trim() || t("debugLogEmpty")} /></> : null}</div></div>
                  <div className="settings-footer"><Button id="settings-save-display" type="button" size="lg" onClick={saveDisplaySettings}>{t("save")}</Button></div>
                </div>
              </section>
            </div>
          </Tabs>
        </section>
      </PersistentDialog>

      <PersistentDialog id="follow-up-modal" open={followUpOpen} onClose={() => { setFollowUpOpen(false); setFollowUpContext(null); }} className="follow-up-dialog-content" titleId="follow-up-title">
        <section className="follow-up-panel"><div className="settings-header"><div><p className="eyebrow">Codex</p><h2 id="follow-up-title">{t("followUpTitle")}</h2></div><ToolbarButton id="follow-up-close" onClick={() => setFollowUpOpen(false)}>{t("followUpCancel")}</ToolbarButton></div><div className="follow-up-body"><FormField id="follow-up-question" label={t("followUpLabel")}><Textarea ref={followUpRef} id="follow-up-question" className="follow-up-question" spellCheck placeholder={t("followUpPlaceholder")} value={followUpQuestion} onChange={(event) => setFollowUpQuestion(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void submitFollowUp(); } }} /></FormField><div className="settings-footer"><Button id="follow-up-submit" type="button" size="lg" onClick={() => void submitFollowUp()}>{t("followUpSubmit")}</Button></div></div></section>
      </PersistentDialog>
    </section>
  );
}

function SectionMarker({ index, label }: { index: string; label: string }) {
  return <div className="section-marker" aria-hidden="true"><span className="section-number">{index}</span><span className="section-name">{label}</span><span className="section-line" /></div>;
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return <div className="meta-summary-item"><span className="label">{label}</span><strong>{value}</strong></div>;
}

function ToolbarButton({ id, children, disabled, onClick }: { id: string; children: React.ReactNode; disabled?: boolean; onClick: () => void }) {
  return <Button id={id} type="button" variant="outline" size="sm" disabled={disabled} onClick={onClick}>{children}</Button>;
}

function FormField({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return <Field><FieldLabel htmlFor={id}>{label}</FieldLabel>{children}</Field>;
}

function ControlledCheckbox({ id, checked, onChange, children, className = "default-template-toggle" }: { id: string; checked: boolean; onChange: (checked: boolean) => void; children: React.ReactNode; className?: string }) {
  return <label className={className} htmlFor={`${id}-control`}><Checkbox id={`${id}-control`} aria-labelledby={`${id}-label`} checked={checked} onCheckedChange={(value) => onChange(value === true)} /><span id={`${id}-label`}>{children}</span></label>;
}

function PersistentDialog({ id, open, onClose, className, titleId, children }: { id: string; open: boolean; onClose: () => void; className: string; titleId: string; children: React.ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={dialogRef} id={id} data-state={open ? "open" : "closed"} className={className} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }} onPointerDownCapture={(event) => { if (event.target !== event.currentTarget) return; const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose(); }}>{children}</dialog>;
}

function loadAppSettings(): AppSettings {
  const fallback: AppSettings = { uiLanguage: "ja", includeImagePrompt: true, formatAutomaticTranscript: true, transcriptDisplayMode: "plain", completionSoundEnabled: true };
  try {
    const rawValue = localStorage.getItem(appSettingsStorageKey);
    if (!rawValue) return fallback;
    const parsed = JSON.parse(rawValue) as StoredAppSettings;
    return {
      uiLanguage: parsed.uiLanguage === "en" ? "en" : "ja",
      includeImagePrompt: parsed.includeImagePrompt !== false,
      formatAutomaticTranscript: parsed.formatAutomaticTranscript !== false,
      transcriptDisplayMode: isTranscriptDisplayMode(parsed.transcriptDisplayMode) ? parsed.transcriptDisplayMode : "plain",
      completionSoundEnabled: parsed.completionSoundEnabled !== false
    };
  } catch {
    return fallback;
  }
}

function loadPromptSettings(): PromptSettings {
  const fallback = createDefaultPromptSettings();
  try {
    const rawValue = localStorage.getItem(promptSettingsStorageKey);
    if (!rawValue) return fallback;
    const parsed = JSON.parse(rawValue) as Partial<PromptSettings>;
    const templates = Array.isArray(parsed.templates) ? parsed.templates.map(normalizePromptTemplate).filter((template): template is PromptTemplate => Boolean(template)).map(migratePromptTemplate) : [];
    if (templates.length === 0) return fallback;
    const defaultTemplateId = typeof parsed.defaultTemplateId === "string" && templates.some((template) => template.id === parsed.defaultTemplateId) ? parsed.defaultTemplateId : templates[0].id;
    return { defaultTemplateId, templates };
  } catch {
    return fallback;
  }
}

function loadCodexHistory(): CodexHistoryEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(codexHistoryStorageKey) ?? "[]");
    return Array.isArray(parsed) ? parsed.map(normalizeCodexHistoryEntry).filter((entry): entry is CodexHistoryEntry => Boolean(entry)).slice(0, codexHistoryLimit) : [];
  } catch {
    return [];
  }
}

function createDefaultPromptSettings(): PromptSettings {
  return { defaultTemplateId: defaultPromptTemplateId, templates: defaultPromptTemplates.map((template) => ({ ...template })) };
}

function storePromptSettings(settings: PromptSettings) {
  localStorage.setItem(promptSettingsStorageKey, JSON.stringify(settings));
}

function normalizePromptTemplate(value: unknown): PromptTemplate | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PromptTemplate>;
  if (typeof candidate.id !== "string" || typeof candidate.label !== "string" || typeof candidate.description !== "string" || typeof candidate.instruction !== "string") return null;
  return { id: candidate.id, label: candidate.label, description: candidate.description, instruction: candidate.instruction };
}

function migratePromptTemplate(template: PromptTemplate): PromptTemplate {
  const isUnchangedLegacyDefault =
    template.id === legacyDefaultPromptTemplate.id &&
    template.label === legacyDefaultPromptTemplate.label &&
    template.description === legacyDefaultPromptTemplate.description &&
    template.instruction === legacyDefaultPromptTemplate.instruction;
  return isUnchangedLegacyDefault ? { ...defaultPromptTemplates[0] } : template;
}

function normalizeCodexHistoryEntry(value: unknown): CodexHistoryEntry | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CodexHistoryEntry>;
  if (typeof candidate.id !== "string" || typeof candidate.createdAt !== "string" || typeof candidate.videoId !== "string" || typeof candidate.title !== "string" || typeof candidate.url !== "string" || typeof candidate.language !== "string" || !matchesCaptionSource(candidate.source) || typeof candidate.templateId !== "string" || typeof candidate.questionKind !== "string" || typeof candidate.questionText !== "string" || typeof candidate.selectedExcerpt !== "string" || typeof candidate.answerMarkdown !== "string") return null;
  return { ...(candidate as CodexHistoryEntry), answerMarkdown: normalizeCodexAnswerMarkdown(candidate.answerMarkdown) };
}

function toTemplateDraft(settings: PromptSettings, id: string): TemplateDraft {
  const template = settings.templates.find((item) => item.id === id) ?? settings.templates[0] ?? defaultPromptTemplates[0];
  return { ...template, isDefault: template.id === settings.defaultTemplateId };
}

function resolveTemplateId(settings: PromptSettings, id: string) {
  return settings.templates.some((template) => template.id === id) ? id : settings.defaultTemplateId;
}

function normalizeSearchText(value: string) {
  return value.trim().toLocaleLowerCase();
}

function truncateSearchResult(value: string) {
  const normalized = normalizeTranscriptSegment(value);
  return normalized.length > 160 ? `${normalized.slice(0, 160)}...` : normalized;
}

function truncateForLog(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function formatInvokeError(error: unknown, fallback: string) {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "object" && error && "error" in error) return (error as ApiFailure).error || fallback;
  return fallback;
}

function appendDebugLog(event: string, details: Record<string, unknown>) {
  void invokeBackend("append_debug_log", { entry: { event, details } }).catch(() => {});
}

function playCompletionTone(context: AudioContext, startAt: number, frequency: number, duration: number) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.045, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.01);
}

function copyTextWithSelectionFallback(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.cssText = "position:fixed;inset:0 auto auto 0;opacity:0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
  else copyTextWithSelectionFallback(text);
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

function isTranscriptDisplayMode(value: unknown): value is TranscriptDisplayMode {
  return value === "plain" || value === "timestamped";
}

function isOutputMode(value: string): value is CodexOutputMode {
  return value === "transcript" || value === "copyPrompt" || value === "codexAnswer";
}

function isSettingsSection(value: string): value is "prompts" | "copy" | "display" {
  return value === "prompts" || value === "copy" || value === "display";
}

function matchesCaptionSource(value: unknown): value is CaptionSource {
  return value === "manual" || value === "automatic" || value === "kanary";
}

function isLikelyYoutubeUrl(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "youtu.be" || host.endsWith(".youtu.be") || host === "youtube.com" || host.endsWith(".youtube.com");
  } catch {
    return false;
  }
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App root was not found.");
createRoot(app).render(<App />);
