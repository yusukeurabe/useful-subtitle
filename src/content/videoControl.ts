import { VIDEO_SELECTOR, PLAYPAUSE_BUTTON_SELECTORS } from '../shared/selectors';

/**
 * 本編 video を選ぶのに使う最小限のプロパティ。
 * HTMLVideoElement はこれを満たすので、テストではプレーンオブジェクトで代用できる。
 */
export interface VideoLike {
  /** 一時停止中か。 */
  paused: boolean;
  /** 現在の再生位置（秒）。 */
  currentTime: number;
  /** 総尺（秒）。ライブ等は Infinity、未ロードは NaN。 */
  duration: number;
  /** 描画解像度の幅。実フレームを描いていれば > 0。 */
  videoWidth: number;
}

/** a が b より「本編らしい」か。優先順に1段ずつ比較する。 */
function isBetterVideo(a: VideoLike, b: VideoLike): boolean {
  // 1) 再生中(!paused) を最優先（いま再生されているのが本編）。
  if (a.paused !== b.paused) return !a.paused;
  // 2) 実際に描画している(videoWidth>0)方（一時停止中でも本編は最終フレームを描く）。
  const aRender = a.videoWidth > 0;
  const bRender = b.videoWidth > 0;
  if (aRender !== bRender) return aRender;
  // 3) 再生位置が進んでいる方（停止中ダミーは 0 のまま）。
  if (a.currentTime !== b.currentTime) return a.currentTime > b.currentTime;
  // 4) 実尺を持つ方（有限 duration）。両方有限なら大きい方。
  const ad = Number.isFinite(a.duration) ? a.duration : -1;
  const bd = Number.isFinite(b.duration) ? b.duration : -1;
  return ad > bd;
}

/**
 * 複数の video から「本編（いま再生中の動画）」を選ぶ。
 *
 * Prime はページ上に広告・プレビュー等の別 video を持つことがあり、DOM 先頭が
 * 本編とは限らない。先頭固定（querySelector('video')）だと停止中ダミー
 * （currentTime=0）を掴んでしまい、履歴の記録（再生位置が進まず1件で止まる）も
 * シーク（別 video を動かすので画面が動かない）も同時に壊れる。
 * そこで瞬間的なプロパティから本編らしさを優先順に比較して選ぶ。
 * 同点なら先に現れたものを保つ（安定選択）。該当無しは null。
 */
export function pickBestVideo<T extends VideoLike>(videos: readonly T[]): T | null {
  let best: T | null = null;
  for (const v of videos) {
    if (best === null || isBetterVideo(v, best)) best = v;
  }
  return best;
}

/** 再生中の本編 video を返す（複数あっても本編を選ぶ。無ければ null）。 */
export function findVideo(): HTMLVideoElement | null {
  const videos = document.querySelectorAll<HTMLVideoElement>(VIDEO_SELECTOR);
  return pickBestVideo(Array.from(videos));
}

/** 再生中なら一時停止する。 */
export function pauseVideo(): void {
  const v = findVideo();
  if (v && !v.paused) v.pause();
}

/** 停止中なら再生を再開する。 */
export function playVideo(): void {
  const v = findVideo();
  if (v && v.paused) void v.play().catch(() => undefined);
}

/** Prime の再生/一時停止トグルボタンを探す（無ければ null）。 */
function findPlayPauseButton(): HTMLElement | null {
  for (const sel of PLAYPAUSE_BUTTON_SELECTORS) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) return el;
  }
  return null;
}

/**
 * 指定秒へシークし、その地点から再生を再開する（負値は 0 に丸める）。
 *
 * Prime は一時停止中だと (a) プログラムからの currentTime 変更で画面を描き直さず、
 * さらに (b) 生の <video>.play() を直後に握り潰して停止のままにすることがある。
 * 履歴行をクリックしても「戻らない／戻るが再生されない」ように見えるため、多段で
 * 確実に再開させる：
 *   1. currentTime をセット
 *   2. すぐ play()（バッファ済みなら即フレーム更新＋再生）
 *   3. シーク完了(seeked)時にもう一度 play()（未バッファ地点で 2 が落ちた場合の保険）
 *   4. 少し待っても停止中なら Prime 自身の再生ボタンを押す（状態機械ごと動かすので
 *      握り潰されない）
 * 履歴行クリックはユーザー操作内なので play()/click は許可される。再生中に呼ばれた
 * 場合は 4 を skip する（v.paused が false）ので、再生中クリックを誤って停止しない。
 * 同じ要素を一貫して扱い、findVideo の二度引きによる取り違えも防ぐ。
 */
export function seekVideo(seconds: number): void {
  const v = findVideo();
  if (!v) return;
  v.currentTime = Math.max(0, seconds);
  const resume = (): void => void v.play().catch(() => undefined);
  resume();
  v.addEventListener('seeked', resume, { once: true });
  setTimeout(() => {
    if (!v.paused) return; // 既に再生できている（再生中クリックを含む）→ 何もしない
    findPlayPauseButton()?.click();
  }, 200);
}
