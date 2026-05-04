use serde::Serialize;
use serde_json::{json, Value};
use std::{
    env,
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

pub fn append_event(event: &str, details: Value) {
    let _ = append_event_result(event, details);
}

pub fn append_event_result(event: &str, details: Value) -> Result<(), String> {
    let path = debug_log_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("ログディレクトリを作成できませんでした: {error}"))?;
    }

    let entry = DebugLogEntry {
        timestamp_ms: current_timestamp_ms(),
        event,
        details,
    };
    let line = serde_json::to_string(&entry).map_err(|error| format!("ログをJSON化できませんでした: {error}"))?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| format!("ログファイルを開けませんでした: {error}"))?;
    writeln!(file, "{line}").map_err(|error| format!("ログファイルへ書き込めませんでした: {error}"))
}

pub fn debug_log_path() -> Result<PathBuf, String> {
    let home = env::var("HOME").map_err(|_| "HOMEを取得できませんでした。".to_string())?;
    Ok(PathBuf::from(home)
        .join("Library")
        .join("Logs")
        .join("YouTube AI Brief")
        .join("debug.log"))
}

pub fn truncate_for_log(value: &str, max_chars: usize) -> String {
    let mut result = String::new();
    for character in value.chars().take(max_chars) {
        result.push(character);
    }
    if value.chars().count() > max_chars {
        result.push_str("...");
    }
    result
}

pub fn prompt_details(prompt: &str) -> Value {
    json!({
        "promptChars": prompt.chars().count(),
        "promptPreview": truncate_for_log(prompt, 8000)
    })
}

fn current_timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DebugLogEntry<'a> {
    timestamp_ms: u128,
    event: &'a str,
    details: Value,
}
