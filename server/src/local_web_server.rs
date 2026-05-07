use crate::{codex_app_server, debug_log, transcript};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use transcript::CaptionSource;
use url::Url;

#[derive(Default)]
struct ServerState {
    codex_jobs: Mutex<HashMap<String, CodexJob>>,
    codex_job_counter: AtomicU64,
}

struct CodexJob {
    status: CodexJobStatus,
    answer: Option<String>,
    error: Option<String>,
    control: codex_app_server::CodexRunControl,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum CodexJobStatus {
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UrlRequest {
    url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FetchTranscriptRequest {
    url: String,
    language: String,
    source: CaptionSource,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartCodexRequest {
    prompt: String,
    generate_image: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexJobRequest {
    job_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FrontendDebugLogEntry {
    event: String,
    details: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppendDebugLogRequest {
    entry: FrontendDebugLogEntry,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StartCodexRequestResult {
    job_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexRequestStatus {
    status: CodexJobStatus,
    answer: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DebugLogReadResult {
    path: String,
    content: String,
}

struct HttpRequest {
    method: String,
    path: String,
    body: Vec<u8>,
}

struct HttpResponse {
    status: u16,
    content_type: &'static str,
    body: Vec<u8>,
}

pub fn run() -> Result<(), String> {
    let host = std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = std::env::var("PORT").unwrap_or_else(|_| "5179".to_string());
    let address = format!("{host}:{port}");
    let dist_dir = resolve_dist_dir()?;
    let listener = TcpListener::bind(&address).map_err(|error| {
        format!("ローカルWebサーバーを起動できませんでした ({address}): {error}")
    })?;
    let state = Arc::new(ServerState::default());

    println!("YouTube AI Brief local web server");
    println!("URL: http://{address}");
    println!("Static files: {}", dist_dir.display());

    for stream in listener.incoming() {
        let Ok(stream) = stream else {
            continue;
        };
        let state = Arc::clone(&state);
        let dist_dir = dist_dir.clone();
        thread::spawn(move || {
            let _ = handle_connection(stream, state, &dist_dir);
        });
    }

    Ok(())
}

fn handle_connection(
    mut stream: TcpStream,
    state: Arc<ServerState>,
    dist_dir: &Path,
) -> Result<(), String> {
    let request = read_request(&mut stream)?;
    let response = if request.path.starts_with("/api/") {
        handle_api_request(request, state)
    } else {
        handle_static_request(&request, dist_dir)
    };
    write_response(&mut stream, response)
}

fn read_request(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    let mut buffer = Vec::new();
    let mut temp = [0_u8; 4096];

    loop {
        let read = stream
            .read(&mut temp)
            .map_err(|error| format!("HTTP requestを読み取れませんでした: {error}"))?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&temp[..read]);
        if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
        if buffer.len() > 1024 * 1024 {
            return Err("HTTP requestが大きすぎます。".to_string());
        }
    }

    let header_end = buffer
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| "HTTP headerを解釈できませんでした。".to_string())?;
    let header_text = String::from_utf8_lossy(&buffer[..header_end]);
    let mut lines = header_text.lines();
    let request_line = lines
        .next()
        .ok_or_else(|| "HTTP request lineがありません。".to_string())?;
    let parts = request_line.split_whitespace().collect::<Vec<_>>();
    if parts.len() < 2 {
        return Err("HTTP request lineを解釈できませんでした。".to_string());
    }
    let method = parts[0].to_string();
    let path = parts[1].split('?').next().unwrap_or("/").to_string();

    let content_length = lines
        .filter_map(|line| line.split_once(':'))
        .find(|(key, _)| key.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, value)| value.trim().parse::<usize>().ok())
        .unwrap_or(0);
    let body_start = header_end + 4;
    while buffer.len() < body_start + content_length {
        let read = stream
            .read(&mut temp)
            .map_err(|error| format!("HTTP bodyを読み取れませんでした: {error}"))?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&temp[..read]);
    }

    Ok(HttpRequest {
        method,
        path,
        body: buffer
            .get(body_start..body_start + content_length)
            .unwrap_or_default()
            .to_vec(),
    })
}

fn handle_api_request(request: HttpRequest, state: Arc<ServerState>) -> HttpResponse {
    if request.method != "POST" {
        return json_error(405, "POSTだけを受け付けます。");
    }

    let result = match request.path.strip_prefix("/api/").unwrap_or_default() {
        "list_captions" => api_list_captions(&request.body),
        "fetch_transcript" => api_fetch_transcript(&request.body),
        "append_debug_log" => api_append_debug_log(&request.body),
        "read_debug_log" => api_read_debug_log(),
        "open_youtube_url" => api_open_youtube_url(&request.body),
        "open_external_url" => api_open_external_url(&request.body),
        "start_codex_request" => api_start_codex_request(&request.body, state),
        "get_codex_request" => api_get_codex_request(&request.body, state),
        "cancel_codex_request" => api_cancel_codex_request(&request.body, state),
        _ => Err("API endpointが見つかりません。".to_string()),
    };

    match result {
        Ok(value) => json_response(200, value),
        Err(error) => json_error(500, &error),
    }
}

fn api_list_captions(body: &[u8]) -> Result<Value, String> {
    let request: UrlRequest = parse_json(body)?;
    let started_at = Instant::now();
    debug_log::append_event("web.list_captions.start", json!({ "url": &request.url }));
    let result =
        block_on_async(transcript::list_captions(&request.url))?.map_err(|error| error.message)?;
    debug_log::append_event(
        "web.list_captions.completed",
        json!({
            "elapsedMs": started_at.elapsed().as_millis(),
            "captionCount": result.captions.len(),
            "videoId": &result.video_id,
            "title": &result.title,
        }),
    );
    serde_json::to_value(result).map_err(|error| error.to_string())
}

fn api_fetch_transcript(body: &[u8]) -> Result<Value, String> {
    let request: FetchTranscriptRequest = parse_json(body)?;
    let started_at = Instant::now();
    debug_log::append_event(
        "web.fetch_transcript.start",
        json!({
            "url": &request.url,
            "language": &request.language,
            "source": &request.source,
        }),
    );
    let result = block_on_async(transcript::fetch_transcript(
        &request.url,
        Some((request.language, request.source)),
    ))?
    .map_err(|error| error.message)?;
    debug_log::append_event(
        "web.fetch_transcript.completed",
        json!({
            "elapsedMs": started_at.elapsed().as_millis(),
            "videoId": &result.video_id,
            "language": &result.language,
            "source": &result.source,
            "textChars": result.text.chars().count(),
            "timedSegments": result.timed_segments.len(),
        }),
    );
    serde_json::to_value(result).map_err(|error| error.to_string())
}

fn api_append_debug_log(body: &[u8]) -> Result<Value, String> {
    let request: AppendDebugLogRequest = parse_json(body)?;
    debug_log::append_event_result(&request.entry.event, request.entry.details)?;
    Ok(json!({}))
}

fn api_read_debug_log() -> Result<Value, String> {
    let path = debug_log::ensure_debug_log_file()?;
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("ログファイルを読み取れませんでした: {error}"))?;
    serde_json::to_value(DebugLogReadResult {
        path: path.to_string_lossy().to_string(),
        content,
    })
    .map_err(|error| error.to_string())
}

fn api_open_youtube_url(body: &[u8]) -> Result<Value, String> {
    let request: UrlRequest = parse_json(body)?;
    validate_youtube_url(&request.url)?;
    Command::new("open")
        .arg(&request.url)
        .spawn()
        .map_err(|_| "YouTubeをブラウザで開けませんでした。".to_string())?;
    Ok(json!({}))
}

fn api_open_external_url(body: &[u8]) -> Result<Value, String> {
    let request: UrlRequest = parse_json(body)?;
    validate_external_url(&request.url)?;
    Command::new("open")
        .arg(&request.url)
        .spawn()
        .map_err(|_| "リンクをブラウザで開けませんでした。".to_string())?;
    Ok(json!({}))
}

fn api_start_codex_request(body: &[u8], state: Arc<ServerState>) -> Result<Value, String> {
    let request: StartCodexRequest = parse_json(body)?;
    if request.prompt.trim().is_empty() {
        return Err("Codexに渡す質問文が空です。".to_string());
    }

    let job_id = create_codex_job_id(&state);
    let control = codex_app_server::CodexRunControl::default();
    {
        let mut jobs = state
            .codex_jobs
            .lock()
            .map_err(|_| "Codexジョブ状態を初期化できませんでした。".to_string())?;
        jobs.insert(
            job_id.clone(),
            CodexJob {
                status: CodexJobStatus::Running,
                answer: None,
                error: None,
                control: control.clone(),
            },
        );
    }

    let state_for_thread = Arc::clone(&state);
    let job_id_for_thread = job_id.clone();
    thread::spawn(move || {
        let started_at = Instant::now();
        let result = codex_app_server::ask_with_control(
            &request.prompt,
            request.generate_image,
            control.clone(),
        );
        let Ok(mut jobs) = state_for_thread.codex_jobs.lock() else {
            return;
        };
        let Some(job) = jobs.get_mut(&job_id_for_thread) else {
            return;
        };

        if control.is_cancelled() || job.status == CodexJobStatus::Cancelled {
            job.status = CodexJobStatus::Cancelled;
            job.error = Some("Codexへの質問をキャンセルしました。".to_string());
            return;
        }

        match result {
            Ok(answer) => {
                job.status = CodexJobStatus::Completed;
                job.answer = Some(answer);
                job.error = None;
            }
            Err(error) => {
                job.status = CodexJobStatus::Failed;
                job.error = Some(error.message);
            }
        }
        debug_log::append_event(
            "web.codex_request.finished",
            json!({
                "jobId": job_id_for_thread,
                "elapsedMs": started_at.elapsed().as_millis(),
                "status": format!("{:?}", job.status),
            }),
        );
    });

    serde_json::to_value(StartCodexRequestResult { job_id }).map_err(|error| error.to_string())
}

fn api_get_codex_request(body: &[u8], state: Arc<ServerState>) -> Result<Value, String> {
    let request: CodexJobRequest = parse_json(body)?;
    let jobs = state
        .codex_jobs
        .lock()
        .map_err(|_| "Codexジョブ状態を読み取れませんでした。".to_string())?;
    let job = jobs
        .get(&request.job_id)
        .ok_or_else(|| "Codexジョブが見つかりません。".to_string())?;
    serde_json::to_value(CodexRequestStatus {
        status: job.status,
        answer: job.answer.clone(),
        error: job.error.clone(),
    })
    .map_err(|error| error.to_string())
}

fn api_cancel_codex_request(body: &[u8], state: Arc<ServerState>) -> Result<Value, String> {
    let request: CodexJobRequest = parse_json(body)?;
    let mut jobs = state
        .codex_jobs
        .lock()
        .map_err(|_| "Codexジョブ状態を更新できませんでした。".to_string())?;
    let job = jobs
        .get_mut(&request.job_id)
        .ok_or_else(|| "Codexジョブが見つかりません。".to_string())?;

    if job.status == CodexJobStatus::Running {
        job.control.cancel();
        job.status = CodexJobStatus::Cancelled;
        job.error = Some("Codexへの質問をキャンセルしました。".to_string());
    }

    serde_json::to_value(CodexRequestStatus {
        status: job.status,
        answer: job.answer.clone(),
        error: job.error.clone(),
    })
    .map_err(|error| error.to_string())
}

fn handle_static_request(request: &HttpRequest, dist_dir: &Path) -> HttpResponse {
    if request.method != "GET" && request.method != "HEAD" {
        return text_response(405, "GETだけを受け付けます。");
    }

    let path = if request.path == "/" {
        dist_dir.join("index.html")
    } else {
        let relative = request.path.trim_start_matches('/');
        if relative.contains("..") {
            return text_response(400, "不正なパスです。");
        }
        dist_dir.join(relative)
    };
    let path = if path.is_file() {
        path
    } else {
        dist_dir.join("index.html")
    };

    match fs::read(&path) {
        Ok(body) => HttpResponse {
            status: 200,
            content_type: content_type_for_path(&path),
            body,
        },
        Err(_) => text_response(404, "ファイルが見つかりません。"),
    }
}

fn parse_json<T: for<'de> Deserialize<'de>>(body: &[u8]) -> Result<T, String> {
    serde_json::from_slice(body).map_err(|error| format!("JSONを解釈できませんでした: {error}"))
}

fn block_on_async<T>(future: impl std::future::Future<Output = T>) -> Result<T, String> {
    tokio::runtime::Runtime::new()
        .map_err(|error| format!("非同期ランタイムを初期化できませんでした: {error}"))
        .map(|runtime| runtime.block_on(future))
}

fn json_response(status: u16, value: Value) -> HttpResponse {
    HttpResponse {
        status,
        content_type: "application/json; charset=utf-8",
        body: serde_json::to_vec(&value).unwrap_or_else(|_| b"{}".to_vec()),
    }
}

fn json_error(status: u16, error: &str) -> HttpResponse {
    json_response(status, json!({ "error": error }))
}

fn text_response(status: u16, text: &str) -> HttpResponse {
    HttpResponse {
        status,
        content_type: "text/plain; charset=utf-8",
        body: text.as_bytes().to_vec(),
    }
}

fn write_response(stream: &mut TcpStream, response: HttpResponse) -> Result<(), String> {
    let status_text = match response.status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Internal Server Error",
    };
    let header = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        response.status,
        status_text,
        response.content_type,
        response.body.len()
    );
    stream
        .write_all(header.as_bytes())
        .and_then(|_| stream.write_all(&response.body))
        .map_err(|error| format!("HTTP responseを書き込めませんでした: {error}"))
}

fn content_type_for_path(path: &Path) -> &'static str {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("ico") => "image/x-icon",
        _ => "application/octet-stream",
    }
}

fn resolve_dist_dir() -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("WEB_DIST_DIR") {
        let path = PathBuf::from(path);
        if path.join("index.html").is_file() {
            return Ok(path);
        }
        return Err(format!(
            "WEB_DIST_DIRにindex.htmlがありません: {}",
            path.display()
        ));
    }

    let cwd = std::env::current_dir().map_err(|error| error.to_string())?;
    for candidate in [cwd.join("dist"), cwd.join("..").join("dist")] {
        if candidate.join("index.html").is_file() {
            return Ok(candidate);
        }
    }

    Err("dist/index.htmlが見つかりません。先に `bun run build` を実行してください。".to_string())
}

fn validate_youtube_url(value: &str) -> Result<(), String> {
    let url = Url::parse(value).map_err(|_| "YouTube URLとして解釈できません。".to_string())?;
    let host = url
        .host_str()
        .unwrap_or_default()
        .trim_start_matches("www.")
        .to_ascii_lowercase();

    if matches!(
        host.as_str(),
        "youtube.com" | "m.youtube.com" | "music.youtube.com" | "youtu.be"
    ) {
        return Ok(());
    }

    Err("YouTube URLだけを開けます。".to_string())
}

fn validate_external_url(value: &str) -> Result<(), String> {
    let url = Url::parse(value).map_err(|_| "URLとして解釈できません。".to_string())?;
    if matches!(url.scheme(), "http" | "https") && url.host_str().is_some() {
        return Ok(());
    }

    Err("httpまたはhttpsのURLだけを開けます。".to_string())
}

fn create_codex_job_id(state: &ServerState) -> String {
    let count = state.codex_job_counter.fetch_add(1, Ordering::SeqCst) + 1;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("codex-{timestamp}-{count}")
}
