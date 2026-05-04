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

#[derive(Default)]
struct TurnOutput {
    text: String,
    images: Vec<String>,
}

pub fn ask(prompt: &str, generate_image: bool) -> Result<String, CodexAppServerError> {
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
    let thread_id = wait_for_thread_id(&mut reader, &mut child, &stderr_handle)?;
    let first_turn = run_turn(&mut reader, &mut stdin, 2, &thread_id, prompt)?;
    let mut final_answer = first_turn.text;
    let mut generated_images = first_turn.images;

    if generate_image && !final_answer.trim().is_empty() {
        let image_prompt = build_image_generation_turn_prompt();
        let image_turn = run_turn(&mut reader, &mut stdin, 3, &thread_id, &image_prompt)?;
        if !image_turn.text.trim().is_empty() {
            final_answer.push_str("\n\n## 画像生成メモ\n\n");
            final_answer.push_str(image_turn.text.trim());
        }
        generated_images.extend(image_turn.images);
    }

    drop(stdin);

    let _ = child.kill();
    let _ = child.wait();
    let _ = stderr_handle.join();

    generated_images.sort();
    generated_images.dedup();
    if !generated_images.is_empty() {
        if !final_answer.is_empty() {
            final_answer.push_str("\n\n");
        }
        final_answer.push_str("## 生成画像\n\n");
        final_answer.push_str(&generated_images.join("\n\n"));
    } else if generate_image {
        final_answer.push_str("\n\n## 生成画像\n\n");
        final_answer
            .push_str("> Codex App Serverから完了済みの画像生成結果を取得できませんでした。");
    }

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

fn wait_for_thread_id(
    reader: &mut impl BufRead,
    child: &mut std::process::Child,
    stderr_handle: &thread::JoinHandle<()>,
) -> Result<String, CodexAppServerError> {
    loop {
        let message = read_message(reader)?;
        handle_error_message(&message, child, stderr_handle)?;

        if message.get("id").and_then(Value::as_i64) != Some(1) {
            continue;
        }

        let Some(thread_id) = message
            .pointer("/result/thread/id")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
        else {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Codex App Serverからthread idを取得できませんでした。"
                .to_string()
                .into());
        };

        return Ok(thread_id);
    }
}

fn run_turn(
    reader: &mut impl BufRead,
    stdin: &mut impl Write,
    request_id: i64,
    thread_id: &str,
    prompt: &str,
) -> Result<TurnOutput, CodexAppServerError> {
    send(
        stdin,
        json!({
            "method": "turn/start",
            "id": request_id,
            "params": {
                "threadId": thread_id,
                "input": [{ "type": "text", "text": prompt }]
            }
        }),
    )?;

    let mut line = String::new();
    let mut answer = String::new();
    let mut completed_answer = String::new();
    let mut generated_images: Vec<String> = Vec::new();

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
            return Err(error_message.to_string().into());
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
                if let Some(image_markdown) = extract_image_generation_markdown(&message) {
                    generated_images.push(image_markdown);
                }
            }
            "rawResponseItem/completed" => {
                if let Some(image_markdown) = extract_raw_image_generation_markdown(&message) {
                    generated_images.push(image_markdown);
                }
            }
            "turn/completed" => {
                break;
            }
            _ => {}
        }
    }

    let text = if answer.trim().is_empty() {
        completed_answer.trim().to_string()
    } else {
        answer.trim().to_string()
    };

    Ok(TurnOutput {
        text,
        images: generated_images,
    })
}

fn read_message(reader: &mut impl BufRead) -> Result<Value, CodexAppServerError> {
    let mut line = String::new();

    loop {
        line.clear();
        let bytes = reader
            .read_line(&mut line)
            .map_err(|_| "Codex App Serverの応答を読み取れませんでした。".to_string())?;

        if bytes == 0 {
            return Err("Codex App Serverが応答を返す前に終了しました。"
                .to_string()
                .into());
        }

        if let Ok(message) = serde_json::from_str::<Value>(line.trim()) {
            return Ok(message);
        }
    }
}

fn handle_error_message(
    message: &Value,
    child: &mut std::process::Child,
    stderr_handle: &thread::JoinHandle<()>,
) -> Result<(), CodexAppServerError> {
    if let Some(error) = message.get("error") {
        let error_message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Codex App Serverでエラーが発生しました。");
        let _ = child.kill();
        let _ = child.wait();
        let _ = stderr_handle;
        return Err(error_message.to_string().into());
    }

    Ok(())
}

fn build_image_generation_turn_prompt() -> String {
    [
        "上記の文章回答をもとに、動画内容を1枚の日本語インフォグラフィック画像として生成してください。",
        "",
        "要件:",
        "- 文章回答の要点、話の流れ、重要な主張や関係性が一目でわかる構成にしてください。",
        "- 日本語の見出しと短いラベルを使ってください。",
        "- 単なる装飾画像ではなく、理解を助ける図解・インフォグラフィックにしてください。",
        "- 画像生成結果そのものを返してください。画像生成ができない場合は、その理由を短く説明してください。"
    ]
    .join("\n")
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

fn extract_image_generation_markdown(message: &Value) -> Option<String> {
    let item = message.pointer("/params/item")?;
    if item.get("type").and_then(Value::as_str) != Some("imageGeneration") {
        return None;
    }

    let status = item
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if status != "completed" {
        return None;
    }

    if let Some(result) = item.get("result").and_then(Value::as_str) {
        if let Some(markdown) = image_result_to_markdown(result) {
            return Some(markdown);
        }
    }

    item.get("savedPath")
        .and_then(Value::as_str)
        .map(|path| format!("生成画像は `{}` に保存されました。", path))
}

fn extract_raw_image_generation_markdown(message: &Value) -> Option<String> {
    let item = message.pointer("/params/item")?;
    if item.get("type").and_then(Value::as_str) != Some("image_generation_call") {
        return None;
    }

    let status = item
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if status != "completed" {
        return None;
    }

    item.get("result")
        .and_then(Value::as_str)
        .and_then(image_result_to_markdown)
}

fn image_result_to_markdown(result: &str) -> Option<String> {
    let trimmed = result.trim();

    if trimmed.is_empty() {
        return None;
    }

    if trimmed.starts_with("data:image/") {
        return Some(format!("![生成画像]({})", trimmed));
    }

    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Some(format!("![生成画像]({})", trimmed));
    }

    if is_likely_base64_image(trimmed) {
        return Some(format!("![生成画像](data:image/png;base64,{})", trimmed));
    }

    None
}

fn is_likely_base64_image(value: &str) -> bool {
    value.len() > 128
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '+' | '/' | '=')
        })
}

#[cfg(test)]
mod tests {
    use super::{
        extract_completed_agent_message, extract_delta, extract_raw_image_generation_markdown,
    };
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

    #[test]
    fn extracts_raw_image_generation_as_markdown_image() {
        let message = json!({
            "method": "rawResponseItem/completed",
            "params": {
                "item": {
                    "type": "image_generation_call",
                    "id": "img_1",
                    "status": "completed",
                    "result": "a".repeat(160)
                }
            }
        });

        let markdown = extract_raw_image_generation_markdown(&message).unwrap();
        assert!(markdown.starts_with("![生成画像](data:image/png;base64,"));
    }
}
