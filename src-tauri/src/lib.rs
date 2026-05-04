mod codex_app_server;
mod transcript;

use std::process::Command;
use transcript::{CaptionListResult, CaptionSource, TranscriptError, TranscriptResult};
use url::Url;

#[tauri::command]
async fn list_captions(url: String) -> Result<CaptionListResult, String> {
    transcript::list_captions(&url)
        .await
        .map_err(format_transcript_error)
}

#[tauri::command]
async fn fetch_transcript(
    url: String,
    language: String,
    source: CaptionSource,
) -> Result<TranscriptResult, String> {
    transcript::fetch_transcript(&url, Some((language, source)))
        .await
        .map_err(format_transcript_error)
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

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            list_captions,
            fetch_transcript,
            open_youtube_url,
            ask_codex
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
