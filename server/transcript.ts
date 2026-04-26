export type CaptionTrack = {
  language: string;
  name: string;
  source: "manual" | "automatic";
  url: string;
};

type YtDlpCaption = {
  ext?: string;
  name?: string;
  url?: string;
};

type YtDlpInfo = {
  id?: string;
  title?: string;
  subtitles?: Record<string, YtDlpCaption[]>;
  automatic_captions?: Record<string, YtDlpCaption[]>;
};

export type TranscriptResult = {
  videoId: string;
  title: string;
  language: string;
  source: CaptionTrack["source"];
  text: string;
};

export type CaptionOption = {
  language: string;
  name: string;
  source: CaptionTrack["source"];
  isAutoCaption: boolean;
};

export type CaptionListResult = {
  videoId: string;
  title: string;
  captions: CaptionOption[];
};

export class TranscriptError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "TranscriptError";
    this.status = status;
  }
}

export function parseYouTubeVideoId(input: string) {
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    throw new TranscriptError("YouTube URLとして解釈できません。");
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();

  if (host === "youtu.be") {
    return normalizeVideoId(url.pathname.split("/").filter(Boolean)[0]);
  }

  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") {
      return normalizeVideoId(url.searchParams.get("v"));
    }

    const parts = url.pathname.split("/").filter(Boolean);
    if (["embed", "shorts", "live"].includes(parts[0])) {
      return normalizeVideoId(parts[1]);
    }
  }

  throw new TranscriptError("YouTubeの動画URLを入力してください。");
}

export function chooseCaptionTrack(info: YtDlpInfo): CaptionTrack | null {
  return rankCaptionTracks(info)[0] ?? null;
}

export function rankCaptionTracks(info: YtDlpInfo): CaptionTrack[] {
  const tracks = getSelectableTracks(info);

  if (tracks.length === 0) {
    return [];
  }

  const ranked: CaptionTrack[] = [];
  const add = (track: CaptionTrack | null | undefined) => {
    if (track && !ranked.some((existing) => existing.language === track.language && existing.source === track.source)) {
      ranked.push(track);
    }
  };

  add(findPreferredLanguage(tracks, "ja"));
  add(findPreferredLanguage(tracks, "en"));

  for (const track of tracks.filter((candidate) => !isTranslatedCaption(candidate.language))) {
    add(track);
  }

  for (const track of tracks) {
    add(track);
  }

  return ranked;
}

export function parseVttToPlainText(vtt: string) {
  const lines = vtt.replace(/\r/g, "").split("\n");
  const result: string[] = [];
  let previous = "";
  let skippingBlock = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      skippingBlock = false;
      continue;
    }

    if (/^(WEBVTT|Kind:|Language:)/i.test(line)) {
      continue;
    }

    if (/^(NOTE|STYLE|REGION)(\s|$)/i.test(line)) {
      skippingBlock = true;
      continue;
    }

    if (skippingBlock || line.includes("-->") || /^\d+$/.test(line)) {
      continue;
    }

    const cleaned = decodeEntities(
      line
        .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, "")
        .replace(/<[^>]*>/g, "")
        .replace(/\s+/g, " ")
        .trim()
    );

    if (!cleaned || cleaned === previous) {
      continue;
    }

    result.push(cleaned);
    previous = cleaned;
  }

  return stripTranscriptNotices(result).join("\n").trim();
}

export async function listCaptions(url: string): Promise<CaptionListResult> {
  const videoId = parseYouTubeVideoId(url);
  const info = await getYtDlpInfo(url);
  const tracks = getSelectableTracks(info);

  if (tracks.length === 0) {
    throw new TranscriptError("字幕が見つかりません。");
  }

  return {
    videoId: info.id || videoId,
    title: info.title || videoId,
    captions: tracks.map(({ language, name, source }) => ({
      language,
      name,
      source,
      isAutoCaption: source === "automatic"
    }))
  };
}

export async function fetchTranscript(
  url: string,
  requestedCaption?: Pick<CaptionOption, "language" | "source">
): Promise<TranscriptResult> {
  const videoId = parseYouTubeVideoId(url);
  const info = await getYtDlpInfo(url);
  const tracks = requestedCaption
    ? getSelectableTracks(info).filter(
        (track) => track.language === requestedCaption.language && track.source === requestedCaption.source
      )
    : rankCaptionTracks(info);

  if (tracks.length === 0) {
    throw new TranscriptError(
      requestedCaption ? "選択された字幕が見つかりません。" : "字幕が見つかりません。"
    );
  }

  for (const track of tracks) {
    const response = await fetch(track.url, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    if (!response.ok) {
      continue;
    }

    const text = parseVttToPlainText(await response.text());

    if (!text) {
      continue;
    }

    return {
      videoId: info.id || videoId,
      title: info.title || videoId,
      language: track.language,
      source: track.source,
      text
    };
  }

  throw new TranscriptError("字幕データを取得できませんでした。", 502);
}

function getSelectableTracks(info: YtDlpInfo) {
  const manualTracks = collectTracks(info.subtitles, "manual" as const).filter(
    (track) => !isTranslatedCaption(track.language)
  );
  const manualLanguages = new Set(manualTracks.map((track) => track.language));
  const automaticTracks = collectTracks(info.automatic_captions, "automatic" as const).filter(
    (track) => !isTranslatedCaption(track.language) && !manualLanguages.has(track.language)
  );

  return [...manualTracks, ...automaticTracks];
}

async function getYtDlpInfo(url: string): Promise<YtDlpInfo> {
  const process = Bun.spawn(
    [
      "yt-dlp",
      "--dump-single-json",
      "--skip-download",
      "--write-auto-subs",
      "--write-subs",
      "--sub-langs",
      "all",
      "--sub-format",
      "vtt",
      "--no-warnings",
      url
    ],
    {
      stdout: "pipe",
      stderr: "pipe"
    }
  );

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited
  ]);

  if (exitCode !== 0) {
    throw new TranscriptError(classifyYtDlpError(stderr), 502);
  }

  try {
    return JSON.parse(stdout) as YtDlpInfo;
  } catch {
    throw new TranscriptError("yt-dlpの出力を解析できませんでした。", 502);
  }
}

function collectTracks(
  captions: Record<string, YtDlpCaption[]> | undefined,
  source: CaptionTrack["source"]
) {
  if (!captions) {
    return [];
  }

  const tracks: CaptionTrack[] = [];

  for (const [language, formats] of Object.entries(captions)) {
    const selected = formats.find((format) => format.ext === "vtt" && format.url) ?? formats.find((format) => format.url);

    if (selected?.url) {
      tracks.push({
        language,
        name: selected.name || language,
        source,
        url: selected.url
      });
    }
  }

  return tracks;
}

function findPreferredLanguage(tracks: CaptionTrack[], language: string) {
  return (
    tracks.find((track) => isSameBaseLanguage(track.language, language)) ??
    null
  );
}

function isSameBaseLanguage(value: string, language: string) {
  const normalized = value.toLowerCase();

  if (isTranslatedCaption(normalized)) {
    return false;
  }

  return normalized === language || normalized.startsWith(`${language}-`);
}

function isTranslatedCaption(language: string) {
  const parts = language.toLowerCase().split("-");

  if (parts.length <= 2) {
    return false;
  }

  return parts.at(-2) === "zh" || /^[a-z]{2,3}$/.test(parts.at(-2) ?? "");
}

function normalizeVideoId(value: string | null | undefined) {
  if (!value || !/^[a-zA-Z0-9_-]{11}$/.test(value)) {
    throw new TranscriptError("YouTube動画IDをURLから取得できませんでした。");
  }

  return value;
}

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTranscriptNotices(lines: string[]) {
  return lines.filter((line, index) => {
    if (index > 4) {
      return true;
    }

    return !isTranscriptNotice(line);
  });
}

function isTranscriptNotice(line: string) {
  const normalized = line
    .normalize("NFKC")
    .replace(/[()（）[\].。．]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("translated by ai for reference only") ||
    normalized.includes("ai translated for reference only") ||
    normalized.includes("ai translation for reference only") ||
    normalized.includes("aiによる翻訳") ||
    normalized.includes("ai翻訳") ||
    normalized.includes("参考のみ")
  );
}

function classifyYtDlpError(stderr: string) {
  const lower = stderr.toLowerCase();

  if (lower.includes("unsupported url")) {
    return "YouTubeの動画URLを入力してください。";
  }

  if (lower.includes("private video")) {
    return "非公開動画のため取得できません。";
  }

  if (lower.includes("video unavailable") || lower.includes("this video is unavailable")) {
    return "動画を利用できません。削除、地域制限、または公開制限の可能性があります。";
  }

  if (lower.includes("sign in") || lower.includes("login")) {
    return "ログインが必要な動画のため取得できません。";
  }

  return "字幕情報の取得に失敗しました。";
}
