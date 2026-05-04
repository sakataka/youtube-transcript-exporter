import type { AppSettings, TimedTranscriptSegment, TranscriptSuccess } from "./types";

type NormalizedTranscriptSegment = TimedTranscriptSegment;

export function getTranscriptTextForDisplay(transcript: TranscriptSuccess, settings: AppSettings) {
  if (settings.transcriptDisplayMode === "timestamped") {
    const timestampedText = buildTimestampedTranscriptText(transcript, settings);

    if (timestampedText) {
      return timestampedText;
    }
  }

  return getPlainTranscriptText(transcript, settings);
}

export function getPlainTranscriptText(transcript: TranscriptSuccess, settings: AppSettings) {
  if (transcript.source !== "automatic" || !settings.formatAutomaticTranscript) {
    return transcript.text;
  }

  const formatted = formatAutomaticTranscriptText(transcript, settings);
  return formatted || transcript.text;
}

export function buildTimestampedTranscriptText(transcript: TranscriptSuccess, settings: AppSettings) {
  const segments = getSearchableSegments(transcript, settings);

  if (segments.length === 0) {
    return "";
  }

  return segments.map((segment) => `${segment.startLabel} ${segment.text}`).join("\n");
}

export function formatAutomaticTranscriptText(transcript: TranscriptSuccess, settings: AppSettings) {
  const segments = getDisplaySegments(transcript, settings);

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

export function formatTranscriptParagraphs(text: string) {
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

export function normalizeTranscriptSegment(text: string) {
  return removeUnnaturalJapaneseSpaces(text.replace(/\s+/g, " ").trim());
}

export function removeUnnaturalJapaneseSpaces(text: string) {
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

export function splitTranscriptSentences(text: string) {
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

export function isSentenceBoundary(text: string, index: number) {
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

export function joinTranscriptParts(parts: string[]) {
  return parts.reduce((joined, part) => {
    if (!joined) {
      return part;
    }

    return shouldJoinWithoutSpace(joined, part) ? `${joined}${part}` : `${joined} ${part}`;
  }, "");
}

export function shouldJoinWithoutSpace(left: string, right: string) {
  return (
    /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]$/u.test(left) ||
    /^[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}、。！？]/u.test(right)
  );
}

export function endsSentence(text: string) {
  return /[。！？.!?]$/.test(text);
}

export function getSearchableSegments(transcript: TranscriptSuccess, settings: AppSettings) {
  return getDisplaySegments(transcript, settings);
}

export function getDisplaySegments(transcript: TranscriptSuccess, settings: AppSettings) {
  const segments = (transcript.timedSegments ?? [])
    .map((segment) => ({
      ...segment,
      text: normalizeTranscriptSegment(segment.text)
    }))
    .filter((segment) => segment.text.length > 0);

  if (transcript.source !== "automatic" || !settings.formatAutomaticTranscript) {
    return segments;
  }

  return removeRollingCaptionOverlaps(segments);
}

export function removeRollingCaptionOverlaps(segments: NormalizedTranscriptSegment[]) {
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

export function normalizeForOverlap(text: string) {
  return normalizeTranscriptSegment(text).toLocaleLowerCase();
}

export function findRollingOverlapLength(previousText: string, currentText: string) {
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
