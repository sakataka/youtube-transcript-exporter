mod codex_app_server;
mod debug_log;
mod transcript;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    process::Command,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use transcript::{CaptionListResult, CaptionSource, TranscriptError, TranscriptResult};
use url::Url;

#[derive(Default)]
struct AppState {
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FrontendDebugLogEntry {
    event: String,
    details: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DebugLogReadResult {
    path: String,
    content: String,
}

#[tauri::command]
async fn list_captions(url: String) -> Result<CaptionListResult, String> {
    let started_at = Instant::now();
    debug_log::append_event(
        "tauri.list_captions.start",
        json!({
            "url": &url,
        }),
    );
    transcript::list_captions(&url)
        .await
        .inspect(|result| {
            debug_log::append_event(
                "tauri.list_captions.completed",
                json!({
                    "elapsedMs": started_at.elapsed().as_millis(),
                    "captionCount": result.captions.len(),
                    "videoId": &result.video_id,
                    "title": &result.title,
                }),
            );
        })
        .map_err(|error| {
            let message = format_transcript_error(error);
            debug_log::append_event(
                "tauri.list_captions.failed",
                json!({
                    "elapsedMs": started_at.elapsed().as_millis(),
                    "error": message,
                }),
            );
            message
        })
}

#[tauri::command]
async fn fetch_transcript(
    url: String,
    language: String,
    source: CaptionSource,
) -> Result<TranscriptResult, String> {
    let started_at = Instant::now();
    debug_log::append_event(
        "tauri.fetch_transcript.start",
        json!({
            "url": &url,
            "language": &language,
            "source": &source,
        }),
    );
    transcript::fetch_transcript(&url, Some((language, source)))
        .await
        .inspect(|result| {
            debug_log::append_event(
                "tauri.fetch_transcript.completed",
                json!({
                    "elapsedMs": started_at.elapsed().as_millis(),
                    "videoId": &result.video_id,
                    "language": &result.language,
                    "source": &result.source,
                    "textChars": result.text.chars().count(),
                    "timedSegments": result.timed_segments.len(),
                }),
            );
        })
        .map_err(|error| {
            let message = format_transcript_error(error);
            debug_log::append_event(
                "tauri.fetch_transcript.failed",
                json!({
                    "elapsedMs": started_at.elapsed().as_millis(),
                    "error": message,
                }),
            );
            message
        })
}

#[tauri::command]
fn open_youtube_url(url: String) -> Result<(), String> {
    validate_youtube_url(&url)?;
    Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|_| "YouTubeをブラウザで開けませんでした。".to_string())?;
    Ok(())
}

#[tauri::command]
async fn ask_codex(prompt: String, generate_image: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || codex_app_server::ask(&prompt, generate_image))
        .await
        .map_err(|_| "Codexの実行タスクが中断されました。".to_string())?
        .map_err(|error| error.message)
}

#[tauri::command]
fn start_codex_request(
    prompt: String,
    generate_image: bool,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<StartCodexRequestResult, String> {
    if prompt.trim().is_empty() {
        return Err("Codexに渡す質問文が空です。".to_string());
    }

    let job_id = create_codex_job_id(&state);
    debug_log::append_event(
        "tauri.codex_request.start",
        json!({
            "jobId": &job_id,
            "generateImage": generate_image,
            "prompt": debug_log::prompt_details(&prompt),
        }),
    );
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
        let result = codex_app_server::ask_with_control(&prompt, generate_image, control.clone());
        let Ok(mut jobs) = state_for_thread.codex_jobs.lock() else {
            return;
        };
        let Some(job) = jobs.get_mut(&job_id_for_thread) else {
            return;
        };

        if control.is_cancelled() || job.status == CodexJobStatus::Cancelled {
            job.status = CodexJobStatus::Cancelled;
            job.error = Some("Codexへの質問をキャンセルしました。".to_string());
            debug_log::append_event(
                "tauri.codex_request.cancelled",
                json!({
                    "jobId": job_id_for_thread,
                    "elapsedMs": started_at.elapsed().as_millis(),
                }),
            );
            return;
        }

        match result {
            Ok(answer) => {
                job.status = CodexJobStatus::Completed;
                job.answer = Some(answer);
                job.error = None;
                debug_log::append_event(
                    "tauri.codex_request.completed",
                    json!({
                        "jobId": job_id_for_thread,
                        "elapsedMs": started_at.elapsed().as_millis(),
                        "answerChars": job.answer.as_ref().map(|value| value.chars().count()).unwrap_or_default(),
                    }),
                );
            }
            Err(error) => {
                job.status = CodexJobStatus::Failed;
                job.error = Some(error.message);
                debug_log::append_event(
                    "tauri.codex_request.failed",
                    json!({
                        "jobId": job_id_for_thread,
                        "elapsedMs": started_at.elapsed().as_millis(),
                        "error": &job.error,
                    }),
                );
            }
        }
    });

    Ok(StartCodexRequestResult { job_id })
}

#[tauri::command]
fn append_debug_log(entry: FrontendDebugLogEntry) -> Result<(), String> {
    debug_log::append_event_result(&entry.event, entry.details)
}

#[tauri::command]
fn get_debug_log_path() -> Result<String, String> {
    Ok(debug_log::debug_log_path()?.to_string_lossy().to_string())
}

#[tauri::command]
fn read_debug_log() -> Result<DebugLogReadResult, String> {
    let path = debug_log::ensure_debug_log_file()?;
    let content = std::fs::read_to_string(&path).map_err(|error| format!("ログファイルを読み取れませんでした: {error}"))?;
    Ok(DebugLogReadResult {
        path: path.to_string_lossy().to_string(),
        content,
    })
}

#[tauri::command]
fn open_debug_log() -> Result<(), String> {
    let path = debug_log::ensure_debug_log_file()?;
    Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|_| "ログファイルを開けませんでした。".to_string())?;
    Ok(())
}

#[tauri::command]
fn get_codex_request(
    job_id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<CodexRequestStatus, String> {
    let jobs = state
        .codex_jobs
        .lock()
        .map_err(|_| "Codexジョブ状態を読み取れませんでした。".to_string())?;
    let job = jobs
        .get(&job_id)
        .ok_or_else(|| "Codexジョブが見つかりません。".to_string())?;

    Ok(CodexRequestStatus {
        status: job.status,
        answer: job.answer.clone(),
        error: job.error.clone(),
    })
}

#[tauri::command]
fn cancel_codex_request(
    job_id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<CodexRequestStatus, String> {
    let mut jobs = state
        .codex_jobs
        .lock()
        .map_err(|_| "Codexジョブ状態を更新できませんでした。".to_string())?;
    let job = jobs
        .get_mut(&job_id)
        .ok_or_else(|| "Codexジョブが見つかりません。".to_string())?;

    if job.status == CodexJobStatus::Running {
        job.control.cancel();
        job.status = CodexJobStatus::Cancelled;
        job.error = Some("Codexへの質問をキャンセルしました。".to_string());
    }

    Ok(CodexRequestStatus {
        status: job.status,
        answer: job.answer.clone(),
        error: job.error.clone(),
    })
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

fn format_transcript_error(error: TranscriptError) -> String {
    error.message
}

fn create_codex_job_id(state: &AppState) -> String {
    let count = state.codex_job_counter.fetch_add(1, Ordering::SeqCst) + 1;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("codex-{timestamp}-{count}")
}

pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(AppState::default()))
        .invoke_handler(tauri::generate_handler![
            list_captions,
            fetch_transcript,
            open_youtube_url,
            ask_codex,
            start_codex_request,
            get_codex_request,
            cancel_codex_request,
            append_debug_log,
            get_debug_log_path,
            read_debug_log,
            open_debug_log
        ])
        .run(tauri::generate_context!())
        .expect("failed to run app");
}

#[cfg(test)]
mod tests {
    use super::validate_youtube_url;

    #[test]
    fn accepts_youtube_timestamp_urls() {
        assert!(validate_youtube_url("https://www.youtube.com/watch?v=abc&t=42s").is_ok());
        assert!(validate_youtube_url("https://youtu.be/abc?t=42s").is_ok());
    }

    #[test]
    fn rejects_non_youtube_urls() {
        assert!(validate_youtube_url("https://example.com/watch?v=abc&t=42s").is_err());
    }
}
