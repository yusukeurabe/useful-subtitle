# 字幕ホバーで一時停止 — 設計

日付: 2026-11-19

## 目的

動画上の字幕（overlay）にカーソルを乗せている間は動画を一時停止し、字幕をじっくり読めるようにする。カーソルを外したら再開する（Language Reactor と同様の体験）。

## 対象範囲

- 対象: 動画上の字幕（`overlay.ts` の `.subtitle` 枠全体。英文・訳・▶・▲▼ボタンを含む）と、そこから開く単語解説ポップアップ。
- 対象外: 右側の履歴パネル（`transcriptPanel.ts`）。
- Prime Video・YouTube の両方（YouTube 広告中は `findVideo()` が null を返すので何もしない）。

## 振る舞い

1. 字幕枠にカーソルが入ったとき、本編 video が**再生中なら**一時停止し、「ホバーで止めた video」として覚える。もともと停止中なら何もしない。
2. カーソルが字幕枠から外れたとき、ポップアップが開いていなければ、ホバーで止めた video が停止中のままなら再生を再開する。
3. 単語解説ポップアップが開いている間は「ホバー中」とみなし、再開しない。字幕枠 ↔ ポップアップ間の移動でも再開しない。
4. ポップアップを × / Esc で閉じたとき、カーソルが字幕枠の中に無ければ再開する（次の字幕描画・字幕消去・全画面の付け替えで閉じた場合は再開しない）。
5. ポップアップの**外側をクリック**して閉じた場合は再開しない（「ホバーで止めた」記録だけ消す）。Prime は動画クリックで再生/停止が切り替わるため、二重の切り替えを避けて操作をユーザーに委ねる。
6. ホバーで止めた video で `play` イベントが起き、その時点でまだ再生中なら（スペースキーや再生ボタン、▶ リプレイなどユーザー操作）、「ホバーで止めた」記録を消す。以後、手動で止め直しても外したときに勝手に再生しない。届いた時点で再び停止中の `play` イベント（自分の再開直後に止め直した後で遅れて届いたもの）は無視する。
8. 外した直後（再開を依頼したが、まだ再生が始まっていない間）に入り直した場合は、保留中の再開処理を取り消し、その video を「ホバーで止めた」記録に戻す。Prime が再開の `play()` を握り潰して停止のままでも、次に外したときに改めて再開する。再開が成功した後（再生中の `play` イベントを確認した後）にユーザーが止めた video は記録に戻さない。
7. 字幕が消えた（`clearLine`）ときは「字幕枠の中にいる」状態を解除し、再開は行わず、ホバーで止めた記録も消す（再開はユーザーの再生操作に委ねる）（停止中にキャプションが消えても再生と停止を繰り返さないようにするため）。

## 構成

### `src/content/hoverPause.ts`（新規）

判断ロジックだけを持つ部品。DOM 構造には依存せず、video を返す関数を受け取る。

```ts
export interface HoverPause {
  /** 字幕枠（またはポップアップ）にカーソルが入った。 */
  start(): void;
  /** ホバー状態が終わった。resume=false なら記録だけ消して再開しない。 */
  end(opts: { resume: boolean }): void;
}
export function createHoverPause(deps: {
  findVideo: () => HTMLVideoElement | null;
  resume: (v: HTMLVideoElement) => () => void;
}): HoverPause;
```

- `deps.resume` の型は `(v: HTMLVideoElement) => () => void`。戻り値は保留中の再開処理（Prime の再生ボタン押下）を取り消す関数で、再開済みや複数回の呼び出しでも安全であること。
- `play` リスナは `once` ではない。イベントが届いた時点で video がまだ再生中のときだけ記録を消す（`play()` は `paused` を即座に false にするが `play` イベントは後のタスクで届くため、自分の再開直後に止め直した記録を遅れたイベントで消さないようにする）。
- `start()`: まず保留中の再開を取り消す。既に記録済みなら何もしない。記録が無く、`end` で再開を依頼した video（`resumingVideo`）がまだ停止中かつページ上にあれば、`pause()` は呼ばずにそれを記録に戻し、`play` リスナを付ける（Prime が `play()` を握り潰した場合や、ボタン押下後に Prime が再生を始めるまでの間に入り直した場合の取りこぼし対策）。それ以外は、`findVideo()` が再生中なら `pause()` し、記録してその video に `play` リスナを付ける。`resumingVideo` は `start()` のたびに必ず消す。
- `end({resume})`: 記録が無ければ何もしない。リスナを外して記録を消し、`resume && v.paused && v.isConnected` なら、その video を `resumingVideo` として覚えて `play` の見張りを付けてから `deps.resume(v)` を呼び、戻り値の取り消し関数を保持する。
- `resumingVideo` は、その video で `play` が届いた時点で再生中なら（再開が本当に成功したら）見張りごと消す。これにより、再開成功後にユーザーが手動で止めた video を入り直しで誤って記録し直すことはない。

### `src/content/videoControl.ts`

- `resumeVideo(v)` を追加: `play()` し、200ms 後もまだ停止中なら（YouTube 以外で）Prime の再生ボタンを押す。Prime が生の `play()` を無視する場合に備えたもの。戻り値はボタン押下の待ちを取り消す関数（`hoverPause` が入り直し時に呼ぶ）。
- `seekVideo` は、シーク後に `resumeVideo` で再生し、さらにシーク完了（`seeked`）時にもう一度 `play()` する。

### `src/content/overlay.ts`

- `OverlayCallbacks` に任意の `onHoverStart?: () => void` と `onHoverEnd?: (opts: { resume: boolean }) => void` を追加。
- `.subtitle` の `mouseenter` で `inSubtitle = true` にして `onHoverStart` を呼ぶ。`mouseleave` では `inSubtitle = false` にし、ポップアップが無ければ `onHoverEnd({resume: true})` を呼ぶ。
- `hidePopup` で、実際にポップアップを閉じた場合は、`inSubtitle` でなければ `onHoverEnd` を呼ぶ。× / Esc のときは `resume: true`、外側クリック（`onDocMouseDown`）・次の字幕描画（`renderLine`）・`clearLine`・全画面の付け替え（`attach`）・`destroy` のときは `resume: false`。
- `clearLine` では、字幕枠の中にいてポップアップが無ければ `onHoverEnd({resume: false})` を通知してから `inSubtitle = false` にする（ポップアップがあれば `hidePopup(false)` が同じ通知を送る）。再開はしない。ドラッグ状態（`dragging`）も解除する（枠外へはみ出したドラッグ中に字幕が消えた後の `mouseup` で `resume: true` を送らないため）。`mouseleave` は `inSubtitle` が false なら無視する（隠した字幕に後から届く `mouseleave` で再開しないため）。
- フレーズのドラッグ選択中は `mouseleave` を通知せず、`mouseup` 時に字幕枠外かつポップアップ無しなら `onHoverEnd({resume: true})` を通知する。
- ▲▼ ボタンと字幕枠の間のすき間は当たり判定でつなぐ（すき間を通るたびに再生が一瞬動くのを防ぐ）。`.pos-controls` の `padding-left: 12px` は `right: -44px` からボタン幅 32px を引いた値なので、片方を変えたらもう片方も合わせる。

### `src/content/index.ts`

- `settings.pauseOnSubtitleHover` が true のときだけ `createHoverPause({ findVideo, resume: resumeVideo })` を作り、overlay の `onHoverStart` / `onHoverEnd` につなぐ。

### 設定

- `Settings.pauseOnSubtitleHover: boolean`（既定値 `true`）を `types.ts` と `settings.ts` に追加する。
- 設定画面（`options.html` / `options.ts`）の「単語クリックで動画を自動一時停止」の直後に、チェックボックス `pauseOnHover`「字幕にカーソルを乗せている間は一時停止（無料・即時）」を追加する。
- 反映は既存の設定と同じく、動画タブの再読み込み後。設定画面のスイッチ群の後の注記にもその旨を書く。

## テスト

- `tests/hoverPause.test.ts`（新規）: 再生中→停止→再開、もともと停止中なら触らない、`resume:false` で再開しない、`play` イベント後は再開しない、二重の `start` に耐える、video が無いとき・ページから外れたときは何もしない、再開直後の `start` で保留中の再開を取り消して止め直す、遅れて届く `play` イベントで記録を消さない、Prime が `play()` を握り潰した直後に入り直しても外したときに再開する、再開成功後に手動で止めた video は記録し直さない。
- `tests/overlay.test.ts`: `mouseenter`/`mouseleave` でのコールバック、ポップアップが開いている間は `onHoverEnd` を呼ばない、× / Esc で閉じると `resume:true`、外側の mousedown で閉じると `resume:false`、`clearLine`・次の字幕描画・`destroy` では `resume:false` だけを送る（`clearLine` 後に遅れて届く `mouseleave` でも再開しない）、枠外へはみ出すドラッグ中は通知せず `mouseup` で通知する、ドラッグ中に `clearLine` された後の `mouseup` では `resume:true` を送らない。
- `tests/videoControl.test.ts`: `resumeVideo` のフォールバック（200ms 後のボタン押下、再生済みなら押さない、戻り値で取り消せる）。
- `tests/settings.test.ts` / `tests/options.test.ts`: 既定値 ON、チェックボックスの読み込みと保存。
- 実行するのは対象ファイルの vitest と `tsc --noEmit` だけ（全件の連続実行はしない）。実機確認は拡張の ↻ とページの F5 のあと、ユーザーに依頼する。
