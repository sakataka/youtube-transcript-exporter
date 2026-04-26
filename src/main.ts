import "./style.css";

type TranscriptSuccess = {
  videoId: string;
  language: string;
  title: string;
  text: string;
};

type TranscriptFailure = {
  error: string;
};

type TranscriptResponse = TranscriptSuccess | TranscriptFailure;

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root was not found.");
}

app.innerHTML = `
  <section class="workspace">
    <header class="topbar">
      <div>
        <p class="eyebrow">Local YouTube transcript tool</p>
        <h1>YouTube字幕をテキスト化</h1>
      </div>
      <span class="status-pill" id="runtime-status">ローカル実行</span>
    </header>

    <form class="input-panel" id="transcript-form">
      <label for="youtube-url">YouTube URL</label>
      <div class="url-row">
        <input
          id="youtube-url"
          name="url"
          type="url"
          placeholder="https://www.youtube.com/watch?v=..."
          autocomplete="off"
          required
        />
        <button id="fetch-button" type="submit">取得</button>
      </div>
      <p class="hint">字幕または自動字幕が公開されている動画のみ取得できます。</p>
    </form>

    <section class="result-layout" aria-live="polite">
      <div class="meta-panel">
        <div>
          <span class="label">動画ID</span>
          <strong id="video-id">-</strong>
        </div>
        <div>
          <span class="label">言語</span>
          <strong id="language">-</strong>
        </div>
        <div>
          <span class="label">文字数</span>
          <strong id="char-count">0</strong>
        </div>
        <div class="action-buttons">
          <button id="copy-button" type="button" disabled>コピー</button>
          <button id="download-button" type="button" disabled>TXT保存</button>
        </div>
      </div>

      <div class="output-panel">
        <div class="output-header">
          <h2 id="video-title">トランスクリプト</h2>
          <p id="message">URLを入力して取得してください。</p>
        </div>
        <textarea id="transcript-output" spellcheck="false" readonly></textarea>
      </div>
    </section>
  </section>
`;

const form = document.querySelector<HTMLFormElement>("#transcript-form")!;
const urlInput = document.querySelector<HTMLInputElement>("#youtube-url")!;
const fetchButton = document.querySelector<HTMLButtonElement>("#fetch-button")!;
const copyButton = document.querySelector<HTMLButtonElement>("#copy-button")!;
const downloadButton = document.querySelector<HTMLButtonElement>("#download-button")!;
const output = document.querySelector<HTMLTextAreaElement>("#transcript-output")!;
const message = document.querySelector<HTMLParagraphElement>("#message")!;
const title = document.querySelector<HTMLHeadingElement>("#video-title")!;
const videoId = document.querySelector<HTMLElement>("#video-id")!;
const language = document.querySelector<HTMLElement>("#language")!;
const charCount = document.querySelector<HTMLElement>("#char-count")!;

let latestTranscript: TranscriptSuccess | null = null;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = urlInput.value.trim();

  if (!url) {
    showError("YouTube URLを入力してください。");
    return;
  }

  setLoading(true);
  clearResult();

  try {
    const response = await fetch("/api/transcript", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ url })
    });

    const payload = (await response.json()) as TranscriptResponse;

    if (!response.ok || "error" in payload) {
      showError("error" in payload ? payload.error : "取得に失敗しました。");
      return;
    }

    latestTranscript = payload;
    title.textContent = payload.title || "トランスクリプト";
    videoId.textContent = payload.videoId;
    language.textContent = payload.language;
    output.value = payload.text;
    charCount.textContent = payload.text.length.toLocaleString("ja-JP");
    copyButton.disabled = payload.text.length === 0;
    downloadButton.disabled = payload.text.length === 0;
    message.textContent = "取得しました。コピーまたはTXT保存できます。";
  } catch {
    showError("ローカルAPIに接続できません。`bun run app` で起動しているか確認してください。");
  } finally {
    setLoading(false);
  }
});

copyButton.addEventListener("click", async () => {
  if (!latestTranscript) {
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(latestTranscript.text);
    } else {
      output.focus();
      output.select();
      document.execCommand("copy");
      output.setSelectionRange(0, 0);
    }

    message.classList.remove("error");
    message.textContent = "クリップボードにコピーしました。";
  } catch {
    message.textContent = "クリップボードにコピーできませんでした。本文を選択して手動でコピーしてください。";
    message.classList.add("error");
  }
});

downloadButton.addEventListener("click", () => {
  if (!latestTranscript) {
    return;
  }

  const blob = new Blob([latestTranscript.text], { type: "text/plain;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = `${safeFileName(latestTranscript.title || latestTranscript.videoId)}.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
});

function setLoading(isLoading: boolean) {
  fetchButton.disabled = isLoading;
  fetchButton.textContent = isLoading ? "取得中" : "取得";
  message.textContent = isLoading ? "字幕情報を確認しています。" : message.textContent;
}

function clearResult() {
  latestTranscript = null;
  title.textContent = "トランスクリプト";
  videoId.textContent = "-";
  language.textContent = "-";
  charCount.textContent = "0";
  output.value = "";
  copyButton.disabled = true;
  downloadButton.disabled = true;
  message.classList.remove("error");
}

function showError(text: string) {
  latestTranscript = null;
  message.textContent = text;
  message.classList.add("error");
  output.value = "";
  copyButton.disabled = true;
  downloadButton.disabled = true;
}

function safeFileName(value: string) {
  return value
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "transcript";
}
