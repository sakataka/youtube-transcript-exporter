export function buildTimestampUrl(rawUrl: string, startSeconds: number) {
  if (!rawUrl) {
    return "";
  }

  const seconds = Math.max(0, Math.floor(startSeconds));

  try {
    const url = new URL(rawUrl);
    url.searchParams.set("t", `${seconds}s`);
    return url.toString();
  } catch {
    const separator = rawUrl.includes("?") ? "&" : "?";
    return `${rawUrl}${separator}t=${seconds}s`;
  }
}

export function parseTimestampLabel(label: string) {
  const parts = label.split(":").map((part) => Number(part));
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    return null;
  }

  const [first, second, third] = parts;
  if (parts.length === 2) {
    if (second >= 60) {
      return null;
    }
    return first * 60 + second;
  }

  if (second >= 60 || third >= 60) {
    return null;
  }
  return first * 3600 + second * 60 + third;
}

export function parseJapaneseTimestampLabel(minutes: string, seconds: string | undefined) {
  const parsedMinutes = Number(minutes);
  const parsedSeconds = seconds === undefined ? 0 : Number(seconds);

  if (
    !Number.isInteger(parsedMinutes) ||
    !Number.isInteger(parsedSeconds) ||
    parsedMinutes < 0 ||
    parsedSeconds < 0 ||
    parsedSeconds >= 60
  ) {
    return null;
  }

  return parsedMinutes * 60 + parsedSeconds;
}
