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
6. ホバーで止めた video で `play` イベントが起きたら（スペースキーや再生ボタン、▶ リプレイなどユーザー操作）、「ホバーで止めた」記録を消す。以後、手動で止め直しても外したときに勝手に再生しない。
7. 字幕が消えた（`clearLine`）ときは「字幕枠の中にいる」状態だけを内部的に解除し、再開は行わない（停止中にキャプションが消えても再生と停止を繰り返さないようにするため）。

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
  resume: (v: HTMLVideoElement) => void;
}): HoverPause;
```

- `start()`: 既に記録済みなら何もしない。`findVideo()` が再生中なら `pause()` し、記録してその video に `play` リスナ（once）を付ける。
- `end({resume})`: 記録が無ければ何もしない。リスナを外して記録を消し、`resume && v.paused && v.isConnected` なら `deps.resume(v)`。

### `src/content/videoControl.ts`

- `resumeVideo(v)` を追加: `play()` し、200ms 後もまだ停止中なら（YouTube 以外で）Prime の再生ボタンを押す。Prime が生の `play()` を無視する場合に備えたもの。`seekVideo` の手順 2・4 と同じ処理なので、`seekVideo` もこれを使う形に整理する（動作は変えない）。

### `src/content/overlay.ts`

- `OverlayCallbacks` に任意の `onHoverStart?: () => void` と `onHoverEnd?: (opts: { resume: boolean }) => void` を追加。
- `.subtitle` の `mouseenter` で `inSubtitle = true` にして `onHoverStart` を呼ぶ。`mouseleave` では `inSubtitle = false` にし、ポップアップが無ければ `onHoverEnd({resume: true})` を呼ぶ。
- `hidePopup` で、実際にポップアップを閉じた場合は、`inSubtitle` でなければ `onHoverEnd` を呼ぶ。外側クリック（`onDocMouseDown`）経由のときは `resume: false`、それ以外は `resume: true`。
- `clearLine` では `inSubtitle = false` にし、再開を伴うコールバックは呼ばない（ポップアップが開いていれば `resume: false` で閉じる）。全画面の付け替え（`attach`）と `destroy` で閉じる場合も `resume: false`。

### `src/content/index.ts`

- `settings.pauseOnSubtitleHover` が true のときだけ `createHoverPause({ findVideo, resume: resumeVideo })` を作り、overlay の `onHoverStart` / `onHoverEnd` につなぐ。

### 設定

- `Settings.pauseOnSubtitleHover: boolean`（既定値 `true`）を `types.ts` と `settings.ts` に追加する。
- 設定画面（`options.html` / `options.ts`）の「単語クリックで動画を自動一時停止」の直後に、チェックボックス `pauseOnHover`「字幕にカーソルを乗せている間は一時停止（無料・即時）」を追加する。
- 反映は既存の設定と同じく、動画タブの再読み込み後。

## テスト

- `tests/hoverPause.test.ts`（新規）: 再生中→停止→再開、もともと停止中なら触らない、`resume:false` で再開しない、`play` イベント後は再開しない、二重の `start` に耐える、video が無いときは何もしない。
- `tests/overlay.test.ts`: `mouseenter`/`mouseleave` でのコールバック、ポップアップが開いている間は `onHoverEnd` を呼ばない、×で閉じると `resume:true`、外側の mousedown で閉じると `resume:false`、`clearLine` では呼ばない。
- `tests/videoControl.test.ts`: `resumeVideo` のフォールバック。
- `tests/settings.test.ts` / `tests/options.test.ts`: 既定値 ON、チェックボックスの読み込みと保存。
- 実行するのは対象ファイルの vitest と `tsc --noEmit` だけ（全件の連続実行はしない）。実機確認は拡張の ↻ とページの F5 のあと、ユーザーに依頼する。
