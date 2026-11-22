# 字幕の下に 5 秒・10 秒の巻き戻しボタンを付ける — 設計

日付: 2026-11-22

## 目的

聞き逃したセリフをすぐ聞き直せるように、動画上の字幕の真下に「5 秒戻る」「10 秒戻る」ボタンを置く。

## 決定事項（ユーザー確認済み）

| 項目 | 決定 |
|---|---|
| 配置 | 字幕の真下・中央に「↺5」「↺10」を横並び。字幕下端とのすき間は約 4px |
| 位置の追従 | 字幕を ▲▼・つまみで動かすと一緒に動く |
| 字幕が消えている間 | 最初の字幕（`renderLine`）が出てから表示し、以降は字幕の合間も同じ場所に残る（セリフ直後の「聞き逃した」に押せるように）。最初の字幕までは隠すので Prime のホーム・詳細ページには出ない |
| 見た目 | 普段はうっすら（不透明度 0.35）。字幕かボタンにカーソルを乗せると 0.9 |
| 押した後 | 現在位置から 5/10 秒前へ移動して再生する（0 秒未満は 0 秒）。既存の ▶・履歴クリックと同じ `seekVideo` の再生処理を使う |
| 対象 | Prime Video と YouTube。全画面でも表示（既存オーバーレイのマウントに乗る） |

## 構成

### `src/content/overlay.ts`

- `.subtitle` とは別要素の `.rewind-bar`（ボタン 2 つを横に並べる div）を shadow 内、`.subtitle` の直後に置く。
  - `.subtitle` の子にしない理由: `.subtitle` は字幕の合間に `hidden` になるため、ボタンも消えてしまう。
  - そのため `.rewind-bar` にカーソルを乗せても字幕ホバー一時停止（`onHoverStart`）は発火しない。
- 位置: `bottom: max(4px, calc(<bottomPercent>% - 36px))`、`left: 50%; transform: translateX(-50%)`。
  36px = ボタン高さ 32px + すき間 4px。`applyBottom()` で字幕と同時に更新するので、▲▼・つまみドラッグ・初期値すべてに追従する。
  字幕を最下段（2%）付近まで下げると `max(4px, …)` で止まり、字幕と少し重なる（許容）。
- YouTube では字幕と同じく `position: absolute`（ホストがプレイヤー内に absolute で入るため）。
- 見た目: 既存の `.pos-btn` と同系（黒 60% 背景・白文字・角丸 6px・ホバーで青）。ボタンは幅 auto、高さ 32px。
  不透明度は `.rewind-bar { opacity: 0.35 }`、`.subtitle:hover ~ .rewind-bar, .rewind-bar:hover { opacity: 0.9 }`。
- 表示: `.rewind-bar` は `hidden` で作り、`renderLine` で `hidden = false`。`clearLine` では隠さない。`display: flex` が `hidden` に勝つので `.rewind-bar[hidden] { display: none; }` を足す。
- ボタン: `↺5`（title「5秒戻る」）、`↺10`（title「10秒戻る」）。クリックで開いている単語ポップアップを `hidePopup(false)` で閉じてから `callbacks.onRewind(5 | 10)`。
  `mousedown` で `preventDefault()` してフォーカスを取らない（取ると押した後の Space で一時停止のつもりがボタンが再度押される）。
- `OverlayCallbacks` に `onRewind?: (seconds: number) => void` を追加（任意。未指定なら何もしない）。

### `src/content/videoControl.ts`

- `rewindVideo(seconds: number): void` を追加。`findVideo()` を 1 回だけ呼び、その要素の `currentTime - seconds` へシーク＋再生する。
- `seekVideo` の中身（要素を受けてシーク＋`resumeVideo`＋`seeked` で再 play）を内部関数 `seekElement(v, seconds)` に切り出し、`seekVideo` と `rewindVideo` で共有する（findVideo の二度引きによる取り違えを避ける）。

### `src/content/index.ts`

- `createOverlay` のコールバック（Prime・YouTube 共通の 1 箇所）に `onRewind: rewindVideo` を渡す。

## エラー・端の扱い

- 動画が見つからない（YouTube の広告中など）: 何もしない。
- 0 秒より前: `seekElement` の `Math.max(0, …)` で 0 秒。
- 字幕ホバー一時停止との関係: ボタンは字幕枠外なので一時停止されない。字幕からボタンへ移ると mouseleave で再開され、その後クリックで巻き戻して再生となる（矛盾なし）。

## テスト

- `tests/videoControl.test.ts`: `rewindVideo(5)` で `currentTime` が 5 秒減って play が呼ばれる／0 秒未満は 0／動画無しで例外なし。
- `tests/overlay.test.ts`: `.rewind-bar` に 2 ボタンがあり、クリックで `onRewind(5)`・`onRewind(10)`／作成直後は隠れていて `renderLine` で表示、`clearLine` 後も表示されたまま（`[hidden]` で `display: none` の CSS あり）／`mousedown` の既定動作を止める／クリックで単語ポップアップが閉じる／▲▼で字幕を動かすとバーの `bottom` も更新される。
- `tests/youtube.test.ts`: YouTube では `.rewind-bar` が `position: absolute`。

## バージョン

PR 作成時に新機能として `0.3.0 → 0.4.0`（manifest.json・package.json）。
