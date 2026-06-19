// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pickBestVideo, seekVideo, type VideoLike } from '../src/content/videoControl';

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

describe('seekVideo — シークしてその地点から再生再開', () => {
  let video: HTMLVideoElement;
  let setTimes: number[];
  let playSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.replaceChildren();
    setTimes = [];
    playSpy = vi.fn(() => Promise.resolve());
    video = document.createElement('video');
    // jsdom は currentTime/play を実装しないので差し替える。
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => setTimes[setTimes.length - 1] ?? 0,
      set: (t: number) => void setTimes.push(t),
    });
    Object.defineProperty(video, 'paused', { configurable: true, value: true });
    video.play = playSpy as unknown as HTMLVideoElement['play'];
    document.body.appendChild(video);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('指定秒へ currentTime をセットする', () => {
    seekVideo(568.8);
    expect(setTimes).toEqual([568.8]);
  });

  it('負値は 0 に丸める', () => {
    seekVideo(-5);
    expect(setTimes).toEqual([0]);
  });

  it('停止中でも再生を再開する（停止中はフレームが更新されない Prime 対策）', () => {
    seekVideo(100);
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it('少し待っても停止中なら Prime の再生ボタンを押す（play() 握り潰し対策）', () => {
    vi.useFakeTimers();
    const btn = document.createElement('button');
    btn.className = 'atvwebplayersdk-playpause-button';
    const clickSpy = vi.fn();
    btn.addEventListener('click', clickSpy);
    document.body.appendChild(btn);

    seekVideo(100); // 直後の play() は握り潰される想定（stub の paused は true のまま）
    expect(clickSpy).not.toHaveBeenCalled(); // すぐには押さない
    vi.advanceTimersByTime(200);
    expect(clickSpy).toHaveBeenCalledTimes(1); // 停止が続けば Prime ボタンで再開
  });

  it('video が無ければ何もしない（例外を出さず play も呼ばない）', () => {
    document.body.replaceChildren();
    expect(() => seekVideo(10)).not.toThrow();
    expect(playSpy).not.toHaveBeenCalled();
  });
});
