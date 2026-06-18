# Useful Subtitle — Prime Video 英語学習字幕

Amazon Prime Video の字幕の **単語・フレーズ・イディオム** をクリックすると、**Claude（Anthropic）が文脈に沿った日本語解説** をその場で表示する Chrome 拡張機能です。

> Language Reactor の Prime Video 版を目指した個人用ツール（非公式。Amazon / Anthropic とは無関係）。

## 主な機能

- 字幕の単語クリック → 意味をポップアップ表示（日本語）
- フレーズ／イディオムはドラッグで範囲選択 → 解説
- クリックで動画を自動一時停止
- 字幕一文の日本語訳を併記（デュアル字幕）

## 仕組み

- Prime Video が描画する字幕テキスト（`.atvwebplayersdk-captions-text`）を `MutationObserver` で読み取り、クリック可能なカスタム字幕に置き換え
- 解説・翻訳は Anthropic Messages API（既定: Claude Haiku）を拡張機能の Service Worker から直接呼び出し
- **API キーはご自身のもの** を設定画面に保存（`chrome.storage.local`、ブラウザ内のみ）

## セットアップ

```bash
npm install
npm run build      # esbuild → dist/
```

1. Chrome の `chrome://extensions` → デベロッパーモード ON
2. 「パッケージ化されていない拡張機能を読み込む」→ `dist/` を選択
3. ツールバーのアイコンから設定を開き、Anthropic API キー（<https://console.anthropic.com> で取得）を入力 →「接続テスト」

## 使い方

1. Prime Video で作品を再生し、**英語字幕を ON**
2. 単語クリック／フレーズをドラッグ選択 → 解説ポップアップ（`×` / Esc / 外側クリックで閉じる）

## 費用の目安

- デュアル字幕 ON（毎行翻訳）: おおよそ 1 作品 ¥50〜100 程度
- クリックした語句のみ（デュアル字幕 OFF）: ほぼ無料〜数円
- 同一字幕はキャッシュされ再課金されません

## 開発

```bash
npm test           # ユニットテスト（vitest）
npm run typecheck  # tsc --noEmit
npm run build      # esbuild → dist/
```

主要ロジック（プロンプト生成・設定・キャッシュ・API クライアント・メッセージ処理・字幕抽出・トークナイズ）は TDD で実装。DOM/UI 層は実機での動作確認を前提とする。

## 注意・既知の制約

- Amazon のプレイヤー更新で字幕セレクタが変わると動作しなくなる可能性があります（`src/shared/selectors.ts` のフォールバックで吸収を試みます）
- 字幕がオフだと読み取れません（再生側で英語字幕を ON にしてください）
- 字幕テキスト・選択語句は解説のため Anthropic API に送信されます

## ライセンス

未設定（必要に応じて追加してください）。
