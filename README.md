# Useful Subtitle — Prime Video・YouTube 英語学習字幕

Amazon Prime Video・YouTube の字幕の **単語・フレーズ・イディオム** をクリックすると、**Claude（Anthropic）が文脈に沿った日本語解説** をその場で表示する Chrome 拡張機能です。

> 個人用の英語学習ツール（非公式。Amazon / Google / Anthropic とは無関係）。

## 主な機能

- 字幕の単語クリック → 意味をポップアップ表示（日本語）
- フレーズ／イディオムはドラッグで範囲選択 → 解説
- クリックで動画を自動一時停止
- 字幕一文の日本語訳を併記（デュアル字幕）

## 仕組み

- Prime Video（`.atvwebplayersdk-captions-text`）または YouTube の標準プレイヤー（`#movie_player` 内の `.ytp-caption-segment`）が描画する字幕テキストを `MutationObserver` で読み取り、クリック可能なカスタム字幕に置き換え
- 解説・翻訳は Anthropic Messages API（既定: Claude Haiku 5.5 / `claude-haiku-5-5`）を拡張機能の Service Worker から直接呼び出し
- **API キーはご自身のもの** を設定画面に保存（`chrome.storage.local`、ブラウザ内のみ）

## セットアップ

```bash
npm install
npm run build      # esbuild → dist/
```

1. Chrome の `chrome://extensions` → デベロッパーモード ON
2. 「パッケージ化されていない拡張機能を読み込む」→ `dist/` を選択
3. ツールバーのアイコンから設定を開き、Anthropic API キー（<https://console.anthropic.com> で取得）を入力 →「接続テスト」

既存利用者は更新後に拡張機能を再読み込みしてください。保存済みの旧既定モデル（`claude-haiku-4-5-20251001` / `claude-haiku-4-5`）は次回の設定読み込み時に Haiku 5.5 へ自動移行します。API キー・その他の設定・カスタムモデルは維持します。

## 使い方

1. Prime Video または YouTube の通常の動画ページ（`/watch?v=...`）で再生し、**英語字幕を ON**
2. YouTube では Language Reactor など他の字幕拡張を OFF にする（表示の重複・字幕取得の競合を防ぐ）
3. 単語クリック／フレーズをドラッグ選択 → 解説ポップアップ（`×` / Esc / 外側クリックで閉じる）

## 費用の目安

- 費用は選択したモデル、送受信するトークン数、翻訳・解説の回数に応じて変わります。
- デュアル字幕を OFF にすると、自動翻訳の API 呼び出しを減らせます。
- キャッシュに残っている同一リクエストは API を呼び出しません（モデルを変更すると別のキャッシュになります）。

## 開発

```bash
npm test           # ユニットテスト（vitest）
npm run typecheck  # tsc --noEmit
npm run build      # esbuild → dist/
```

主要ロジック（プロンプト生成・設定・キャッシュ・API クライアント・メッセージ処理・字幕抽出・トークナイズ）は TDD で実装。DOM/UI 層は実機での動作確認を前提とする。

## 注意・既知の制約

- YouTube はデスクトップ版 `www.youtube.com` / `youtube.com` の通常動画が対象です。ホームからのページ内遷移にも対応します。Shorts・埋め込み・モバイル版は対象外です。
- 画面に現れた標準字幕だけを読みます。字幕のない動画、未再生部分の先読み、音声認識には対応しません。
- YouTube の広告中は取得・翻訳送信・履歴記録を止めます。同じ動画の広告や尺の変化では履歴を消さず、別の動画 ID へ移ると履歴をリセットします。
- YouTube の自動字幕は細かく更新されるため、履歴に途中の断片や重なる文章が残ることがあります。英語表示は即時更新し、翻訳送信は350ミリ秒まとめます（更新が続く場合は最大1.5秒待機）。途中の履歴には訳が付かない場合があります。API 応答時間も加わるため、更新が速い箇所では現在の字幕の訳が間に合わないことがあります。

- Amazon / YouTube のプレイヤー更新で字幕セレクタが変わると動作しなくなる可能性があります（`src/shared/selectors.ts` のフォールバックで吸収を試みます）
- 字幕がオフだと読み取れません（再生側で英語字幕を ON にしてください）
- 字幕テキスト・選択語句は解説のため Anthropic API に送信されます

## ライセンス

[MIT License](./LICENSE) — © 2026 Yusuke Urabe
