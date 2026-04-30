# YouTube Transcript Exporter

公開されているYouTube動画の字幕または自動字幕を取得し、本文テキストとして表示・保存するmacOS向けローカルGUIアプリです。Tauriで動作し、ブラウザやローカルWebサーバーを手動で起動する必要はありません。

## 必要なもの

- Bun
- Rust
- yt-dlp

macOSで `yt-dlp` がない場合:

```sh
brew install yt-dlp
```

## 開発起動

```sh
bun install
bun run app
```

Tauriの開発ウィンドウが起動します。

## macOSアプリの作成

```sh
bun run package
```

生成された `.app` はFinderからダブルクリックして起動できます。Finder起動時も `yt-dlp` を見つけられるように、アプリ側で `PATH` に加えて `/opt/homebrew/bin/yt-dlp`、`/usr/local/bin/yt-dlp`、`/usr/bin/yt-dlp` を探索します。

ビルドした `.app` を `/Applications` にコピーして、常に最新のアプリを起動したい場合:

```sh
bun run package:install
```

このコマンドは `src-tauri/target` 配下に生成された `YouTube Transcript Exporter.app` を `/Applications` に上書きコピーします。コピー先を変える場合は `APPLICATIONS_DIR=/path/to/apps bun run package:install` を使います。

## 対応範囲

- 公開動画の字幕・自動字幕が取得できる場合のみ対応します。
- 取得可能な手動字幕・自動生成字幕を一覧表示し、言語と字幕種別を指定して取得できます。
- 字幕を指定しないAPI利用では、日本語字幕を優先し、なければ英語、それもなければ取得可能な最初の字幕を使います。
- 自動翻訳字幕は候補から除外します。
- 取得した本文はコピー、TXT保存、動画情報つきMarkdown保存ができます。
- 音声認識、音声ダウンロード、ログインが必要な動画、年齢制限や地域制限の回避は行いません。
