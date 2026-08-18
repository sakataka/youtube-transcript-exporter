export type CaptionSource = "manual" | "automatic";

export type CaptionOption = {
  language: string;
  name: string;
  source: CaptionSource;
  isAutoCaption: boolean;
};

type VideoChapter = {
  title: string;
  startSeconds: number;
  startLabel: string;
};

export type CaptionListSuccess = {
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

export type TimedTranscriptSegment = {
  startSeconds: number;
  startLabel: string;
  text: string;
};

export type TranscriptSuccess = {
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

export type ApiFailure = {
  error: string;
};

export type CodexJobStartSuccess = {
  jobId: string;
};

export type CodexJobStatus = {
  status: "running" | "completed" | "failed" | "cancelled";
  answer?: string;
  error?: string;
};

export type PromptTemplate = {
  id: string;
  label: string;
  description: string;
  instruction: string;
};

export type PromptSettings = {
  defaultTemplateId: string;
  templates: PromptTemplate[];
};

export type TranscriptDisplayMode = "plain" | "timestamped";

export type AppSettings = {
  uiLanguage: "ja" | "en";
  includeImagePrompt: boolean;
  formatAutomaticTranscript: boolean;
  transcriptDisplayMode: TranscriptDisplayMode;
  completionSoundEnabled: boolean;
};

export type StoredAppSettings = Partial<AppSettings>;

export type CodexQuestionKind = "initial" | "rerun" | "followup" | "selection" | "history";
export type CodexOutputMode = "transcript" | "copyPrompt" | "codexAnswer";

export type CodexAnswerContext = {
  videoId: string;
  title: string;
  url: string;
  language: string;
  source: CaptionSource;
};

export type CodexHistoryEntry = {
  id: string;
  createdAt: string;
  videoId: string;
  title: string;
  url: string;
  language: string;
  source: CaptionSource;
  templateId: string;
  questionKind: CodexQuestionKind;
  questionText: string;
  selectedExcerpt: string;
  answerMarkdown: string;
};

export type PendingCodexRequest = {
  jobId: string;
  token: number;
  prompt: string;
  questionKind: CodexQuestionKind;
  questionText: string;
  selectedExcerpt: string;
  templateId: string;
  answerContext: CodexAnswerContext | null;
};
