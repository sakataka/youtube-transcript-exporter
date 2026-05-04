# AGENTS.md

## 応答

- 回答は日本語で行う。

## プロジェクト概要

- このアプリは `YouTube AI Brief`。
- 目的は、YouTube動画の字幕・自動字幕を取得し、生成AIへ渡しやすいプロンプト付きテキストへ整えること。
- コピーされる内容には、動画情報、字幕本文、文章での整理依頼、画像生成依頼を含める。
- UIは日本語をデフォルトとし、設定画面から英語UIにも切り替えられる。

## 開発コマンド

- 開発起動: `bun run app`
- 型チェック: `bun run typecheck`
- Rustテスト: `bun run test`
- macOSアプリ作成: `bun run package`
- `/Applications` へコピー: `bun run package:install`

## 実装メモ

- フロントエンドは `src/main.ts` と `src/style.css`。
- Tauri/Rust側の字幕取得処理は `src-tauri/src/transcript.rs`。
- コピー用プロンプト設定とUI言語設定は `localStorage` に保存する。
- `/Applications` へコピーする処理は `scripts/install-app.ts`。
- UI、Tauri、配布アプリに反映される意味のある変更を行った場合は、検証後に `bun run package:install` を実行して `/Applications/YouTube AI Brief.app` へ最新アプリを同期する。
- 配布用に最新アプリへ反映するときは、`bun run package:install` を実行し、`/Applications/YouTube AI Brief.app` が更新されていることを確認する。
