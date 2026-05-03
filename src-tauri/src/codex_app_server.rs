use serde_json::{json, Value};
use std::{
    env,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};

#[derive(Debug)]
pub struct CodexAppServerError {
    pub message: String,
}

impl From<String> for CodexAppServerError {
    fn from(message: String) -> Self {
        Self { message }
    }
}

pub fn ask(prompt: &str) -> Result<String, CodexAppServerError> {
    if prompt.trim().is_empty() {
        return Err("Codexに渡す質問文が空です。".to_string().into());
    }

    let codex = find_codex_executable();
    let mut child = Command::new(&codex)
        .arg("app-server")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "Codex CLIを起動できませんでした。Codex CLIをインストールし、`codex` にPATHが通っているか確認してください。".to_string())?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Codex App Serverのstdinを開けませんでした。".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Codex App Serverのstdoutを開けませんでした。".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Codex App Serverのstderrを開けませんでした。".to_string())?;

    let stderr_buffer = Arc::new(Mutex::new(String::new()));
    let stderr_for_thread = Arc::clone(&stderr_buffer);
    let stderr_handle = thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            if let Ok(mut buffer) = stderr_for_thread.lock() {
                if buffer.len() < 4000 {
                    buffer.push_str(&line);
                    buffer.push('\n');
                }
            }
        }
    });

    send(
        &mut stdin,
        json!({
            "method": "initialize",
            "id": 0,
            "params": {
                "clientInfo": {
                    "name": "youtube_ai_brief",
                    "title": "YouTube AI Brief",
                    "version": env!("CARGO_PKG_VERSION")
                }
            }
        }),
    )?;
    send(&mut stdin, json!({ "method": "initialized", "params": {} }))?;
    send(
        &mut stdin,
        json!({ "method": "thread/start", "id": 1, "params": {} }),
    )?;

    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    let mut answer = String::new();
    let mut completed_answer = String::new();
    let mut turn_started = false;

    loop {
        line.clear();
        let bytes = reader
            .read_line(&mut line)
            .map_err(|_| "Codex App Serverの応答を読み取れませんでした。".to_string())?;

        if bytes == 0 {
            break;
        }

        let Ok(message) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };

        if let Some(error) = message.get("error") {
            let error_message = error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Codex App Serverでエラーが発生しました。");
            let _ = child.kill();
            let _ = child.wait();
            let _ = stderr_handle.join();
            return Err(error_message.to_string().into());
        }

        if message.get("id").and_then(Value::as_i64) == Some(1) {
            let thread_id = message
                .pointer("/result/thread/id")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);

            let Some(thread_id) = thread_id.as_deref() else {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stderr_handle.join();
                return Err("Codex App Serverからthread idを取得できませんでした。"
                    .to_string()
                    .into());
            };

            send(
                &mut stdin,
                json!({
                    "method": "turn/start",
                    "id": 2,
                    "params": {
                        "threadId": thread_id,
                        "input": [{ "type": "text", "text": prompt }]
                    }
                }),
            )?;
            turn_started = true;
            continue;
        }

        if message.get("id").and_then(Value::as_i64) == Some(2) {
            continue;
        }

        let method = message
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default();

        match method {
            "item/agentMessage/delta" => {
                if let Some(delta) = extract_delta(&message) {
                    answer.push_str(delta);
                }
            }
            "item/completed" => {
                if answer.is_empty() {
                    if let Some(text) = extract_completed_agent_message(&message) {
                        completed_answer.push_str(text);
                    }
                }
            }
            "turn/completed" => {
                break;
            }
            _ => {}
        }
    }

    drop(stdin);

    if turn_started {
        let _ = child.kill();
    }
    let _ = child.wait();
    let _ = stderr_handle.join();

    let final_answer = if answer.trim().is_empty() {
        completed_answer.trim().to_string()
    } else {
        answer.trim().to_string()
    };

    if final_answer.is_empty() {
        let stderr_text = stderr_buffer
            .lock()
            .map(|buffer| buffer.trim().to_string())
            .unwrap_or_default();
        let suffix = if stderr_text.is_empty() {
            "".to_string()
        } else {
            format!("\n\nCodex stderr:\n{}", stderr_text)
        };
        return Err(format!("Codexから回答を取得できませんでした。{}", suffix).into());
    }

    Ok(final_answer)
}

fn send(stdin: &mut impl Write, message: Value) -> Result<(), CodexAppServerError> {
    serde_json::to_writer(&mut *stdin, &message)
        .map_err(|_| "Codex App Serverへのメッセージ作成に失敗しました。".to_string())?;
    stdin
        .write_all(b"\n")
        .map_err(|_| "Codex App Serverへ送信できませんでした。".to_string())?;
    stdin
        .flush()
        .map_err(|_| "Codex App Serverへの送信を完了できませんでした。".to_string())?;
    Ok(())
}

fn find_codex_executable() -> PathBuf {
    if let Some(path) = find_executable_in_path("codex") {
        return path;
    }

    ["/opt/homebrew/bin/codex", "/usr/local/bin/codex"]
        .iter()
        .map(PathBuf::from)
        .find(|path| path.is_file())
        .unwrap_or_else(|| PathBuf::from("codex"))
}

fn find_executable_in_path(name: &str) -> Option<PathBuf> {
    let path = env::var_os("PATH")?;

    env::split_paths(&path)
        .map(|directory| directory.join(name))
        .find(|candidate| candidate.is_file())
}

fn extract_delta(message: &Value) -> Option<&str> {
    message
        .pointer("/params/delta")
        .or_else(|| message.pointer("/params/textDelta"))
        .or_else(|| message.pointer("/params/contentDelta"))
        .or_else(|| message.pointer("/params/text"))
        .and_then(Value::as_str)
}

fn extract_completed_agent_message(message: &Value) -> Option<&str> {
    let item = message.pointer("/params/item")?;
    if item.get("type").and_then(Value::as_str) != Some("agent_message") {
        return None;
    }

    item.pointer("/text")
        .or_else(|| item.pointer("/message"))
        .or_else(|| item.pointer("/content/0/text"))
        .and_then(Value::as_str)
}

#[cfg(test)]
mod tests {
    use super::{extract_completed_agent_message, extract_delta};
    use serde_json::json;

    #[test]
    fn extracts_agent_message_delta() {
        let message = json!({
            "method": "item/agentMessage/delta",
            "params": { "delta": "回答" }
        });

        assert_eq!(extract_delta(&message), Some("回答"));
    }

    #[test]
    fn extracts_completed_agent_message_fallback() {
        let message = json!({
            "method": "item/completed",
            "params": {
                "item": {
                    "type": "agent_message",
                    "text": "完了した回答"
                }
            }
        });

        assert_eq!(
            extract_completed_agent_message(&message),
            Some("完了した回答")
        );
    }
}
