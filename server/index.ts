import { existsSync } from "node:fs";
import { join, normalize } from "node:path";
import { fetchTranscript, TranscriptError } from "./transcript.ts";

const port = Number(Bun.env.PORT || 3000);
const distRoot = join(import.meta.dir, "..", "dist");

const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/api/transcript" && request.method === "POST") {
      return handleTranscript(request);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "APIが見つかりません。" }, 404);
    }

    return serveStatic(url.pathname);
  }
});

console.log(`YouTube Transcript Exporter: http://${server.hostname}:${server.port}`);

async function handleTranscript(request: Request) {
  try {
    const body = (await request.json()) as { url?: unknown };

    if (typeof body.url !== "string") {
      throw new TranscriptError("YouTube URLを入力してください。");
    }

    const transcript = await fetchTranscript(body.url.trim());
    return json(transcript);
  } catch (error) {
    if (error instanceof TranscriptError) {
      return json({ error: error.message }, error.status);
    }

    return json({ error: "予期しないエラーが発生しました。" }, 500);
  }
}

async function serveStatic(pathname: string) {
  if (!existsSync(distRoot)) {
    return new Response(
      "dist が見つかりません。先に `bun run build` を実行するか、`bun run app` で起動してください。",
      {
        status: 503,
        headers: {
          "Content-Type": "text/plain; charset=utf-8"
        }
      }
    );
  }

  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const normalizedPath = normalize(decodeURIComponent(requestedPath)).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = join(distRoot, normalizedPath);

  if (!filePath.startsWith(distRoot)) {
    return new Response("Forbidden", { status: 403 });
  }

  const file = Bun.file(filePath);

  if (await file.exists()) {
    return new Response(file);
  }

  return new Response(Bun.file(join(distRoot, "index.html")));
}

function json(payload: unknown, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "http://127.0.0.1:5173"
    }
  });
}
