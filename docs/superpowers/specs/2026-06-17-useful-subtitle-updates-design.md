# Useful Subtitle 4点アップデート 設計

- 日付: 2026-06-17
- 対象: useful-subtitle（Prime Video 英語学習字幕 Chrome 拡張、MV3）

## 1. 背景と目的

拡張の利用者から、3つの不満と1つの要望が出た。

1. ドラッグで複数語を範囲選択して解説できない（1単語のクリックは動作する）
2. 字幕がすべて大文字で表示され、固有名詞と一般語の見分けがつかない
3. 字幕の縦位置を動かせない（画面下に固定）
4. （要望）Language Reactor のような右側トランスクリプト表示

これらを解消し、視聴・学習体験を改善する。

## 2. スコープ

### 今回やる
- 機能1: ドラッグ範囲選択の修正
- 機能2: 大小文字の復元（**簡易版・ローカル処理・無料・即時**）
- 機能3: 字幕の縦位置を上下ボタンで調整
- 機能4: 過去の字幕履歴パネル（右側）

### 今回やらない（将来検討）
- **先読みトランスクリプト**（これから出る未来の字幕）。Prime Video の字幕ファイル全体を取得する大掛かりな仕組みが必要で、実現可否の技術調査から要する。
- **AI 版の高精度 truecasing**。毎行 API による費用・ラグ・チラつきのため、利用者の判断で見送り。
- 履歴のページ跨ぎ永続化（リロードで消えてよい）。

## 3. 機能別設計

### 機能1: ドラッグ範囲選択の修正

**現状と原因**
`overlay.ts` は各単語 span の `mouseenter` でドラッグ範囲を追従しているが、Prime Video プレイヤー上ではこのイベントが取りこぼされ、1単語しか選択できない。

**修正方針**
`mouseenter` 依存をやめ、**マウス座標から対象単語を直接判定**する方式に変える。
- 単語 span の `mousedown` でドラッグ開始（開始インデックスを記録、`dragging=true`）。
- `document` に `mousemove`（capture）を登録し、ドラッグ中は `shadow.elementFromPoint(clientX, clientY)` で現在ホバー中の要素を取得 → それが単語 span なら、そのインデックスまでをハイライト。
- `document` の `mouseup`（既存）で範囲を確定し `onLookup` を呼ぶ。
- 単語 span に索引を持たせる（`dataset.index` または既存 `wordRefs` 配列との突き合わせ）。
- 1単語クリック（mousedown→同一語で mouseup）の挙動は従来通り維持。

**変更ファイル**: `src/content/overlay.ts`
**検証**: 座標ベースのため実機（Prime Video）でドラッグ確認。

### 機能2: 大小文字の復元（簡易版）

**方針**
AI を使わず、**ブラウザ内のローカル処理**で ALL CAPS を自然な大小文字へ整形する。費用ゼロ・ラグゼロ・完全リアルタイム。

**整形ルール**
1. 文全体を小文字化する。
2. 文の先頭、および文末記号（`. ! ?`）の後の最初の英字を大文字化する。
3. 一人称 `I` と短縮形（`I'm` `I'll` `I've` `I'd`）の `i` を大文字化する。

**例**
入力: `MY NAME IS JOHN AND I LIVE IN LONDON.`
出力: `My name is john and I live in london.`
→ 文頭 `My`・一人称 `I` は大文字。ただし固有名詞 `john` `london` は小文字のまま（**機械的に固有名詞を判定できないため。利用者了承済みの限界**）。それでも「全部大文字」より大幅に読みやすい。

> 初版は上記の基本ルールのみ。曜日・月名などの最小辞書による固有名詞の救済は将来の改善余地とする（YAGNI）。

**適用範囲**
字幕テキスト取得直後に truecase を通し、その結果を**画面表示・履歴パネル・AI への送信（解説/翻訳）すべてで統一して使う**。これにより整形版に一本化する。

**設定**: `truecaseSubtitle: boolean`（既定 `true`）。設定画面にトグルを追加。無料処理のため費用注記は不要。

**新規ファイル**: `src/shared/truecase.ts`（純関数、TDD）
**テスト**: `tests/truecase.test.ts`

### 機能3: 字幕の縦位置ボタン

**UI**
カスタム字幕ブロックの端に小さな **▲▼ボタン**を表示。クリックで字幕を上下に移動する。普段は薄く表示し、視聴の邪魔を抑える。

**挙動**
- 縦位置を `bottom`（％）で管理。▲で上へ、▼で下へ一定幅ずつ移動。
- 上下限を制限（例: 2%〜85%）して画面外に出ないようにする。
- 変更後の位置を保存し、次回起動時に復元。

**設定**: `subtitleBottomPercent: number`（既定 `12`）
**変更ファイル**: `src/content/overlay.ts`, `src/shared/settings.ts`, `src/shared/types.ts`

### 機能4: 過去の字幕履歴パネル

**レイアウト**
画面**右側に半透明の縦パネル**を配置。これまで流れた字幕を時系列でリスト表示する。全画面再生時も表示。

**各行の内容**
- 整形済み英文（truecase 適用後）
- 日本語訳（デュアル字幕 ON のとき。非同期で後から埋まる）

**挙動**
- 新しい字幕が来るたびに行を追加し、自動で最新までスクロール。
- 字幕行を記録する際、**その瞬間の動画再生位置（`video.currentTime`）を一緒に保持**。
- 各行クリックで `video.currentTime` をその値に戻し、**その場面まで巻き戻し**できる。
- パネルは**開閉ボタン**で隠せる。
- 履歴はページ表示中のメモリのみ保持（リロードで消える）。

**翻訳の同期**
各履歴エントリに一意 ID を持たせ、`translateLine` の非同期結果が返ったら ID で該当行の訳を更新する。

**設定**: `showTranscriptPanel: boolean`（既定 `true`）
**新規ファイル**: `src/content/transcriptPanel.ts`
**変更ファイル**: `src/content/index.ts`, `src/content/videoControl.ts`（シーク関数追加）

## 4. 全体アーキテクチャ

**新規ファイル**
- `src/shared/truecase.ts` — ローカル truecasing（純関数）
- `src/content/transcriptPanel.ts` — 右側履歴パネル
- `tests/truecase.test.ts` — truecase のユニットテスト

**変更ファイル**
- `src/content/overlay.ts` — 機能1（ドラッグ）, 機能3（位置ボタン）
- `src/content/index.ts` — truecase 適用・履歴連携・currentTime 記録
- `src/content/videoControl.ts` — シーク関数追加
- `src/shared/types.ts` — Settings に3項目追加
- `src/shared/settings.ts` — 既定値追加
- `src/options/options.html`, `src/options/options.ts` — 新設定トグルのUI

## 5. データフロー

```
[Prime Video 字幕 DOM]
      │ MutationObserver
      ▼
[captionObserver] → [index.ts] 字幕テキスト受信
      │
      ├─ truecaseSubtitle ON → truecase()（ローカル・即時）
      │
      ├─→ overlay.renderLine()        画面中央下に表示（クリック/ドラッグ可）
      ├─→ transcriptPanel.append()    右パネルに履歴追加（en + currentTime）
      └─ dualSubtitle ON → sendRequest(translateLine)（非同期・キャッシュ）
                                  │
                                  ▼
                 overlay.setTranslation() ＋ transcriptPanel 該当行の訳を更新
```

## 6. エラー処理・フォールバック

- **truecase**: 純粋な文字列処理。想定外入力でも例外を投げず、最悪は元に近い文字列を返す（表示が壊れない）。`truecaseSubtitle` OFF なら素通し。
- **翻訳 API 失敗**: 既存どおり訳なし。履歴パネルの訳欄は空のまま。
- **シーク**: `video` 要素が取得できなければ何もしない（コンソール警告のみ）。
- **位置保存失敗**: セッション内の見た目は反映済み。保存だけ失敗は許容。

## 7. テスト方針

- `tests/truecase.test.ts`（新規）: 全大文字入力、複数文、`I`/短縮形、アポストロフィ・ハイフン語、空文字、記号のみ、既に正しい大小文字、等を網羅。
- `tests/settings.test.ts`（更新）: 新設定3項目の既定値補完。
- DOM/UI 層（ドラッグ・位置ボタン・履歴パネル・シーク）は、README の方針どおり**実機での動作確認**を前提とする。

## 8. 実装順序

1. 機能2 truecase（純ロジック・TDD で土台を確実に）
2. 機能1 ドラッグ範囲選択の修正
3. 機能3 字幕の縦位置ボタン
4. 機能4 過去の字幕履歴パネル
5. ビルド・テスト・実機動作確認

各機能は独立性が高く、上から順に実装・確認できる。
