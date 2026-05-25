import { parseJapaneseTimestampLabel, parseTimestampLabel } from "./timestamp";

type RenderMarkdownOptions = {
  buildTimestampUrl?: (startSeconds: number) => string;
};

export function renderMarkdown(markdown: string, options: RenderMarkdownOptions = {}) {
  const lines = normalizeMarkdownForDisplay(markdown).split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let orderedListItems: string[] = [];
  let blockquote: string[] = [];
  let tableRows: string[][] = [];
  let codeLines: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }

    blocks.push(...renderParagraphBlocks(paragraph.join(" "), options));
    paragraph = [];
  };

  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push(`<ul>${listItems.map((item) => `<li>${renderListItemMarkdown(item, options)}</li>`).join("")}</ul>`);
      listItems = [];
    }

    if (orderedListItems.length > 0) {
      blocks.push(`<ol>${orderedListItems.map((item) => `<li>${renderListItemMarkdown(item, options)}</li>`).join("")}</ol>`);
      orderedListItems = [];
    }
  };

  const flushBlockquote = () => {
    if (blockquote.length === 0) {
      return;
    }

    blocks.push(`<blockquote>${blockquote.map((line) => `<p>${renderInlineMarkdown(line, options)}</p>`).join("")}</blockquote>`);
    blockquote = [];
  };

  const flushTable = () => {
    if (tableRows.length === 0) {
      return;
    }

    blocks.push(renderTableBlock(tableRows, options));
    tableRows = [];
  };

  const flushOpenBlocks = () => {
    flushParagraph();
    flushList();
    flushBlockquote();
    flushTable();
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (codeLines) {
      if (trimmed.startsWith("```")) {
        blocks.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = null;
      } else {
        codeLines.push(rawLine);
      }
      continue;
    }

    if (trimmed.startsWith("```")) {
      flushOpenBlocks();
      codeLines = [];
      continue;
    }

    if (!trimmed) {
      flushOpenBlocks();
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushOpenBlocks();
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2], options)}</h${level}>`);
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      flushOpenBlocks();
      blocks.push("<hr />");
      continue;
    }

    const unordered = trimmed.match(/^(?:[-*]\s+|・\s*)(.+)$/);
    if (unordered) {
      flushParagraph();
      flushBlockquote();
      flushTable();
      orderedListItems = [];
      listItems.push(unordered[1]);
      continue;
    }

    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      flushBlockquote();
      flushTable();
      listItems = [];
      const section = parseNumberedSectionTitle(ordered[1]);
      if (section) {
        flushList();
        blocks.push(`<h2>${renderInlineMarkdown(section.title, options)}</h2>`);
        if (section.rest) {
          blocks.push(`<p>${renderInlineMarkdown(section.rest, options)}</p>`);
        }
      } else {
        orderedListItems.push(ordered[1]);
      }
      continue;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      flushTable();
      blockquote.push(quote[1]);
      continue;
    }

    const tableRow = parseMarkdownTableRow(trimmed);
    if (tableRow) {
      flushParagraph();
      flushList();
      flushBlockquote();
      tableRows.push(tableRow);
      continue;
    }

    flushBlockquote();
    flushTable();
    if (listItems.length > 0) {
      listItems[listItems.length - 1] = `${listItems[listItems.length - 1]}\n${trimmed}`;
      continue;
    }
    if (orderedListItems.length > 0) {
      orderedListItems[orderedListItems.length - 1] = `${orderedListItems[orderedListItems.length - 1]}\n${trimmed}`;
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }

  if (codeLines) {
    blocks.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  flushOpenBlocks();

  return stripStrayLeadingHashParagraphs(blocks).join("");
}

function renderListItemMarkdown(text: string, options: RenderMarkdownOptions) {
  return text
    .split("\n")
    .map((line) => renderInlineMarkdown(line, options))
    .join("<br />");
}

export function normalizeMarkdownForDisplay(markdown: string) {
  return stripStrayLeadingHeadingMarker(markdown.replace(/\r\n?/g, "\n"))
    .replace(/([^\n])\s*(#{1,4}\s+\d+[.)]\s+[^\n]+)/g, "$1\n\n$2")
    .replace(/([^\n])\s+(\d+[.)]\s+(?:\*\*|__)[^\n]+?(?:\*\*|__))/g, "$1\n\n$2");
}

function stripStrayLeadingHeadingMarker(markdown: string) {
  const lines = markdown.split("\n");
  let index = 0;
  let shouldStrip = false;

  while (index < lines.length && isBlankDisplayLine(lines[index])) {
    index += 1;
  }

  while (index < lines.length && isStrayHeadingMarkerLine(lines[index])) {
    shouldStrip = true;
    index += 1;
    while (index < lines.length && isBlankDisplayLine(lines[index])) {
      index += 1;
    }
  }

  return shouldStrip ? lines.slice(index).join("\n") : markdown;
}

function isBlankDisplayLine(line: string) {
  return stripInvisibleCharacters(line).trim() === "";
}

function isStrayHeadingMarkerLine(line: string) {
  return stripInvisibleCharacters(line).trim() === "#";
}

function stripInvisibleCharacters(text: string) {
  return text.replace(/[\p{Cf}\uFE00-\uFE0F]/gu, "");
}

function stripStrayLeadingHashParagraphs(blocks: string[]) {
  let index = 0;
  while (index < blocks.length && isStrayHashParagraph(blocks[index])) {
    index += 1;
  }

  return index > 0 ? blocks.slice(index) : blocks;
}

function isStrayHashParagraph(block: string) {
  const paragraph = block.match(/^<p>([\s\S]*)<\/p>$/);
  if (!paragraph) {
    return false;
  }

  return normalizeHashMarkerText(paragraph[1]) === "#";
}

function normalizeHashMarkerText(text: string) {
  return stripInvisibleCharacters(decodeBasicHtmlEntities(text)).replace(/^\\#$/, "#").trim();
}

function decodeBasicHtmlEntities(text: string) {
  return text
    .replace(/&#35;|&#x23;|&num;/gi, "#")
    .replace(/&nbsp;/gi, " ");
}

function renderParagraphBlocks(text: string, options: RenderMarkdownOptions) {
  if (isSourceNoteLine(text)) {
    return [`<p class="source-note">${renderInlineMarkdown(text, options)}</p>`];
  }

  const numberedSection = text.match(/^(.*?)\s+\d+[.)]\s+(?:\*\*|__)(.+?)(?:\*\*|__)\s*(.*)$/);

  if (!numberedSection) {
    return [`<p>${renderInlineMarkdown(text, options)}</p>`];
  }

  const blocks: string[] = [];
  const before = numberedSection[1].trim();
  const title = numberedSection[2].trim();
  const after = numberedSection[3].trim();

  if (before) {
    blocks.push(`<p>${renderInlineMarkdown(before, options)}</p>`);
  }

  blocks.push(`<h2>${renderInlineMarkdown(title, options)}</h2>`);

  if (after) {
    blocks.push(`<p>${renderInlineMarkdown(after, options)}</p>`);
  }

  return blocks;
}

function isSourceNoteLine(text: string) {
  return /^(出典|Source)\s*[:：]/i.test(text.trim());
}

function parseNumberedSectionTitle(text: string) {
  const boldOnly = text.match(/^(?:\*\*|__)(.+?)(?:\*\*|__)\s*$/);
  if (boldOnly) {
    return { title: boldOnly[1], rest: "" };
  }

  const boldWithRest = text.match(/^(?:\*\*|__)(.+?)(?:\*\*|__)\s*[:：-]?\s+(.+)$/);
  if (boldWithRest) {
    return { title: boldWithRest[1], rest: boldWithRest[2] };
  }

  if (isPlainNumberedSectionTitle(text)) {
    return { title: text.trim(), rest: "" };
  }

  return null;
}

function isPlainNumberedSectionTitle(text: string) {
  const trimmed = text.trim();

  if (!trimmed || trimmed.length > 80) {
    return false;
  }

  if (/[。.!?！？、,;；]$/.test(trimmed)) {
    return false;
  }

  if (/[。.!?！？]\s+/.test(trimmed)) {
    return false;
  }

  return /(?:概要|要点|ポイント|詳細|結論|主張|根拠|背景|注意点|Summary|Overview|Key points?|Details?|Conclusion|Arguments?)/i.test(
    trimmed
  );
}

function parseMarkdownTableRow(text: string) {
  if (!text.includes("|")) {
    return null;
  }

  const trimmed = text.replace(/^\|/, "").replace(/\|$/, "");
  const cells = trimmed.split("|").map((cell) => cell.trim());

  return cells.length >= 2 ? cells : null;
}

function renderTableBlock(rows: string[][], options: RenderMarkdownOptions) {
  if (rows.length < 2 || !isMarkdownTableSeparator(rows[1])) {
    return rows.map((row) => `<p>${renderInlineMarkdown(row.join(" | "), options)}</p>`).join("");
  }

  const header = rows[0];
  const bodyRows = rows.slice(2).filter((row) => row.length > 0);
  const headerHtml = header.map((cell) => `<th>${renderInlineMarkdown(cell, options)}</th>`).join("");
  const bodyHtml = bodyRows
    .map((row) => `<tr>${header.map((_cell, index) => `<td>${renderInlineMarkdown(row[index] ?? "", options)}</td>`).join("")}</tr>`)
    .join("");

  return `<table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
}

function isMarkdownTableSeparator(row: string[]) {
  return row.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function renderInlineMarkdown(text: string, options: RenderMarkdownOptions) {
  const escaped = linkTimestampLabels(escapeHtml(text), options);
  return escaped
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_match, alt: string, url: string) => {
      const safeUrl = sanitizeMarkdownUrl(url);
      if (!safeUrl || (!safeUrl.startsWith("data:image/") && !safeUrl.startsWith("http"))) {
        return escapeHtml(alt);
      }

      return `<img src="${escapeHtml(safeUrl)}" alt="${escapeHtml(alt)}" loading="lazy" />`;
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, url: string) => {
      const recoveredUrl = recoverSplitMarkdownUrl(label, url);
      if (recoveredUrl) {
        return `<a href="${escapeHtml(recoveredUrl)}" target="_blank" rel="noreferrer">${escapeHtml(recoveredUrl)}</a>`;
      }

      const safeUrl = sanitizeMarkdownUrl(url);
      if (!safeUrl) {
        return label;
      }

      return `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer">${label}</a>`;
    })
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(/_([^_\n]+)_/g, "<em>$1</em>")
    .replace(/(^|[\s(])(https?:\/\/[^\s<]+)/gi, (_match, prefix: string, url: string) => {
      const trailing = url.match(/[),.。、]+$/)?.[0] ?? "";
      const linkUrl = trailing ? url.slice(0, -trailing.length) : url;
      const safeUrl = sanitizeMarkdownUrl(linkUrl);

      if (!safeUrl) {
        return `${prefix}${url}`;
      }

      return `${prefix}<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer">${escapeHtml(linkUrl)}</a>${trailing}`;
    });
}

function linkTimestampLabels(text: string, options: RenderMarkdownOptions) {
  if (!options.buildTimestampUrl) {
    return text;
  }

  return text
    .replace(/(^|[\s([（、,，;；/／])(\d{1,2}:\d{2}(?::\d{2})?)(?=([\])）.,。、，;；\s]|[~〜～\-–—]|から|$))/g, (_match, prefix: string, label: string) => {
      const seconds = parseTimestampLabel(label);
      if (seconds === null) {
        return `${prefix}${label}`;
      }

      return `${prefix}${renderTimestampLink(label, seconds, options)}`;
    })
    .replace(/(^|[\s([（、,，;；/／])(\d{1,3})分(?:(\d{1,2})秒)?(?=([\])）.,。、，;；\s]|[~〜～\-–—]|から|$))/g, (_match, prefix: string, minutes: string, seconds: string | undefined) => {
      const totalSeconds = parseJapaneseTimestampLabel(minutes, seconds);
      const label = `${minutes}分${seconds ? `${seconds}秒` : ""}`;
      if (totalSeconds === null) {
        return `${prefix}${label}`;
      }

      return `${prefix}${renderTimestampLink(label, totalSeconds, options)}`;
    });
}

function renderTimestampLink(label: string, seconds: number, options: RenderMarkdownOptions) {
  const url = options.buildTimestampUrl?.(seconds) ?? "";
  if (!url) {
    return label;
  }

  return `<a href="${escapeHtml(url)}" data-timestamp-url="${escapeHtml(url)}">${label}</a>`;
}

function sanitizeMarkdownUrl(value: string) {
  const normalized = value.trim();

  if (/^https?:\/\//i.test(normalized) || /^data:image\/[a-z0-9.+-]+;base64,/i.test(normalized)) {
    return normalized;
  }

  return "";
}

function recoverSplitMarkdownUrl(label: string, url: string) {
  if (!/^https?:\/\//i.test(label) || sanitizeMarkdownUrl(url)) {
    return "";
  }

  const suffix = url.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._~/?#[\]@!$&'()*+,;=%-]*$/.test(suffix)) {
    return "";
  }

  return sanitizeMarkdownUrl(`${label}${suffix}`);
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
