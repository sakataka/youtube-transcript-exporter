use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    process::{Command, ExitStatus, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use url::Url;

const YTDLP_TIMEOUT: Duration = Duration::from_secs(45);
const CAPTION_FETCH_TIMEOUT: Duration = Duration::from_secs(25);
const KANARY_TIMEOUT: Duration = Duration::from_secs(60 * 30);
static TEMP_OUTPUT_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CaptionSource {
    Manual,
    Automatic,
    Kanary,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CaptionTrack {
    pub language: String,
    pub name: String,
    pub source: CaptionSource,
    pub url: String,
}

#[derive(Debug, Deserialize)]
struct YtDlpCaption {
    ext: Option<String>,
    name: Option<String>,
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct YtDlpInfo {
    id: Option<String>,
    title: Option<String>,
    channel: Option<String>,
    description: Option<String>,
    thumbnail: Option<String>,
    webpage_url: Option<String>,
    view_count: Option<u64>,
    upload_date: Option<String>,
    release_date: Option<String>,
    language: Option<String>,
    duration: Option<f64>,
    chapters: Option<Vec<YtDlpChapter>>,
    subtitles: Option<serde_json::Map<String, serde_json::Value>>,
    automatic_captions: Option<serde_json::Map<String, serde_json::Value>>,
}

#[derive(Clone, Debug, Deserialize)]
struct YtDlpChapter {
    title: Option<String>,
    start_time: Option<f64>,
}

struct VideoMetadata {
    video_id: String,
    title: String,
    channel_name: Option<String>,
    description: Option<String>,
    thumbnail_url: Option<String>,
    webpage_url: Option<String>,
    view_count: Option<u64>,
    published_date: Option<String>,
    duration: Option<String>,
    chapters: Vec<VideoChapter>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptResult {
    pub video_id: String,
    pub title: String,
    pub channel_name: Option<String>,
    pub description: Option<String>,
    pub thumbnail_url: Option<String>,
    pub webpage_url: Option<String>,
    pub source_path: Option<String>,
    pub view_count: Option<u64>,
    pub published_date: Option<String>,
    pub duration: Option<String>,
    pub chapters: Vec<VideoChapter>,
    pub language: String,
    pub source: CaptionSource,
    pub text: String,
    pub timed_segments: Vec<TimedTranscriptSegment>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimedTranscriptSegment {
    pub start_seconds: u64,
    pub start_label: String,
    pub text: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoChapter {
    pub title: String,
    pub start_seconds: u64,
    pub start_label: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionOption {
    pub language: String,
    pub name: String,
    pub source: CaptionSource,
    pub is_auto_caption: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionListResult {
    pub video_id: String,
    pub title: String,
    pub channel_name: Option<String>,
    pub description: Option<String>,
    pub thumbnail_url: Option<String>,
    pub webpage_url: Option<String>,
    pub source_path: Option<String>,
    pub view_count: Option<u64>,
    pub published_date: Option<String>,
    pub duration: Option<String>,
    pub chapters: Vec<VideoChapter>,
    pub captions: Vec<CaptionOption>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TranscriptError {
    pub message: String,
    pub status: u16,
}

impl TranscriptError {
    fn new(message: impl Into<String>, status: u16) -> Self {
        Self {
            message: message.into(),
            status,
        }
    }

    fn bad_request(message: impl Into<String>) -> Self {
        Self::new(message, 400)
    }
}

pub async fn list_captions(url: &str) -> Result<CaptionListResult, TranscriptError> {
    let video_id = parse_youtube_video_id(url)?;
    let info = get_ytdlp_info(url).await?;
    let tracks = rank_caption_tracks(&info);

    if tracks.is_empty() {
        return Err(TranscriptError::bad_request("字幕が見つかりません。"));
    }

    let metadata = build_video_metadata(&info, video_id);

    Ok(CaptionListResult {
        video_id: metadata.video_id,
        title: metadata.title,
        channel_name: metadata.channel_name,
        description: metadata.description,
        thumbnail_url: metadata.thumbnail_url,
        webpage_url: metadata.webpage_url,
        source_path: None,
        view_count: metadata.view_count,
        published_date: metadata.published_date,
        duration: metadata.duration,
        chapters: metadata.chapters,
        captions: tracks
            .into_iter()
            .map(|track| CaptionOption {
                language: track.language,
                name: track.name,
                is_auto_caption: track.source == CaptionSource::Automatic,
                source: track.source,
            })
            .collect(),
    })
}

pub async fn fetch_transcript(
    url: &str,
    requested_caption: Option<(String, CaptionSource)>,
) -> Result<TranscriptResult, TranscriptError> {
    let video_id = parse_youtube_video_id(url)?;
    let info = get_ytdlp_info(url).await?;
    let tracks = if let Some((language, source)) = requested_caption {
        get_requested_tracks(&info, &language, source)
    } else {
        rank_caption_tracks(&info)
    };

    if tracks.is_empty() {
        return Err(TranscriptError::bad_request(
            "選択された字幕が見つかりません。",
        ));
    }

    let client = reqwest::Client::builder()
        .timeout(CAPTION_FETCH_TIMEOUT)
        .build()
        .map_err(|_| TranscriptError::new("字幕取得クライアントを初期化できませんでした。", 502))?;

    for track in tracks {
        let response = client
            .get(&track.url)
            .header("User-Agent", "Mozilla/5.0")
            .send()
            .await;

        let Ok(response) = response else {
            continue;
        };

        if !response.status().is_success() {
            continue;
        }

        let Ok(body) = response.text().await else {
            continue;
        };
        let timed_segments = parse_vtt_to_timed_segments(&body);
        let text = timed_segments
            .iter()
            .map(|segment| segment.text.as_str())
            .collect::<Vec<_>>()
            .join("\n")
            .trim()
            .to_string();

        if text.is_empty() {
            continue;
        }

        let metadata = build_video_metadata(&info, video_id);

        return Ok(TranscriptResult {
            video_id: metadata.video_id,
            title: metadata.title,
            channel_name: metadata.channel_name,
            description: metadata.description,
            thumbnail_url: metadata.thumbnail_url,
            webpage_url: metadata.webpage_url,
            source_path: None,
            view_count: metadata.view_count,
            published_date: metadata.published_date,
            duration: metadata.duration,
            chapters: metadata.chapters,
            language: track.language,
            source: track.source,
            text,
            timed_segments,
        });
    }

    Err(TranscriptError::new(
        "字幕データを取得できませんでした。",
        502,
    ))
}

pub async fn transcribe_media(path: &str) -> Result<TranscriptResult, TranscriptError> {
    let media_path = normalize_media_path(path)?;
    let kanary = find_kanary_path().ok_or_else(|| {
        TranscriptError::new(
            "kanaryが見つかりません。Kanary 2.3.6以降をインストールしてから、アプリを再起動してください。",
            502,
        )
    })?;
    let output = run_command_with_timeout(
        Command::new(kanary)
            .arg("transcribe")
            .arg(media_path.as_os_str()),
        KANARY_TIMEOUT,
        "kanary",
        CommandFailureMessages {
            create_output: "Kanaryの一時出力を作成できませんでした。",
            spawn: "Kanaryを実行できませんでした。",
            timeout: "Kanaryの文字起こしがタイムアウトしました。",
            wait: "Kanaryの終了状態を確認できませんでした。",
        },
    )?;

    if !output.status.success() {
        return Err(TranscriptError::new(
            classify_kanary_error(&String::from_utf8_lossy(&output.stderr)),
            502,
        ));
    }

    let text = parse_kanary_transcribe_text(&output.stdout);
    if text.is_empty() {
        return Err(TranscriptError::new(
            "Kanaryの文字起こし結果が空でした。",
            502,
        ));
    }

    Ok(build_media_transcript_result(&media_path, text))
}

fn build_media_transcript_result(media_path: &Path, text: String) -> TranscriptResult {
    let title = media_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("local media")
        .to_string();
    let video_id = media_path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("local-media")
        .to_string();

    TranscriptResult {
        video_id,
        title,
        channel_name: None,
        description: None,
        thumbnail_url: None,
        webpage_url: None,
        source_path: Some(media_path.display().to_string()),
        view_count: None,
        published_date: None,
        duration: None,
        chapters: Vec::new(),
        language: "auto".to_string(),
        source: CaptionSource::Kanary,
        text,
        timed_segments: Vec::new(),
    }
}

fn build_video_metadata(info: &YtDlpInfo, fallback_video_id: String) -> VideoMetadata {
    VideoMetadata {
        video_id: info.id.clone().unwrap_or(fallback_video_id),
        title: info
            .title
            .clone()
            .unwrap_or_else(|| info.id.clone().unwrap_or_default()),
        channel_name: info.channel.clone(),
        description: normalize_optional_text(info.description.clone()),
        thumbnail_url: normalize_optional_text(info.thumbnail.clone()),
        webpage_url: normalize_optional_text(info.webpage_url.clone()),
        view_count: info.view_count,
        published_date: format_youtube_date(
            info.release_date.as_ref().or(info.upload_date.as_ref()),
        ),
        duration: format_duration(info.duration),
        chapters: build_video_chapters(info.chapters.as_deref()),
    }
}

fn parse_youtube_video_id(input: &str) -> Result<String, TranscriptError> {
    let url = Url::parse(input)
        .map_err(|_| TranscriptError::bad_request("YouTube URLとして解釈できません。"))?;
    let host = url
        .host_str()
        .unwrap_or_default()
        .trim_start_matches("www.")
        .to_ascii_lowercase();

    if host == "youtu.be" {
        return normalize_video_id(url.path_segments().and_then(|mut parts| parts.next()));
    }

    if matches!(
        host.as_str(),
        "youtube.com" | "m.youtube.com" | "music.youtube.com"
    ) {
        if url.path() == "/watch" {
            let video_id = url
                .query_pairs()
                .find(|(key, _)| key == "v")
                .map(|(_, value)| value.into_owned());
            return normalize_video_id(video_id.as_deref());
        }

        let parts = url
            .path_segments()
            .map(|parts| parts.collect::<Vec<_>>())
            .unwrap_or_default();
        if matches!(parts.first().copied(), Some("embed" | "shorts" | "live")) {
            return normalize_video_id(parts.get(1).copied());
        }
    }

    Err(TranscriptError::bad_request(
        "YouTubeの動画URLを入力してください。",
    ))
}

#[cfg(test)]
fn choose_caption_track(info: &YtDlpInfo) -> Option<CaptionTrack> {
    rank_caption_tracks(info).into_iter().next()
}

fn rank_caption_tracks(info: &YtDlpInfo) -> Vec<CaptionTrack> {
    let tracks = get_selectable_tracks(info);

    if tracks.is_empty() {
        return Vec::new();
    }

    let mut ranked: Vec<CaptionTrack> = Vec::new();
    add_unique(
        &mut ranked,
        info.language
            .as_deref()
            .and_then(|language| find_preferred_language(&tracks, language)),
    );
    add_unique(&mut ranked, find_preferred_language(&tracks, "ja"));
    add_unique(&mut ranked, find_preferred_language(&tracks, "en"));

    for track in tracks
        .iter()
        .filter(|track| !is_translated_caption(&track.language))
    {
        add_unique(&mut ranked, Some(track.clone()));
    }

    for track in tracks {
        add_unique(&mut ranked, Some(track));
    }

    ranked
}

#[cfg(test)]
fn parse_vtt_to_plain_text(vtt: &str) -> String {
    parse_vtt_to_timed_segments(vtt)
        .iter()
        .map(|segment| segment.text.as_str())
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn parse_vtt_to_timed_segments(vtt: &str) -> Vec<TimedTranscriptSegment> {
    let mut result = Vec::new();
    let mut previous = String::new();
    let normalized = vtt.replace('\r', "");

    for block in normalized.split("\n\n") {
        let lines = block
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .collect::<Vec<_>>();

        if lines.is_empty() {
            continue;
        }

        if starts_with_any_case(lines[0], &["NOTE", "STYLE", "REGION"]) {
            continue;
        }

        let Some(timing_index) = lines.iter().position(|line| line.contains("-->")) else {
            continue;
        };
        let Some(start_seconds) = parse_cue_start_seconds(lines[timing_index]) else {
            continue;
        };
        let mut cue_lines = Vec::new();

        for line in lines.iter().skip(timing_index + 1) {
            if starts_with_any_case(line, &["WEBVTT", "Kind:", "Language:"]) {
                continue;
            }

            let cleaned = collapse_whitespace(&decode_entities(&strip_tags(
                &strip_inline_timestamps(line),
            )));

            if cleaned.is_empty() {
                continue;
            }

            cue_lines.push(cleaned);
        }

        let text = cue_lines.join(" ");

        if text.is_empty() || text == previous {
            continue;
        }

        previous = text.clone();
        result.push(TimedTranscriptSegment {
            start_seconds,
            start_label: format_timestamp_label(start_seconds),
            text,
        });
    }

    strip_transcript_notice_segments(&result)
}

async fn get_ytdlp_info(url: &str) -> Result<YtDlpInfo, TranscriptError> {
    let ytdlp = find_ytdlp_path().ok_or_else(|| {
        TranscriptError::new(
            "yt-dlpが見つかりません。Homebrewで `brew install yt-dlp` を実行してから、アプリを再起動してください。",
            502,
        )
    })?;

    let output = run_command_with_timeout(
        Command::new(ytdlp).args([
            "--dump-single-json",
            "--skip-download",
            "--write-auto-subs",
            "--write-subs",
            "--sub-langs",
            "all",
            "--sub-format",
            "vtt",
            "--socket-timeout",
            "20",
            "--no-warnings",
            url,
        ]),
        YTDLP_TIMEOUT,
        "ytdlp",
        CommandFailureMessages {
            create_output: "yt-dlpの一時出力を作成できませんでした。",
            spawn: "yt-dlpを実行できませんでした。",
            timeout: "字幕情報の取得がタイムアウトしました。しばらくしてから再試行してください。",
            wait: "yt-dlpの終了状態を確認できませんでした。",
        },
    )?;

    if !output.status.success() {
        return Err(TranscriptError::new(
            classify_ytdlp_error(&String::from_utf8_lossy(&output.stderr)),
            502,
        ));
    }

    serde_json::from_slice(&output.stdout)
        .map_err(|_| TranscriptError::new("yt-dlpの出力を解析できませんでした。", 502))
}

fn get_selectable_tracks(info: &YtDlpInfo) -> Vec<CaptionTrack> {
    let mut tracks = collect_tracks(info.subtitles.as_ref(), CaptionSource::Manual);
    tracks.extend(collect_tracks(
        info.automatic_captions.as_ref(),
        CaptionSource::Automatic,
    ));
    dedupe_caption_tracks(tracks)
}

fn get_requested_tracks(
    info: &YtDlpInfo,
    language: &str,
    source: CaptionSource,
) -> Vec<CaptionTrack> {
    let captions = match &source {
        CaptionSource::Manual => info.subtitles.as_ref(),
        CaptionSource::Automatic => info.automatic_captions.as_ref(),
        CaptionSource::Kanary => None,
    };
    collect_track_for_language(captions, source, language)
        .into_iter()
        .collect()
}

fn format_youtube_date(value: Option<&String>) -> Option<String> {
    let value = value?.trim();

    if value.len() == 8 && value.chars().all(|char| char.is_ascii_digit()) {
        return Some(format!(
            "{}-{}-{}",
            &value[0..4],
            &value[4..6],
            &value[6..8]
        ));
    }

    if value.is_empty() {
        return None;
    }

    Some(value.to_string())
}

fn format_duration(value: Option<f64>) -> Option<String> {
    let seconds = value?.round();

    if !seconds.is_finite() || seconds < 0.0 {
        return None;
    }

    let total_seconds = seconds as u64;
    let hours = total_seconds / 3600;
    let minutes = (total_seconds % 3600) / 60;
    let seconds = total_seconds % 60;

    if hours > 0 {
        Some(format!("{hours}:{minutes:02}:{seconds:02}"))
    } else {
        Some(format!("{minutes}:{seconds:02}"))
    }
}

fn build_video_chapters(chapters: Option<&[YtDlpChapter]>) -> Vec<VideoChapter> {
    chapters
        .unwrap_or_default()
        .iter()
        .filter_map(|chapter| {
            let title = normalize_optional_text(chapter.title.clone())?;
            let start_seconds = chapter.start_time?.round();

            if !start_seconds.is_finite() || start_seconds < 0.0 {
                return None;
            }

            let start_seconds = start_seconds as u64;
            Some(VideoChapter {
                title,
                start_seconds,
                start_label: format_timestamp_label(start_seconds),
            })
        })
        .collect()
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    let value = value?.trim().to_string();

    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn collect_tracks(
    captions: Option<&serde_json::Map<String, serde_json::Value>>,
    source: CaptionSource,
) -> Vec<CaptionTrack> {
    let Some(captions) = captions else {
        return Vec::new();
    };

    let mut tracks = Vec::new();

    for (language, formats_value) in captions {
        if let Some(track) = caption_track_from_formats(language, formats_value, source.clone()) {
            tracks.push(track);
        }
    }

    tracks
}

fn collect_track_for_language(
    captions: Option<&serde_json::Map<String, serde_json::Value>>,
    source: CaptionSource,
    language: &str,
) -> Option<CaptionTrack> {
    let formats_value = captions.and_then(|captions| captions.get(language))?;
    caption_track_from_formats(language, formats_value, source)
}

fn caption_track_from_formats(
    language: &str,
    formats_value: &serde_json::Value,
    source: CaptionSource,
) -> Option<CaptionTrack> {
    let Ok(formats) = serde_json::from_value::<Vec<YtDlpCaption>>(formats_value.clone()) else {
        return None;
    };
    let selected = formats
        .into_iter()
        .find(|format| is_selectable_caption_format(language, format))?;
    let url = selected.url?;

    Some(CaptionTrack {
        language: language.to_string(),
        name: selected.name.unwrap_or_else(|| language.to_string()),
        source,
        url,
    })
}

fn dedupe_caption_tracks(tracks: Vec<CaptionTrack>) -> Vec<CaptionTrack> {
    let mut seen = HashMap::new();
    let mut deduped = Vec::new();

    for track in tracks {
        let key = caption_dedupe_key(&track);

        if let Some(index) = seen.get(&key).copied() {
            let existing = &mut deduped[index];
            if should_replace_caption_track(existing, &track) {
                *existing = track;
            }
            continue;
        }

        seen.insert(key, deduped.len());
        deduped.push(track);
    }

    deduped
}

fn caption_dedupe_key(track: &CaptionTrack) -> String {
    let language = if matches!(track.source, CaptionSource::Automatic) {
        canonical_caption_language(&track.language)
    } else {
        track.language.to_ascii_lowercase()
    };

    format!("{}:{:?}", language, track.source)
}

fn canonical_caption_language(language: &str) -> String {
    let normalized = language.to_ascii_lowercase();

    normalized
        .strip_suffix("-orig")
        .unwrap_or(&normalized)
        .split('-')
        .next()
        .unwrap_or(normalized.as_str())
        .to_string()
}

fn should_replace_caption_track(existing: &CaptionTrack, candidate: &CaptionTrack) -> bool {
    caption_preference_score(candidate) > caption_preference_score(existing)
}

fn caption_preference_score(track: &CaptionTrack) -> u8 {
    let language = track.language.to_ascii_lowercase();
    let name = track.name.to_ascii_lowercase();

    if language.ends_with("-orig") || name.contains("original") {
        return 2;
    }

    if !language.contains('-') {
        return 1;
    }

    0
}

fn add_unique(ranked: &mut Vec<CaptionTrack>, track: Option<CaptionTrack>) {
    let Some(track) = track else {
        return;
    };

    if !ranked
        .iter()
        .any(|existing| existing.language == track.language && existing.source == track.source)
    {
        ranked.push(track);
    }
}

fn find_preferred_language(tracks: &[CaptionTrack], language: &str) -> Option<CaptionTrack> {
    tracks
        .iter()
        .find(|track| is_same_base_language(&track.language, language))
        .cloned()
}

fn is_same_base_language(value: &str, language: &str) -> bool {
    let normalized = value.to_ascii_lowercase();

    if is_translated_caption(&normalized) {
        return false;
    }

    normalized == language || normalized.starts_with(&format!("{language}-"))
}

fn is_translated_caption(language: &str) -> bool {
    let parts = language
        .to_ascii_lowercase()
        .split('-')
        .map(String::from)
        .collect::<Vec<_>>();

    if parts.len() <= 2 {
        return false;
    }

    let previous = parts
        .get(parts.len().saturating_sub(2))
        .map(String::as_str)
        .unwrap_or_default();
    previous == "zh"
        || (previous.len() >= 2
            && previous.len() <= 3
            && previous.chars().all(|char| char.is_ascii_lowercase()))
}

fn is_selectable_caption_format(language: &str, caption: &YtDlpCaption) -> bool {
    caption
        .url
        .as_deref()
        .map(|url| !url.trim().is_empty())
        .unwrap_or(false)
        && caption.ext.as_deref() == Some("vtt")
        && !is_translated_caption(language)
        && !has_translation_target(caption.url.as_deref())
}

struct CommandOutput {
    status: ExitStatus,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

#[derive(Clone, Copy)]
struct CommandFailureMessages {
    create_output: &'static str,
    spawn: &'static str,
    timeout: &'static str,
    wait: &'static str,
}

fn run_command_with_timeout(
    command: &mut Command,
    timeout: Duration,
    temp_label: &str,
    messages: CommandFailureMessages,
) -> Result<CommandOutput, TranscriptError> {
    let output_base = temp_output_base_with_label(temp_label);
    let stdout_path = output_base.with_extension("stdout");
    let stderr_path = output_base.with_extension("stderr");
    let stdout_file = fs::File::create(&stdout_path)
        .map_err(|_| TranscriptError::new(messages.create_output, 502))?;
    let stderr_file = fs::File::create(&stderr_path)
        .map_err(|_| TranscriptError::new(messages.create_output, 502))?;

    let mut child = command
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file))
        .spawn()
        .map_err(|_| TranscriptError::new(messages.spawn, 502))?;
    let started_at = std::time::Instant::now();

    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started_at.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                cleanup_temp_output(&stdout_path, &stderr_path);
                return Err(TranscriptError::new(messages.timeout, 504));
            }
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(_) => {
                cleanup_temp_output(&stdout_path, &stderr_path);
                return Err(TranscriptError::new(messages.wait, 502));
            }
        }
    };

    let stdout = fs::read(&stdout_path).unwrap_or_default();
    let stderr = fs::read(&stderr_path).unwrap_or_default();
    cleanup_temp_output(&stdout_path, &stderr_path);

    Ok(CommandOutput {
        status,
        stdout,
        stderr,
    })
}

fn temp_output_base_with_label(label: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let counter = TEMP_OUTPUT_COUNTER.fetch_add(1, Ordering::Relaxed);
    env::temp_dir().join(format!(
        "youtube-ai-brief-{label}-{}-{unique}-{counter}",
        std::process::id()
    ))
}

fn cleanup_temp_output(stdout_path: &Path, stderr_path: &Path) {
    let _ = fs::remove_file(stdout_path);
    let _ = fs::remove_file(stderr_path);
}

fn has_translation_target(url: Option<&str>) -> bool {
    let Some(url) = url else {
        return false;
    };

    Url::parse(url)
        .map(|url| url.query_pairs().any(|(key, _)| key == "tlang"))
        .unwrap_or_else(|_| url.contains("?tlang=") || url.contains("&tlang="))
}

fn normalize_video_id(value: Option<&str>) -> Result<String, TranscriptError> {
    let value = value.unwrap_or_default();

    if value.len() == 11
        && value
            .chars()
            .all(|char| char.is_ascii_alphanumeric() || char == '_' || char == '-')
    {
        return Ok(value.to_string());
    }

    Err(TranscriptError::bad_request(
        "YouTube動画IDをURLから取得できませんでした。",
    ))
}

fn strip_inline_timestamps(value: &str) -> String {
    let mut result = String::new();
    let mut rest = value;

    while let Some(start) = rest.find('<') {
        result.push_str(&rest[..start]);
        let Some(end) = rest[start..].find('>') else {
            result.push_str(&rest[start..]);
            return result;
        };
        let tag = &rest[start + 1..start + end];
        if !is_timestamp_tag(tag) {
            result.push('<');
            result.push_str(tag);
            result.push('>');
        }
        rest = &rest[start + end + 1..];
    }

    result.push_str(rest);
    result
}

fn strip_tags(value: &str) -> String {
    let mut result = String::new();
    let mut in_tag = false;

    for char in value.chars() {
        match char {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => result.push(char),
            _ => {}
        }
    }

    result
}

fn is_timestamp_tag(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 12
        && bytes[0].is_ascii_digit()
        && bytes[1].is_ascii_digit()
        && bytes[2] == b':'
        && bytes[3].is_ascii_digit()
        && bytes[4].is_ascii_digit()
        && bytes[5] == b':'
        && bytes[6].is_ascii_digit()
        && bytes[7].is_ascii_digit()
        && bytes[8] == b'.'
        && bytes[9].is_ascii_digit()
        && bytes[10].is_ascii_digit()
        && bytes[11].is_ascii_digit()
}

fn decode_entities(value: &str) -> String {
    let named = value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ");
    decode_numeric_entities(&named)
}

fn decode_numeric_entities(value: &str) -> String {
    let mut result = String::new();
    let mut rest = value;

    while let Some(start) = rest.find("&#") {
        result.push_str(&rest[..start]);
        let entity_start = &rest[start + 2..];
        let Some(end) = entity_start.find(';') else {
            result.push_str(&rest[start..]);
            return result;
        };

        let entity = &entity_start[..end];
        let hex_entity = entity
            .strip_prefix('x')
            .or_else(|| entity.strip_prefix('X'));
        let codepoint = hex_entity
            .and_then(|hex| u32::from_str_radix(hex, 16).ok())
            .or_else(|| entity.parse::<u32>().ok());

        if let Some(character) = codepoint.and_then(char::from_u32) {
            result.push(character);
        } else {
            result.push_str(&rest[start..start + end + 3]);
        }

        rest = &entity_start[end + 1..];
    }

    result.push_str(rest);
    result
}

fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn strip_transcript_notice_segments(
    segments: &[TimedTranscriptSegment],
) -> Vec<TimedTranscriptSegment> {
    segments
        .iter()
        .enumerate()
        .filter(|(index, segment)| *index > 4 || !is_transcript_notice(&segment.text))
        .map(|(_, segment)| segment.clone())
        .collect()
}

fn is_transcript_notice(line: &str) -> bool {
    let normalized = line
        .replace(['(', ')', '（', '）', '[', ']', '.', '。', '．'], "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();

    !normalized.is_empty()
        && (normalized.contains("translated by ai for reference only")
            || normalized.contains("ai translated for reference only")
            || normalized.contains("ai translation for reference only")
            || normalized.contains("aiによる翻訳")
            || normalized.contains("ai翻訳")
            || normalized.contains("参考のみ"))
}

fn starts_with_any_case(value: &str, prefixes: &[&str]) -> bool {
    let lower = value.to_ascii_lowercase();
    prefixes
        .iter()
        .any(|prefix| lower.starts_with(&prefix.to_ascii_lowercase()))
}

fn parse_cue_start_seconds(timing_line: &str) -> Option<u64> {
    let start = timing_line.split("-->").next()?.trim();
    parse_vtt_timestamp_seconds(start)
}

fn parse_vtt_timestamp_seconds(value: &str) -> Option<u64> {
    let timestamp = value.split_whitespace().next()?.replace(',', ".");
    let parts = timestamp.split(':').collect::<Vec<_>>();
    let (hours, minutes, seconds_part) = match parts.as_slice() {
        [minutes, seconds] => (0, minutes.parse::<u64>().ok()?, *seconds),
        [hours, minutes, seconds] => (
            hours.parse::<u64>().ok()?,
            minutes.parse::<u64>().ok()?,
            *seconds,
        ),
        _ => return None,
    };
    let seconds = seconds_part
        .split('.')
        .next()
        .and_then(|seconds| seconds.parse::<u64>().ok())?;

    Some(hours * 3600 + minutes * 60 + seconds)
}

fn format_timestamp_label(total_seconds: u64) -> String {
    let hours = total_seconds / 3600;
    let minutes = (total_seconds % 3600) / 60;
    let seconds = total_seconds % 60;

    if hours > 0 {
        format!("{hours}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes}:{seconds:02}")
    }
}

fn classify_ytdlp_error(stderr: &str) -> &'static str {
    let lower = stderr.to_ascii_lowercase();

    if lower.contains("unsupported url") {
        return "YouTubeの動画URLを入力してください。";
    }

    if lower.contains("private video") {
        return "非公開動画のため取得できません。";
    }

    if lower.contains("video unavailable") || lower.contains("this video is unavailable") {
        return "動画を利用できません。削除、地域制限、または公開制限の可能性があります。";
    }

    if lower.contains("sign in") || lower.contains("login") {
        return "ログインが必要な動画のため取得できません。";
    }

    "字幕情報の取得に失敗しました。"
}

fn normalize_media_path(value: &str) -> Result<PathBuf, TranscriptError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(TranscriptError::bad_request(
            "動画ファイルのパスを入力してください。",
        ));
    }

    let expanded = if let Some(rest) = trimmed.strip_prefix("~/") {
        home_dir()
            .map(|home| home.join(rest))
            .unwrap_or_else(|| PathBuf::from(trimmed))
    } else {
        PathBuf::from(trimmed)
    };

    let canonical = fs::canonicalize(&expanded).map_err(|_| {
        TranscriptError::bad_request("指定された動画ファイルが見つかりません。")
    })?;

    if !canonical.is_file() {
        return Err(TranscriptError::bad_request(
            "指定されたパスはファイルではありません。",
        ));
    }

    if !is_supported_media_file(&canonical) {
        return Err(TranscriptError::bad_request(
            ".mov / .mp4 / .m4v の動画ファイルを指定してください。",
        ));
    }

    Ok(canonical)
}

fn is_supported_media_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| matches!(extension.to_ascii_lowercase().as_str(), "mov" | "mp4" | "m4v"))
        .unwrap_or(false)
}

fn classify_kanary_error(stderr: &str) -> &'static str {
    let lower = stderr.to_ascii_lowercase();

    if lower.contains("unsupported") || lower.contains("invalid") {
        return "Kanaryがこの動画ファイルを処理できませんでした。";
    }

    if lower.contains("permission denied") || lower.contains("operation not permitted") {
        return "動画ファイルを読み取る権限がありません。";
    }

    "Kanaryで文字起こしできませんでした。"
}

fn parse_kanary_transcribe_text(stdout: &[u8]) -> String {
    let raw = String::from_utf8_lossy(stdout).trim().to_string();
    if raw.is_empty() {
        return String::new();
    }

    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return raw;
    };

    extract_kanary_text_from_value(&value).unwrap_or_default()
}

fn extract_kanary_text_from_value(value: &serde_json::Value) -> Option<String> {
    if let Some(text) = value.get("text").and_then(|text| text.as_str()) {
        return normalize_optional_text(Some(text.to_string()));
    }

    if let Some(text) = value
        .get("transcript")
        .and_then(|transcript| transcript.get("text"))
        .and_then(|text| text.as_str())
    {
        return normalize_optional_text(Some(text.to_string()));
    }

    if let Some(segments) = value
        .get("transcript")
        .and_then(|transcript| transcript.get("segments"))
        .and_then(|segments| segments.as_array())
    {
        let text = segments
            .iter()
            .filter_map(|segment| segment.get("text").and_then(|text| text.as_str()))
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        return normalize_optional_text(Some(text));
    }

    match value {
        serde_json::Value::Object(object) => object
            .values()
            .find_map(extract_kanary_text_from_value),
        serde_json::Value::Array(items) => items
            .iter()
            .find_map(extract_kanary_text_from_value),
        _ => None,
    }
}

fn find_ytdlp_path() -> Option<PathBuf> {
    find_ytdlp_path_with(
        env::var_os("PATH"),
        [
            PathBuf::from("/opt/homebrew/bin/yt-dlp"),
            PathBuf::from("/usr/local/bin/yt-dlp"),
            PathBuf::from("/usr/bin/yt-dlp"),
        ],
    )
}

fn find_kanary_path() -> Option<PathBuf> {
    find_executable_path(
        "kanary",
        env::var_os("PATH"),
        [
            PathBuf::from("/opt/homebrew/bin/kanary"),
            PathBuf::from("/usr/local/bin/kanary"),
            PathBuf::from("/Applications/Kanary.app/Contents/Helpers/kanary"),
            home_dir()
                .unwrap_or_else(|| PathBuf::from("/"))
                .join("Applications/Kanary.app/Contents/Helpers/kanary"),
        ],
    )
}

fn find_ytdlp_path_with(
    path_env: Option<OsString>,
    candidates: impl IntoIterator<Item = PathBuf>,
) -> Option<PathBuf> {
    find_executable_path("yt-dlp", path_env, candidates)
}

fn find_executable_path(
    executable_name: &str,
    path_env: Option<OsString>,
    candidates: impl IntoIterator<Item = PathBuf>,
) -> Option<PathBuf> {
    if let Some(path_env) = path_env {
        for dir in env::split_paths(&path_env) {
            let candidate = dir.join(executable_name);
            if is_executable_file(&candidate) {
                return Some(candidate);
            }
        }
    }

    candidates
        .into_iter()
        .find(|candidate| is_executable_file(candidate))
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME").map(PathBuf::from)
}

fn is_executable_file(path: &Path) -> bool {
    fs::metadata(path)
        .map(|metadata| metadata.is_file() && has_execute_permission(&metadata))
        .unwrap_or(false)
}

#[cfg(unix)]
fn has_execute_permission(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;

    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn has_execute_permission(_: &fs::Metadata) -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs::{File, Permissions},
        os::unix::fs::PermissionsExt,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn info(value: serde_json::Value) -> YtDlpInfo {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn parses_watch_url() {
        assert_eq!(
            parse_youtube_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42").unwrap(),
            "dQw4w9WgXcQ"
        );
    }

    #[test]
    fn parses_short_url() {
        assert_eq!(
            parse_youtube_video_id("https://youtu.be/dQw4w9WgXcQ?si=test").unwrap(),
            "dQw4w9WgXcQ"
        );
    }

    #[test]
    fn parses_shorts_url() {
        assert_eq!(
            parse_youtube_video_id("https://www.youtube.com/shorts/dQw4w9WgXcQ").unwrap(),
            "dQw4w9WgXcQ"
        );
    }

    #[test]
    fn rejects_non_youtube_url() {
        assert!(parse_youtube_video_id("https://example.com/watch?v=dQw4w9WgXcQ").is_err());
    }

    #[test]
    fn prefers_japanese_caption() {
        let track = choose_caption_track(&info(serde_json::json!({
            "subtitles": {
                "en": [{ "ext": "vtt", "url": "https://example.com/en.vtt" }],
                "ja": [{ "ext": "vtt", "url": "https://example.com/ja.vtt" }]
            }
        })));

        assert_eq!(track.unwrap().language, "ja");
    }

    #[test]
    fn puts_video_language_caption_first_when_available() {
        let tracks = rank_caption_tracks(&info(serde_json::json!({
            "language": "en",
            "subtitles": {
                "ja": [{ "ext": "vtt", "url": "https://example.com/ja.vtt" }],
                "en": [{ "ext": "vtt", "url": "https://example.com/en.vtt" }]
            }
        })));

        assert_eq!(
            tracks
                .iter()
                .map(|track| track.language.as_str())
                .collect::<Vec<_>>(),
            ["en", "ja"]
        );
    }

    #[test]
    fn prefers_english_when_japanese_is_missing() {
        let track = choose_caption_track(&info(serde_json::json!({
            "automatic_captions": {
                "fr": [{ "ext": "vtt", "url": "https://example.com/fr.vtt" }],
                "en": [{ "ext": "vtt", "url": "https://example.com/en.vtt" }]
            }
        })));

        assert_eq!(track.unwrap().language, "en");
    }

    #[test]
    fn excludes_translated_captions() {
        let tracks = rank_caption_tracks(&info(serde_json::json!({
            "subtitles": {
                "en-US": [{ "ext": "vtt", "url": "https://example.com/en.vtt" }],
                "zh-Hans": [{ "ext": "vtt", "url": "https://example.com/zh-manual.vtt" }]
            },
            "automatic_captions": {
                "zh-Hans": [{ "ext": "vtt", "url": "https://example.com/zh-auto.vtt" }],
                "ja": [{ "ext": "vtt", "url": "https://example.com/translated.vtt?lang=en&tlang=ja" }],
                "ja-zh-Hans": [{ "ext": "vtt", "url": "https://example.com/ja-translated.vtt" }]
            }
        })));

        assert_eq!(tracks[0].language, "en-US");
        assert_eq!(
            tracks
                .iter()
                .map(|track| format!("{}:{:?}", track.language, track.source))
                .collect::<Vec<_>>(),
            ["en-US:Manual", "zh-Hans:Manual", "zh-Hans:Automatic"]
        );
    }

    #[test]
    fn keeps_manual_and_automatic_captions_for_same_language() {
        let tracks = rank_caption_tracks(&info(serde_json::json!({
            "subtitles": {
                "ja": [{ "ext": "vtt", "url": "https://example.com/ja-manual.vtt" }],
                "en": [{ "ext": "vtt", "url": "https://example.com/en-manual.vtt" }]
            },
            "automatic_captions": {
                "ja": [{ "ext": "vtt", "url": "https://example.com/ja-auto.vtt" }],
                "fr": [{ "ext": "vtt", "url": "https://example.com/fr-auto.vtt" }]
            }
        })));

        assert_eq!(
            tracks
                .iter()
                .map(|track| format!("{}:{:?}", track.language, track.source))
                .collect::<Vec<_>>(),
            ["ja:Manual", "en:Manual", "ja:Automatic", "fr:Automatic"]
        );
    }

    #[test]
    fn requested_caption_lookup_only_returns_matching_source_and_language() {
        let info = info(serde_json::json!({
            "subtitles": {
                "ja": [{ "ext": "vtt", "url": "https://example.com/ja-manual.vtt" }],
                "en": [{ "ext": "vtt", "url": "https://example.com/en-manual.vtt" }]
            },
            "automatic_captions": {
                "ja": [{ "ext": "vtt", "url": "https://example.com/ja-auto.vtt" }],
                "fr": [{ "ext": "vtt", "url": "https://example.com/fr-auto.vtt" }]
            }
        }));

        let tracks = get_requested_tracks(&info, "ja", CaptionSource::Automatic);

        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].source, CaptionSource::Automatic);
        assert_eq!(tracks[0].language, "ja");
        assert_eq!(tracks[0].url, "https://example.com/ja-auto.vtt");
    }

    #[test]
    fn collapses_automatic_caption_aliases_for_same_base_language() {
        let tracks = rank_caption_tracks(&info(serde_json::json!({
            "automatic_captions": {
                "en": [{ "ext": "vtt", "url": "https://example.com/en-auto.vtt", "name": "English" }],
                "en-orig": [{ "ext": "vtt", "url": "https://example.com/en-orig-auto.vtt", "name": "English (Original)" }],
                "ja": [{ "ext": "vtt", "url": "https://example.com/ja-auto.vtt", "name": "Japanese" }]
            }
        })));

        assert_eq!(
            tracks
                .iter()
                .map(|track| format!("{}:{}", track.language, track.name))
                .collect::<Vec<_>>(),
            ["ja:Japanese", "en-orig:English (Original)"]
        );
    }

    #[test]
    fn parses_vtt_to_plain_text() {
        let text = parse_vtt_to_plain_text(
            r#"WEBVTT

00:00:00.000 --> 00:00:01.000
こんにちは

00:00:01.000 --> 00:00:02.000
<c>世界</c> &amp; YouTube
"#,
        );

        assert_eq!(text, "こんにちは\n世界 & YouTube");
    }

    #[test]
    fn decodes_decimal_and_hex_entities_in_vtt() {
        let text = parse_vtt_to_plain_text(
            r#"WEBVTT

00:00:00.000 --> 00:00:01.000
Tom&#39;s &#x26; Jerry&#x1F600;
"#,
        );

        assert_eq!(text, "Tom's & Jerry😀");
    }

    #[test]
    fn parses_vtt_with_cue_ids_and_ignores_note_blocks() {
        let text = parse_vtt_to_plain_text(
            r#"WEBVTT
Kind: captions

NOTE
This should not be included.

intro-cue
00:00:00.000 --> 00:00:01.000 align:start
Hello <00:00:00.500>world

next-cue
00:00:01.000 --> 00:00:02.000
<c.highlight>Second line</c>
"#,
        );

        assert_eq!(text, "Hello world\nSecond line");
    }

    #[test]
    fn parses_timed_vtt_segments() {
        let segments = parse_vtt_to_timed_segments(
            r#"WEBVTT

00:00:03.400 --> 00:00:05.000
Opening

00:10:00.000 --> 00:10:02.000
Main point

01:02:03.000 --> 01:02:04.000
Long video point
"#,
        );

        assert_eq!(
            segments
                .iter()
                .map(|segment| (
                    segment.start_seconds,
                    segment.start_label.as_str(),
                    segment.text.as_str()
                ))
                .collect::<Vec<_>>(),
            [
                (3, "0:03", "Opening"),
                (600, "10:00", "Main point"),
                (3723, "1:02:03", "Long video point")
            ]
        );
    }

    #[test]
    fn strips_transcript_notice() {
        let text = parse_vtt_to_plain_text(
            r#"WEBVTT

00:00:00.000 --> 00:00:01.000
（Translated by AI for reference only.）

00:00:01.000 --> 00:00:02.000
Hello everyone
"#,
        );

        assert_eq!(text, "Hello everyone");
    }

    #[test]
    fn excludes_non_vtt_caption_formats() {
        let tracks = rank_caption_tracks(&info(serde_json::json!({
            "subtitles": {
                "ja": [
                    { "ext": "json3", "url": "https://example.com/ja.json3" },
                    { "ext": "vtt", "url": "https://example.com/ja.vtt" }
                ],
                "en": [
                    { "ext": "srv3", "url": "https://example.com/en.srv3" }
                ]
            }
        })));

        assert_eq!(
            tracks
                .iter()
                .map(|track| track.language.as_str())
                .collect::<Vec<_>>(),
            ["ja"]
        );
    }

    #[test]
    fn skips_empty_caption_urls() {
        let tracks = rank_caption_tracks(&info(serde_json::json!({
            "subtitles": {
                "ja": [
                    { "ext": "vtt", "url": "" },
                    { "ext": "vtt", "url": "   " },
                    { "ext": "vtt", "url": "https://example.com/ja.vtt" }
                ]
            }
        })));

        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].url, "https://example.com/ja.vtt");
    }

    #[test]
    fn validates_supported_local_video_paths() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = env::temp_dir().join(format!("kanary-media-test-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        let candidate = dir.join("sample.MP4");
        File::create(&candidate).unwrap();

        let normalized = normalize_media_path(candidate.to_str().unwrap()).unwrap();

        fs::remove_file(&candidate).unwrap();
        fs::remove_dir(&dir).unwrap();

        assert_eq!(normalized.file_name().and_then(|name| name.to_str()), Some("sample.MP4"));
    }

    #[test]
    fn rejects_unsupported_local_media_extensions() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = env::temp_dir().join(format!("kanary-media-extension-test-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        let candidate = dir.join("sample.txt");
        File::create(&candidate).unwrap();

        let error = normalize_media_path(candidate.to_str().unwrap()).unwrap_err();

        fs::remove_file(&candidate).unwrap();
        fs::remove_dir(&dir).unwrap();

        assert_eq!(error.status, 400);
        assert!(error.message.contains(".mov / .mp4 / .m4v"));
    }

    #[test]
    fn builds_kanary_transcript_result_from_media_path() {
        let result = build_media_transcript_result(
            Path::new("/Users/example/Movies/demo.mp4"),
            "hello from video".to_string(),
        );

        assert_eq!(result.video_id, "demo");
        assert_eq!(result.title, "demo.mp4");
        assert_eq!(result.source, CaptionSource::Kanary);
        assert_eq!(result.language, "auto");
        assert_eq!(result.text, "hello from video");
        assert_eq!(
            result.source_path.as_deref(),
            Some("/Users/example/Movies/demo.mp4")
        );
        assert!(result.timed_segments.is_empty());
    }

    #[test]
    fn parses_kanary_transcribe_segments_json() {
        let text = parse_kanary_transcribe_text(
            br#"{
                "schema_version": 1,
                "transcript": {
                    "segments": [
                        { "channel": "speaker", "text": "First line" },
                        { "channel": "speaker", "text": "Second line" }
                    ]
                }
            }"#,
        );

        assert_eq!(text, "First line\nSecond line");
    }

    #[test]
    fn parses_nested_kanary_transcript_json() {
        let text = parse_kanary_transcribe_text(
            br#"{
                "recording": {
                    "transcript": {
                        "text": "Nested transcript"
                    }
                }
            }"#,
        );

        assert_eq!(text, "Nested transcript");
    }

    #[test]
    fn keeps_plain_kanary_output_as_fallback() {
        let text = parse_kanary_transcribe_text(b"Plain transcript\n");

        assert_eq!(text, "Plain transcript");
    }

    #[test]
    fn finds_ytdlp_in_homebrew_style_candidate_path() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = env::temp_dir().join(format!("yt-dlp-test-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        let candidate = dir.join("yt-dlp");
        File::create(&candidate).unwrap();
        fs::set_permissions(&candidate, Permissions::from_mode(0o755)).unwrap();

        let found = find_ytdlp_path_with(None, [candidate.clone()]);

        fs::remove_file(&candidate).unwrap();
        fs::remove_dir(&dir).unwrap();

        assert_eq!(found, Some(candidate));
    }

    #[test]
    fn skips_non_executable_ytdlp_path_entries() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let base_dir = env::temp_dir().join(format!("yt-dlp-path-test-{unique}"));
        let path_dir = base_dir.join("path");
        let candidate_dir = base_dir.join("candidate");
        fs::create_dir_all(&path_dir).unwrap();
        fs::create_dir_all(&candidate_dir).unwrap();

        let non_executable = path_dir.join("yt-dlp");
        let executable = candidate_dir.join("yt-dlp");
        File::create(&non_executable).unwrap();
        File::create(&executable).unwrap();
        fs::set_permissions(&non_executable, Permissions::from_mode(0o644)).unwrap();
        fs::set_permissions(&executable, Permissions::from_mode(0o755)).unwrap();

        let found = find_ytdlp_path_with(
            env::join_paths([path_dir.clone()]).ok(),
            [executable.clone()],
        );

        fs::remove_file(&non_executable).unwrap();
        fs::remove_file(&executable).unwrap();
        fs::remove_dir(&path_dir).unwrap();
        fs::remove_dir(&candidate_dir).unwrap();
        fs::remove_dir(&base_dir).unwrap();

        assert_eq!(found, Some(executable));
    }
}
