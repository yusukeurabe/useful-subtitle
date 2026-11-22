import { isYouTube, isYouTubeAd, youtubePlayer } from './site';
import { VIDEO_SELECTOR, PLAYPAUSE_BUTTON_SELECTORS, YOUTUBE_VIDEO_SELECTOR } from '../shared/selectors';

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
  if (isYouTube()) {
    if (!youtubePlayer() || isYouTubeAd()) return null;
    return document.querySelector<HTMLVideoElement>(YOUTUBE_VIDEO_SELECTOR);
  }
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
 * 停止中の video を再生し直す。
 *
 * Prime は一時停止中の生の <video>.play() を握り潰して停止のままにすることがある。
 * そこで play() のあと少し待ってもまだ停止中なら、Prime 自身の再生ボタンを押す
 * （状態機械ごと動かすので握り潰されない）。YouTube は play() だけで再開できる。
 * 戻り値は「少し待ってからボタンを押す」処理を取り消す関数（直後に止め直す場合用）。
 */
export function resumeVideo(v: HTMLVideoElement): () => void {
  void v.play().catch(() => undefined);
  const timer = setTimeout(() => {
    if (!v.paused) return; // 既に再生できている → 何もしない
    if (!isYouTube() && v.isConnected && findVideo() === v) findPlayPauseButton()?.click();
  }, 200);
  return () => clearTimeout(timer);
}

/**
 * v を指定秒へシークし、その地点から再生を再開する（負値は 0 に丸める）。
 *
 * Prime は一時停止中だとプログラムからの currentTime 変更で画面を描き直さないため、
 * シーク後に resumeVideo で再生まで行う（履歴行をクリックしても「戻らない」ように
 * 見えるのを防ぐ）。未バッファ地点で直後の play() が落ちた場合に備え、シーク完了
 * (seeked) 時にもう一度 play() する。再生中に呼ばれた場合は resumeVideo の
 * ボタン押下が skip される（v.paused が false）ので、再生中クリックを誤って停止しない。
 */
function seekElement(v: HTMLVideoElement, seconds: number): void {
  v.currentTime = Math.max(0, seconds);
  resumeVideo(v);
  v.addEventListener('seeked', () => {
    if (findVideo() === v) void v.play().catch(() => undefined);
  }, { once: true });
}

/**
 * 指定秒へシークし、その地点から再生を再開する。
 * 同じ要素を一貫して扱い、findVideo の二度引きによる取り違えも防ぐ。
 */
export function seekVideo(seconds: number): void {
  const v = findVideo();
  if (v) seekElement(v, seconds);
}

/**
 * 現在位置から seconds 秒戻して再生する（字幕下の巻き戻しボタン用）。
 * 0 秒より前は 0 秒。現在位置の読み取りとシークは同じ要素に対して行う。
 */
export function rewindVideo(seconds: number): void {
  const v = findVideo();
  if (v) seekElement(v, v.currentTime - seconds);
}

/**
 * 停止中なら再生し、再生中なら一時停止する（字幕下の再生/一時停止ボタン用）。
 * 再生は resumeVideo を使う（Prime が生の play() を握り潰す場合に備えるため）。
 */
export function togglePlayVideo(): void {
  const v = findVideo();
  if (!v) return;
  if (v.paused) resumeVideo(v);
  else v.pause();
}
