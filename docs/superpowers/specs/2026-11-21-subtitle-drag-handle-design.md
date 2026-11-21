# 字幕をつまみのドラッグで上下に動かす — 設計

## 目的

字幕の縦位置を、右端の ▲▼ ボタン（1 回 6% ずつ）だけでなく、ドラッグで好きな位置へ一度に動かせるようにする。

## 決定事項

- **つかむ場所は専用のつまみ「⠿」だけ**。字幕の単語の上をドラッグすると既存の「フレーズ選択」になるため、字幕本体はつかめる場所にしない。
- ▲▼ ボタンは残す。

## 見た目

- `.pos-controls`（右端の縦並び）を ▲ / ⠿ / ▼ の順にする。
- つまみは `.pos-handle`。ほかのボタンと同じく、ふだんは `.pos-controls` の薄い表示（opacity 0.2）、字幕ホバーで濃く（0.9）なる。
- カーソルは `ns-resize`（上下矢印）。`title` は「ドラッグで字幕を上下に移動」。
- `.pos-controls` の `padding-left: 12px` と `right: -44px` の関係（字幕枠とのすき間を埋める）は変えない。つまみの幅もボタンと同じ 32px にそろえる。

## 動き

- つまみで左ボタンを押す（`pointerdown`, `button === 0`）とドラッグ開始。押した時点の `clientY` と `bottomPercent` を覚える。
- 移動量 `dy = clientY - startY`（下向きが正）を、基準枠の高さに対する％に直して位置を決める:
  `bottomPercent = clamp(startBottom - dy / 基準枠の高さ * 100, 2, 85)`
  - 基準枠は `host.getBoundingClientRect()`。Prime は `position:fixed; inset:0` なのでビューポート、YouTube はプレイヤー枠になる（今の `bottom: X%` の基準と同じ）。
  - 高さが 0 の場合は動かさない（ゼロ除算を避ける）。
- ドラッグ中は見た目（`subtitle.style.bottom`）だけを更新し、保存しない。
- 手を離したとき（`pointerup`）と、中断されたとき（`pointercancel`）に、位置が開始時から変わっていれば `onBottomChange` を **1 回だけ**呼ぶ。中断時も「見えている位置」をそのまま保存する。
- 範囲の上限・下限 2% / 85% は ▲▼ と共通の定数を使う。

## イベントの受け方

- `pointermove` / `pointerup` / `pointercancel` はドラッグ中だけ `document` に capture で登録し、終わったら外す。
  - 要素の `setPointerCapture` は使わない。再生中はセリフの合間に `clearLine` で字幕が隠れ、隠れた要素はポインタキャプチャを失ってドラッグが途切れるため。
  - `document` で受けていれば、字幕が隠れていてもドラッグは続き、`bottomPercent` が更新される。次の `renderLine` で字幕は新しい位置に出る（`bottom` は字幕要素のスタイルなので隠れていても保持される）。
- `pointermove` が `buttons === 0`（ボタンが離されている）で来たら、`pointerup` を取りこぼしたとみなし、`pointerup` と同じ手順でドラッグを終える（変わっていれば保存し、ホバー終了の判定もする）。
- `pointerdown` では `preventDefault()` と `stopPropagation()` を呼ぶ。pointerdown 由来の再生/停止の切り替えや文字選択を起こさないため。
- `destroy()` の時点でドラッグ中なら、`document` のリスナーを外す（保存はしない）。

## 周りの機能との関係

- **単語の意味ポップアップ**：ドラッグ開始時に開いていれば `hidePopup(false)` で閉じる。字幕だけ動いてポップアップが取り残されるのを防ぐ。つまみは字幕枠の中にあるので `inSubtitle` は true のままで、ホバー終了は通知されない。
- **字幕ホバーで一時停止**：ドラッグ中は字幕の `mouseleave` を無視する（`if (dragging || posDrag) return;`）。手を離したとき、カーソルが字幕枠の外にあり、ポップアップも開いていなければ、`onHoverEnd({ resume: true })` を 1 回送る。
  - 理由：つまみの幅は 32px しかないので、上下にドラッグしながら横にずれたり、2% / 85% の上限・下限に当たって字幕が止まったりすると、カーソルが字幕枠から出てしまう。何もしないとドラッグの途中で再生が始まってしまう。
  - ドラッグ中に `clearLine` があった場合は、`clearLine` がその時点で `resume:false` を送って一時停止の記録を消している。そのため、離したときの `resume:true` は hoverPause 側では何もしない。
- **フレーズ選択のドラッグ（`dragging` 変数）**：つまみのドラッグとは別の状態変数（例: `posDrag`）で持ち、混ぜない。
- **▲▼**：今までどおり。

## テスト（`tests/overlay.test.ts`, jsdom）

jsdom 29 は `PointerEvent` を持つ。`host.getBoundingClientRect` をテスト内で高さ固定の値に差し替えて検証する。

1. つまみ（`.pos-handle`）が ▲ と ▼ の間に描画される。
2. つまみを上へ 100px ドラッグ（高さ 1000px）すると `bottom` が 10% → 20% になる。
3. 下限 2% / 上限 85% を超えない。
4. ドラッグ中は `onBottomChange` が呼ばれず、`pointerup` で最終値が 1 回だけ渡る。動かさずに離したときは呼ばれない。
5. ドラッグ中に `clearLine()` で字幕が隠れても、続く `pointermove` で位置が更新され、`pointerup` で保存される。
6. ドラッグ開始でポップアップが閉じる。
7. `pointerdown` が `defaultPrevented` になる。
8. ホバーとの関係：ドラッグ中に字幕枠を出ても `onHoverEnd` は呼ばれず、離したときに `{ resume: true }` が 1 回だけ渡る。枠から出ずに離したときは呼ばれない。
9. `pointerup` の取りこぼし：`buttons === 0` の `pointermove` でドラッグが終わり、見えている位置が 1 回保存され、その後の移動では動かない。
10. ドラッグ中の `destroy()`：その後の `pointermove` / `pointerup` で保存も例外も起きない。
11. ドラッグ中に `clearLine()` してから字幕枠を出て離すと、`onHoverEnd` が `[{ resume: false }, { resume: true }]` の順に呼ばれる。

## 実機確認

- Prime Video と YouTube で、つまみをドラッグして字幕が動くこと、リロード後も位置が残ること、再生中に字幕が切り替わってもドラッグが続くことを確かめる。
- Prime の全画面で、つまみをドラッグしても再生/停止が切り替わらないこと。
- 下限 2% まで下げても、▼ が見えていて押せること。
- 拡張は `dist` を再ビルドし、拡張の ↻ とページの再読み込みで反映する（worktree の `dist` を読み込む点に注意）。

## バージョン

新機能なので、PR 作成時に 0.2.1 → 0.3.0（`manifest.json` と `package.json`）。
