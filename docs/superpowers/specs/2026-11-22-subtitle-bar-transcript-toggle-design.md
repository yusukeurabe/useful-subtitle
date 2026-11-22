# 字幕下のボタン群に字幕リスト開閉ボタンを追加する — 設計

## 目的
動画上の字幕の下にあるボタン群から、右端の字幕リスト（Transcript History パネル）を開閉できるようにする。
右上の ☰ まで手を伸ばさずに、字幕の近くでリストを出し入れできるようにする。

## 並びと配置
- 並び: `[↺5] [↺10] [▶/⏸] [≡ 新ボタン] [⠿ つまみ]`
- 再生/一時停止ボタン（幅 44px）の中心は画面中央のまま。
  バーの右端を `50% + 98px` に合わせる（98 = 再生ボタン幅の半分 22 + すき間 6 + 新ボタン幅 36 + すき間 6 + つまみ幅 28）。
- 字幕リスト自体が設定でオフ（`showTranscriptPanel: false`）のときは新ボタンを出さず、
  右端は従来どおり `50% + 56px`。

## 見た目
- 既存アイコンと同じ線画 SVG（横線3本のリストアイコン）。幅 36px、高さ 32px。
- 字幕リストを開いている間は青く点灯（`.open` クラス、`aria-pressed="true"`）。
- title / aria-label: 閉じているとき「字幕リストを開く」、開いているとき「字幕リストを閉じる」。

## 動き
- 押すと字幕リストを開閉する（開いていれば閉じ、閉じていれば開く）。
- リスト内の Close や右上の ☰ で開閉したときも、新ボタンの点灯状態が追従する。
- 既存の右上 ☰（ドラッグで移動できる再表示ボタン）はそのまま残す。
- 他のボタンと同じく、mousedown の既定動作を止めてフォーカスを取らない（直後の Space で再度押されない）。
- 押したとき、開いている単語ポップアップは閉じる（再生は再開しない）。

## 構成
- `icons.ts`: `createListIcon()` を追加。
- `overlay.ts`:
  - `OverlayCallbacks.onToggleTranscript?: () => void` を追加。指定時のみ新ボタンを作り、バーに `.has-list` を付ける。
  - `Overlay.setTranscriptOpen(open: boolean)` を追加（点灯状態とラベルを切り替える）。
  - CSS: `.list-toggle`（幅 36px）、`.list-toggle.open`（青）、`.rewind-bar.has-list`（右端 98px）。
- `transcriptPanel.ts`:
  - `TranscriptPanelCallbacks.onOpenChange?: (open: boolean) => void` を追加。パネルの開閉（Close / ☰ / 外部から）のたびに通知。
  - `TranscriptPanel.toggleOpen()` を追加。既存の `setVisible`（ページ単位でホスト全体を出し入れする）とは別物。
- `index.ts`: 字幕リストがあるときだけ `onToggleTranscript: () => panel?.toggleOpen()` を渡し、
  `onOpenChange: (open) => overlay.setTranscriptOpen(open)` でつなぐ。

## テスト
- overlay: 並び順、onToggleTranscript 未指定時はボタン無し＆ `.has-list` 無し、クリックで呼ばれる、
  setTranscriptOpen で点灯・ラベル切替、mousedown の既定動作停止、ポップアップを閉じる、CSS の 98px / 36px。
- transcriptPanel: toggleOpen で開閉し onOpenChange が呼ばれる、Close / ☰ でも呼ばれる。
