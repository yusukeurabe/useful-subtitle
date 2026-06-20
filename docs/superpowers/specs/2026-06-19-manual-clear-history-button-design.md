# 履歴の手動消去ボタン 設計

**日付:** 2026-06-19
**ブランチ:** `fix/reset-history-on-video-switch`（自動切替リセットと同ブランチに追加）

## ゴール

字幕履歴パネルのヘッダーに「履歴をすべて消す」ボタン（🗑）を置き、**ワンクリックで履歴を全消去**する。
消去後は、**押した後に再生された字幕から順に履歴へ再蓄積**される。

## 方針（採用＝コールバック方式）

既存の `onSeek` / `onExplain` と同じ「**パネルはコールバックを呼ぶだけ、ロジックは `index.ts` が束ねる**」作法に合わせる。

- `TranscriptPanelCallbacks` に `onClearHistory?: () => void` を追加。
- ヘッダーの「×」の**左隣**に消去ボタン（🗑）。クリックで `cb.onClearHistory?.()` を呼ぶ。
- `onClearHistory` が**未指定ならボタンを描画しない**（`onExplain` と同じく機能のオン/オフ）。
- `index.ts` で `onClearHistory: () => { panel.clear(); recorder.reset(); }` を渡す。
  → 自動切替（`maybeResetForNewTitle`）と**同じ `clear()`＋`reset()` の組**になり、押下後の字幕から記録が再開する。

### 不採用案
- **B**: パネル内で `clear()` を直接実行し、`reset()` 用に別コールバック → ロジックが2か所に分散。
- **C**: パネルに `recorder` を注入 → 責務が混ざりテストしにくい。

## なぜ `clear()` だけでなく `recorder.reset()` も呼ぶか

履歴は「巻き戻し重複」を防ぐため、記録済みの最大再生位置（フロンティア `maxRecordedTime`）を保持し、
`videoTime > フロンティア` の前進だけを新規記録する（`transcriptRecorder.ts`）。
`clear()` だけでフロンティアを残すと、**巻き戻して過去を見ている最中に消した場合**、
押下後しばらく（フロンティアを追い越すまで）記録が再開しない不整合が起きる。
`recorder.reset()` でフロンティアを初期化すれば、**押下位置以降の字幕が常に記録**される。

## コンポーネント / ファイル

### 1. `src/content/transcriptPanel.ts`（修正）
- `TranscriptPanelCallbacks` に `onClearHistory?: () => void` を追加。
- ヘッダー（`header`）の「×」の左隣に消去ボタン（`.clear`）を追加。`title="履歴をすべて消す"`。
  `onClearHistory` が指定されたときだけ生成・表示し、クリックで `cb.onClearHistory?.()` を呼ぶ。
- `STYLES` に消去ボタンのスタイル（「×」と同系統＝`#aaa`、hover で明るく）。
- 既存の公開 `clear()`（実装済み）はそのまま利用。インターフェースの変更はコールバック追加のみ。

### 2. `src/content/index.ts`（修正・配線）
- `recorder` の生成を `panel` 生成より**前**へ移動する。
- `panel` を `let panel: TranscriptPanel | null = null;` にする（`overlay` と同じ「先に宣言→後で代入」パターン。
  コールバックが `panel` 自身を参照する前方参照を避ける）。
- `const clearHistory = (): void => { panel?.clear(); recorder.reset(); };` を定義し、
  `createTranscriptPanel({ ..., onClearHistory: clearHistory })` で渡す。
- 既存の自動切替（`titleSwitch` / `maybeResetForNewTitle`）と重複記録ポリシーはそのまま。

## 見た目

```
┌─────────────────────────────┐
│ 字幕の履歴            🗑   × │   ← 🗑 を × の左隣に
├─────────────────────────────┤
│ ... 履歴の行 ...             │
```

- 🗑（ゴミ箱アイコン）。色は既存の「×」と同系統（`#aaa`、hover で明るく）。

## 挙動

- ボタン押下 → 履歴が空＋フロンティア初期化 → **押下後に再生された字幕から順に追加**。
- 厳密には「押下後に**次へ変わった**字幕」から記録（実用上「押下後から」と同じ）。
- **全画面再生中でも動作**（ブラウザ標準の確認ダイアログを使わないため）。
- 既存の自動切替クリアとは独立。干渉なし。

## テスト（TDD）

### `tests/transcriptPanel.test.ts`（追記・jsdom）
- `onClearHistory` 指定時、ヘッダーに消去ボタンが表示される。
- 消去ボタンをクリックすると `onClearHistory` が1回呼ばれる。
- `onClearHistory` 未指定なら消去ボタンは表示されない。

（`clear()` 自体の挙動＝行消去・clear 後の no-op 等は**既存テストでカバー済み**。
`recorder.reset()` との連携は `index.ts` の結線＝型チェック・ビルド・実機で検証。）

### 手動（実機）
- 履歴が数行ある状態で 🗑 → 履歴が空。その後の字幕から順に再蓄積される。
- 全画面再生中でも 🗑 が効く。

## 非ゴール（YAGNI）

- 確認ダイアログは付けない（ワンクリック即消去。消しても再生で再蓄積されるため）。
- 「消す/残す」の設定項目は追加しない。
- 消去した履歴の復元（undo）はしない。

## 反映（ビルド/リロード）

- watch ビルド（`npm run dev`）で `dist` を再ビルド。拡張の再読み込み（↻）＋ページ再読み込み（F5）の両方（MV3 仕様）。
