mod transcript;

use transcript::{CaptionListResult, CaptionSource, TranscriptError, TranscriptResult};

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

fn format_transcript_error(error: TranscriptError) -> String {
    error.message
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![list_captions, fetch_transcript])
        .run(tauri::generate_context!())
        .expect("failed to run app");
}
