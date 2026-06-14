export function getCodexAnswerTextForCopy(markdown: string) {
  return stripMarkdownImages(stripGeneratedImageSection(normalizeCodexAnswerMarkdown(markdown))).trim();
}

export function normalizeCodexAnswerMarkdown(markdown: string) {
  return markdown.replace(/\r\n?/g, "\n").trim();
}

function stripGeneratedImageSection(markdown: string) {
  return markdown
    .replace(/\n{0,2}#{1,6}\s*(?:生成画像|Generated images?)\s*\n[\s\S]*$/i, "")
    .replace(/\n{0,2}>\s*Codex App Serverから完了済みの画像生成結果を取得できませんでした。[\s\S]*$/i, "");
}

function stripMarkdownImages(markdown: string) {
  return markdown
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\n{3,}/g, "\n\n");
}
