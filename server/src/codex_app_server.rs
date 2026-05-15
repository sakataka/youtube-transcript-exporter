use crate::debug_log;
use serde_json::{json, Value};
use std::{
    env,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Instant,
};

#[derive(Debug)]
pub struct CodexAppServerError {
    pub message: String,
}

#[derive(Clone, Default)]
pub struct CodexRunControl {
    child: Arc<Mutex<Option<std::process::Child>>>,
    cancelled: Arc<AtomicBool>,
}

impl CodexRunControl {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        if let Ok(mut child) = self.child.lock() {
            if let Some(child) = child.as_mut() {
                let _ = child.kill();
            }
        }
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
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

#[allow(dead_code)]
pub fn ask(prompt: &str, generate_image: bool) -> Result<String, CodexAppServerError> {
    ask_with_control(prompt, generate_image, CodexRunControl::default())
}

pub fn ask_with_control(
    prompt: &str,
    generate_image: bool,
    control: CodexRunControl,
) -> Result<String, CodexAppServerError> {
    if prompt.trim().is_empty() {
        return Err("Codexに渡す質問文が空です。".to_string().into());
    }

    let codex = find_codex_executable();
    let run_started_at = Instant::now();
    debug_log::append_event(
        "codex_app_server.run.start",
        json!({
            "generateImage": generate_image,
            "prompt": debug_log::prompt_details(prompt),
            "codexPath": codex.to_string_lossy(),
        }),
    );
    let spawn_started_at = Instant::now();
    let mut child = Command::new(&codex)
        .arg("app-server")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "Codex CLIを起動できませんでした。Codex CLIをインストールし、`codex` にPATHが通っているか確認してください。".to_string())?;
    debug_log::append_event(
        "codex_app_server.process.spawned",
        json!({
            "elapsedMs": spawn_started_at.elapsed().as_millis(),
        }),
    );

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

    if let Ok(mut child_slot) = control.child.lock() {
        *child_slot = Some(child);
    }

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
                },
                "capabilities": {
                    "experimentalApi": true
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
    let thread_started_at = Instant::now();
    let thread_id = wait_for_thread_id(&mut reader, &control, &stderr_handle)?;
    debug_log::append_event(
        "codex_app_server.thread.ready",
        json!({
            "elapsedMs": thread_started_at.elapsed().as_millis(),
            "threadId": &thread_id,
        }),
    );
    let first_turn_started_at = Instant::now();
    let first_turn = run_turn(&mut reader, &mut stdin, 2, &thread_id, prompt, &control)?;
    debug_log::append_event(
        "codex_app_server.turn.first.completed",
        json!({
            "elapsedMs": first_turn_started_at.elapsed().as_millis(),
            "textChars": first_turn.text.chars().count(),
            "imageCount": first_turn.images.len(),
        }),
    );
    if control.is_cancelled() {
        cleanup_child(&control);
        let _ = stderr_handle.join();
        return Err("Codexへの質問をキャンセルしました。".to_string().into());
    }
    let mut final_answer = first_turn.text;
    let mut generated_images = first_turn.images;

    if generate_image && !final_answer.trim().is_empty() {
        let image_prompt = build_image_generation_turn_prompt();
        let image_turn_started_at = Instant::now();
        let image_turn = run_turn(
            &mut reader,
            &mut stdin,
            3,
            &thread_id,
            &image_prompt,
            &control,
        )?;
        debug_log::append_event(
            "codex_app_server.turn.image.completed",
            json!({
                "elapsedMs": image_turn_started_at.elapsed().as_millis(),
                "textChars": image_turn.text.chars().count(),
                "imageCount": image_turn.images.len(),
            }),
        );
        if control.is_cancelled() {
            cleanup_child(&control);
            let _ = stderr_handle.join();
            return Err("Codexへの質問をキャンセルしました。".to_string().into());
        }
        generated_images.extend(image_turn.images);
    }

    drop(stdin);

    cleanup_child(&control);
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
        debug_log::append_event(
            "codex_app_server.image.missing",
            json!({
                "elapsedMs": run_started_at.elapsed().as_millis(),
                "finalAnswerChars": final_answer.chars().count(),
            }),
        );
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

    debug_log::append_event(
        "codex_app_server.run.completed",
        json!({
            "elapsedMs": run_started_at.elapsed().as_millis(),
            "answerChars": final_answer.chars().count(),
            "imageCount": generated_images.len(),
        }),
    );
    Ok(final_answer)
}

fn wait_for_thread_id(
    reader: &mut impl BufRead,
    control: &CodexRunControl,
    stderr_handle: &thread::JoinHandle<()>,
) -> Result<String, CodexAppServerError> {
    loop {
        if control.is_cancelled() {
            cleanup_child(control);
            return Err("Codexへの質問をキャンセルしました。".to_string().into());
        }
        let message = match read_message(reader) {
            Ok(message) => message,
            Err(_) if control.is_cancelled() => {
                cleanup_child(control);
                return Err("Codexへの質問をキャンセルしました。".to_string().into());
            }
            Err(error) => return Err(error),
        };
        handle_error_message(&message, control, stderr_handle)?;

        if message.get("id").and_then(Value::as_i64) != Some(1) {
            continue;
        }

        let Some(thread_id) = message
            .pointer("/result/thread/id")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
        else {
            cleanup_child(control);
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
    control: &CodexRunControl,
) -> Result<TurnOutput, CodexAppServerError> {
    let turn_started_at = Instant::now();
    debug_log::append_event(
        "codex_app_server.turn.start",
        json!({
            "requestId": request_id,
            "promptChars": prompt.chars().count(),
        }),
    );
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
        if control.is_cancelled() {
            cleanup_child(control);
            return Err("Codexへの質問をキャンセルしました。".to_string().into());
        }
        line.clear();
        let bytes = reader.read_line(&mut line).map_err(|_| {
            if control.is_cancelled() {
                cleanup_child(control);
                "Codexへの質問をキャンセルしました。".to_string()
            } else {
                "Codex App Serverの応答を読み取れませんでした。".to_string()
            }
        })?;

        if bytes == 0 {
            if control.is_cancelled() {
                cleanup_child(control);
                return Err("Codexへの質問をキャンセルしました。".to_string().into());
            }
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
                let image_markdown = extract_raw_image_generation_markdown(&message);
                debug_log::append_event(
                    "codex_app_server.raw_response_item.completed",
                    json!({
                        "requestId": request_id,
                        "hasImageMarkdown": image_markdown.is_some(),
                    }),
                );
                if let Some(image_markdown) = image_markdown {
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

    debug_log::append_event(
        "codex_app_server.turn.completed",
        json!({
            "requestId": request_id,
            "elapsedMs": turn_started_at.elapsed().as_millis(),
            "textChars": text.chars().count(),
            "imageCount": generated_images.len(),
        }),
    );
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
    control: &CodexRunControl,
    stderr_handle: &thread::JoinHandle<()>,
) -> Result<(), CodexAppServerError> {
    if let Some(error) = message.get("error") {
        let error_message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Codex App Serverでエラーが発生しました。");
        cleanup_child(control);
        let _ = stderr_handle;
        return Err(error_message.to_string().into());
    }

    Ok(())
}

fn cleanup_child(control: &CodexRunControl) {
    if let Ok(mut child_slot) = control.child.lock() {
        if let Some(mut child) = child_slot.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn build_image_generation_turn_prompt() -> String {
    [
        "$imagegen",
        "",
        "上記の文章回答をもとに、動画内容を1枚の日本語インフォグラフィック画像として生成してください。",
        "",
        "要件:",
        "- 文章回答から、動画固有の中心テーマ、話の順番、登場する人物・製品・場所・出来事、重要な主張、根拠、対立軸、結論を読み取ってください。",
        "- 全動画で同じ抽象的な図解にせず、人物中心、製品比較、タイムライン、仕組み図、議論マップ、ニュース解説、学習ノート風など、内容に最も合う表現を選んでください。",
        "- 強調する情報は3〜6個に絞り、中心テーマを大きく、補助情報を短い日本語ラベルで配置してください。",
        "- 単なる装飾画像ではなく、動画の流れと重要ポイントが一目でわかる図解・インフォグラフィックにしてください。",
        "- 動画の温度感に合う色・質感・構図にしてください。字幕や回答から不確かな要素は断定的に描かないでください。",
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
        extract_completed_agent_message, extract_delta, extract_image_generation_markdown,
        extract_raw_image_generation_markdown,
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

    #[test]
    fn extracts_app_server_image_generation_even_when_status_is_generating() {
        let message = json!({
            "method": "item/completed",
            "params": {
                "item": {
                    "type": "imageGeneration",
                    "id": "img_1",
                    "status": "generating",
                    "result": "b".repeat(160),
                    "savedPath": "/Users/example/.codex/generated_images/thread/image.png"
                }
            }
        });

        let markdown = extract_image_generation_markdown(&message).unwrap();
        assert!(markdown.starts_with("![生成画像](data:image/png;base64,"));
    }
}
