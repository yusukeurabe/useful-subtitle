# YouTube Live Subtitles Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Run one implementer and then one reviewer sequentially. No automatic commits, pushes, or PRs.

**Goal:** Prime Video の既存機能を維持し、YouTube の標準字幕をリアルタイムに取得して同じ学習機能で表示する。

**Architecture:** 表示された字幕の DOM を監視する方式（ユーザー承認済みの①）。サイトごとの字幕・動画・プレイヤー選択と、YouTube のページ遷移への追従を追加し、既存の字幕 UI・翻訳・解説・履歴を共有する。

**Tech Stack:** TypeScript, Chrome MV3, MutationObserver, esbuild, Vitest/jsdom. 新しい依存なし。

**Spec:** 本チャットで承認された①の仕様。以下の範囲は実装上の判断として記録する。

## Global Constraints

- Desktop YouTube `https://www.youtube.com/*` と `https://youtube.com/*` を対象とし、通常の `/watch?v=...` ページで動作する。ホームから動画への SPA 遷移も対応。Shorts・埋め込み・モバイルは今回対象外。
- 字幕 ON が必要。画面に現れた文字だけを取得し、未再生箇所の先読みや音声認識は追加しない。
- Prime Video の字幕・翻訳・単語解説・履歴・再生操作を維持する。
- YouTube は `#movie_player` 内の `.ytp-caption-segment` を対象にする（2026-10-30 に実際のページで確認）。他の字幕拡張の UI やプレビューを混ぜない。
- YouTube の字幕はプレイヤー内に配置し、全画面・プレイヤー差し替えに追従する。標準字幕の非表示は読み取り元の文字を残す。
- YouTube の広告中は字幕取得・翻訳・記録を止める。同じ動画の広告や尺の変化で履歴を消さない。別の動画 ID では履歴と古い字幕をリセットする。
- 自動字幕の細かい更新は原文表示へ即時反映する。限界（断片的な履歴、翻訳の遅延）は説明し、音声認識や全字幕取得は追加しない。
- `.env` / `.env.*` は読まない。開発サーバー・依存導入・並列エージェント・重いビルドは禁止。軽量な対象テストを1ワーカーで実行する。
- コミット・push・PR はユーザーからの別途依頼まで行わない。

## Review Focus

1. 初期ホーム画面から watch ページへ移動した場合とプレイヤー再生成。
2. 同じ字幕文字で動画が切り替わる場合、字幕 OFF、watch から離れる場合の残留表示。
3. 広告の開始・終了が class 属性だけを変える場合、および広告復帰後の重複記録。
4. Prime の既存セレクタ・再生操作・全画面追従の回帰。
5. 自動字幕の更新中の翻訳応答逆転、前動画からの応答が新動画へ混入する場合。

## Task 1: YouTube の字幕取得から表示までを接続

**Files:** `manifest.json`, `src/shared/selectors.ts`, `src/content/captionExtractor.ts`, `src/content/captionObserver.ts`, `src/content/contentIdentity.ts`, `src/content/videoControl.ts`, `src/content/index.ts`, `src/content/overlay.ts`, 必要最小限のサイト判定/ライフサイクルモジュール、対応する `tests/*.test.ts`, `README.md`, `package.json`, `src/options/options.html`。

- [x] サイト判定・字幕選択・YouTube 動画 ID と遷移・広告抑制・表示位置を検証する対象テストを書く。既存の公開関数と Prime の既定値を維持する。
- [x] テストを単一ワーカーで実行し、新要件の失敗を確認する。
- [x] YouTube のサイト別処理と DOM 監視を実装し、既存機能につなぐ。DOM 監視はフレーム単位にまとめ、無駄な再描画ループを避ける。
- [x] 対象テストと `npm run typecheck` を実行する（初回93件成功、レビュー修正後に関連分を再実行）。
- [x] README と設定画面を更新する。YouTube の英語字幕 ON、他の字幕拡張との競合、読み取り方式の制限を説明する。
- [x] 未コミット差分を別エージェントがレビューし、重要指摘を修正・再検証する（4件を修正、修正対象70件成功、再レビュー問題なし）。

## Verification / Delivery

- `node_modules/.bin/vitest run <対象ファイル> --maxWorkers=1 --no-file-parallelism`
- `npm run typecheck`
- `git diff --check`
- 実ブラウザーの読み取りで YouTube 字幕 DOM を確認済み。拡張のロード後の実動確認は、利用できるブラウザーとビルド状況に応じて実施し、未確認部分は明記する。
- 最終報告に変更内容、検証結果、追加ファイルのパス、利用開始方法を記載する。

## Review follow-up

- 広告終了後に null を挟んで字幕が戻る際の重複を防ぐ。
- 手動履歴消去でライブ翻訳を無効化せず、削除済み履歴だけを保護する。
- 単語解説・IPA の応答にポップアップ単位の有効性確認を追加する。
- プレイヤー内の長いポップアップへ高さ制限とスクロールを追加する。

## Completion evidence

- 初回: 関連8ファイル93テスト成功。
- レビュー修正後: 関連5ファイル70テスト成功、型チェック・差分チェック成功。
- 独立した再レビュー: 4指摘すべて対応済み、新たな重要問題なし。
- `npm run build` を1回のみ実行して成功（esbuild 15ms）。`dist/` を更新。
- 拡張管理画面はブラウザーポリシーでアクセスを拒否されたため、自動再読み込みは行っていない。拡張再読み込み後の実サイト動作は未確認。
