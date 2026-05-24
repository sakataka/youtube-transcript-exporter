# AGENTS.md

## 応答

- 回答は日本語で行う。
- Codex は、明示依頼がない限り formatter / format check / import sort の新規導入・設定追加・実行をしない。

## プロジェクト概要

- このアプリは `YouTube AI Brief`。
- 目的は、YouTube動画の字幕・自動字幕を取得し、生成AIへ渡しやすいプロンプト付きテキストへ整えること。
- コピーされる内容には、動画情報、字幕本文、文章での整理依頼、画像生成依頼を含める。
- UIは日本語をデフォルトとし、設定画面から英語UIにも切り替えられる。

## 開発コマンド

- ローカルWebアプリ起動: `bun run web`
- ビルド済みWebサーバー起動: `bun run web:server`
- 型チェック: `bun run typecheck`
- Rustテスト: `bun run test`

## 実装メモ

- フロントエンドは `src/main.ts` と `src/style.css`。
- ローカルWebサーバーは `server/src/local_web_server.rs`。
- 字幕取得処理は `server/src/transcript.rs`。
- コピー用プロンプト設定とUI言語設定は `localStorage` に保存する。
- 実行形態はローカルWebサーバー。機能追加時はローカルHTTP APIとして実現できる設計を優先する。
- デスクトップアプリ化や配布用コピー処理はこのプロジェクトの現行スコープ外。
