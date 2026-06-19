import { describe, it, expect } from 'vitest';
import { pickBestVideo, type VideoLike } from '../src/content/videoControl';

/** 既定は「停止中・未再生・未描画」のダミー。必要な項目だけ上書きする。 */
const v = (o: Partial<VideoLike>): VideoLike => ({
  paused: true,
  currentTime: 0,
  duration: NaN,
  videoWidth: 0,
  ...o,
});

describe('pickBestVideo — 複数 video から本編を選ぶ', () => {
  it('空配列なら null', () => {
    expect(pickBestVideo([])).toBeNull();
  });

  it('1つだけならそれを返す', () => {
    const only = v({ currentTime: 5 });
    expect(pickBestVideo([only])).toBe(only);
  });

  it('再生中(!paused)の本編を、停止中ダミーより優先する（順序非依存）', () => {
    const dummy = v({ paused: true, currentTime: 0 });
    const main = v({ paused: false, currentTime: 0.2, videoWidth: 1920, duration: 1200 });
    expect(pickBestVideo([dummy, main])).toBe(main);
    expect(pickBestVideo([main, dummy])).toBe(main);
  });

  it('両方停止中なら、描画中(videoWidth>0)の方を選ぶ（ユーザーが一時停止した場合）', () => {
    const hidden = v({ paused: true, currentTime: 0, videoWidth: 0 });
    const main = v({ paused: true, currentTime: 42, videoWidth: 1920, duration: 1200 });
    expect(pickBestVideo([hidden, main])).toBe(main);
  });

  it('描画状態が同じなら、再生位置(currentTime)が進んでいる方を選ぶ', () => {
    const a = v({ paused: false, currentTime: 3, videoWidth: 1280 });
    const b = v({ paused: false, currentTime: 30, videoWidth: 1280 });
    expect(pickBestVideo([a, b])).toBe(b);
  });

  it('進み具合も同じなら、実尺(有限 duration)を持つ方を選ぶ（ライブ等の Infinity より本編）', () => {
    const live = v({ paused: false, currentTime: 10, videoWidth: 1280, duration: Infinity });
    const main = v({ paused: false, currentTime: 10, videoWidth: 1280, duration: 1200 });
    expect(pickBestVideo([live, main])).toBe(main);
  });

  it('停止中ダミーが先頭でも本編(再生中)を取りこぼさない（実機バグの回帰）', () => {
    const dummy = v({ paused: true, currentTime: 0, videoWidth: 0, duration: NaN });
    const main = v({ paused: false, currentTime: 7.5, videoWidth: 1920, duration: 2640 });
    expect(pickBestVideo([dummy, main])).toBe(main);
  });
});
