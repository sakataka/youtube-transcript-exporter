use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    env,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use url::Url;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CaptionSource {
    Manual,
    Automatic,
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
    upload_date: Option<String>,
    release_date: Option<String>,
    subtitles: Option<serde_json::Map<String, serde_json::Value>>,
    automatic_captions: Option<serde_json::Map<String, serde_json::Value>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptResult {
    pub video_id: String,
    pub title: String,
    pub channel_name: Option<String>,
    pub published_date: Option<String>,
    pub language: String,
    pub source: CaptionSource,
    pub text: String,
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
    pub published_date: Option<String>,
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
    let tracks = get_selectable_tracks(&info);

    if tracks.is_empty() {
        return Err(TranscriptError::bad_request("字幕が見つかりません。"));
    }

    Ok(CaptionListResult {
        video_id: info.id.clone().unwrap_or(video_id),
        title: info
            .title
            .clone()
            .unwrap_or_else(|| info.id.clone().unwrap_or_default()),
        channel_name: info.channel.clone(),
        published_date: format_youtube_date(
            info.release_date.as_ref().or(info.upload_date.as_ref()),
        ),
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
        get_selectable_tracks(&info)
            .into_iter()
            .filter(|track| track.language == language && track.source == source)
            .collect::<Vec<_>>()
    } else {
        rank_caption_tracks(&info)
    };

    if tracks.is_empty() {
        return Err(TranscriptError::bad_request(
            "選択された字幕が見つかりません。",
        ));
    }

    let client = reqwest::Client::new();

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
        let text = parse_vtt_to_plain_text(&body);

        if text.is_empty() {
            continue;
        }

        return Ok(TranscriptResult {
            video_id: info.id.clone().unwrap_or(video_id),
            title: info
                .title
                .clone()
                .unwrap_or_else(|| info.id.clone().unwrap_or_default()),
            channel_name: info.channel.clone(),
            published_date: format_youtube_date(
                info.release_date.as_ref().or(info.upload_date.as_ref()),
            ),
            language: track.language,
            source: track.source,
            text,
        });
    }

    Err(TranscriptError::new(
        "字幕データを取得できませんでした。",
        502,
    ))
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

fn parse_vtt_to_plain_text(vtt: &str) -> String {
    let mut result = Vec::new();
    let mut previous = String::new();
    let mut skipping_block = false;

    for raw_line in vtt.replace('\r', "").lines() {
        let line = raw_line.trim();

        if line.is_empty() {
            skipping_block = false;
            continue;
        }

        if starts_with_any_case(line, &["WEBVTT", "Kind:", "Language:"]) {
            continue;
        }

        if starts_with_any_case(line, &["NOTE", "STYLE", "REGION"]) {
            skipping_block = true;
            continue;
        }

        if skipping_block || line.contains("-->") || line.chars().all(|char| char.is_ascii_digit())
        {
            continue;
        }

        let cleaned = collapse_whitespace(&decode_entities(&strip_tags(&strip_inline_timestamps(
            line,
        ))));

        if cleaned.is_empty() || cleaned == previous {
            continue;
        }

        previous = cleaned.clone();
        result.push(cleaned);
    }

    strip_transcript_notices(&result)
        .join("\n")
        .trim()
        .to_string()
}

async fn get_ytdlp_info(url: &str) -> Result<YtDlpInfo, TranscriptError> {
    let ytdlp = find_ytdlp_path().ok_or_else(|| {
        TranscriptError::new(
            "yt-dlpが見つかりません。Homebrewで `brew install yt-dlp` を実行してから、アプリを再起動してください。",
            502,
        )
    })?;

    let output = Command::new(ytdlp)
        .args([
            "--dump-single-json",
            "--skip-download",
            "--write-auto-subs",
            "--write-subs",
            "--sub-langs",
            "all",
            "--sub-format",
            "vtt",
            "--no-warnings",
            url,
        ])
        .output()
        .map_err(|_| TranscriptError::new("yt-dlpを実行できませんでした。", 502))?;

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

fn collect_tracks(
    captions: Option<&serde_json::Map<String, serde_json::Value>>,
    source: CaptionSource,
) -> Vec<CaptionTrack> {
    let Some(captions) = captions else {
        return Vec::new();
    };

    let mut tracks = Vec::new();

    for (language, formats_value) in captions {
        let Ok(formats) = serde_json::from_value::<Vec<YtDlpCaption>>(formats_value.clone()) else {
            continue;
        };
        let selectable = formats
            .into_iter()
            .filter(|format| is_selectable_caption_format(language, format))
            .collect::<Vec<_>>();
        let selected = selectable
            .iter()
            .find(|format| format.ext.as_deref() == Some("vtt"))
            .or_else(|| selectable.first());

        if let Some(selected) = selected {
            if let Some(url) = selected.url.clone() {
                tracks.push(CaptionTrack {
                    language: language.clone(),
                    name: selected.name.clone().unwrap_or_else(|| language.clone()),
                    source: source.clone(),
                    url,
                });
            }
        }
    }

    tracks
}

fn dedupe_caption_tracks(tracks: Vec<CaptionTrack>) -> Vec<CaptionTrack> {
    let mut seen = HashSet::new();
    let mut deduped = Vec::new();

    for track in tracks {
        let key = format!("{}:{:?}", track.language.to_ascii_lowercase(), track.source);

        if seen.insert(key) {
            deduped.push(track);
        }
    }

    deduped
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
    caption.url.is_some()
        && !is_translated_caption(language)
        && !has_translation_target(caption.url.as_deref())
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
    value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
}

fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn strip_transcript_notices(lines: &[String]) -> Vec<String> {
    lines
        .iter()
        .enumerate()
        .filter(|(index, line)| *index > 4 || !is_transcript_notice(line))
        .map(|(_, line)| line.clone())
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

fn find_ytdlp_path_with(
    path_env: Option<OsString>,
    candidates: impl IntoIterator<Item = PathBuf>,
) -> Option<PathBuf> {
    if let Some(path_env) = path_env {
        for dir in env::split_paths(&path_env) {
            let candidate = dir.join("yt-dlp");
            if is_executable_file(&candidate) {
                return Some(candidate);
            }
        }
    }

    candidates
        .into_iter()
        .find(|candidate| is_executable_file(candidate))
}

fn is_executable_file(path: &Path) -> bool {
    fs::metadata(path)
        .map(|metadata| metadata.is_file())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs::File,
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
    fn finds_ytdlp_in_homebrew_style_candidate_path() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = env::temp_dir().join(format!("yt-dlp-test-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        let candidate = dir.join("yt-dlp");
        File::create(&candidate).unwrap();

        let found = find_ytdlp_path_with(None, [candidate.clone()]);

        fs::remove_file(&candidate).unwrap();
        fs::remove_dir(&dir).unwrap();

        assert_eq!(found, Some(candidate));
    }
}
