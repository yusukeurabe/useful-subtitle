import { VIDEO_SELECTOR } from '../shared/selectors';

/** 再生中の video 要素を返す（Prime は通常 1 つ）。 */
export function findVideo(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>(VIDEO_SELECTOR);
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

/** 指定秒へシークする（負値は 0 に丸める）。 */
export function seekVideo(seconds: number): void {
  const v = findVideo();
  if (v) v.currentTime = Math.max(0, seconds);
}
