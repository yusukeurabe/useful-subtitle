// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CaptionContext } from '../src/content/captionObserver';

const mocks = vi.hoisted(() => ({
  observe: vi.fn(),
  overlay: { renderLine: vi.fn(), clearLine: vi.fn(), setTranslation: vi.fn(), syncMount: vi.fn() },
  panel: { clear: vi.fn(), append: vi.fn(), setTranslation: vi.fn(), updateActiveByTime: vi.fn(), setVisible: vi.fn() },
  request: vi.fn(),
  createPanel: vi.fn(),
}));
vi.mock('../src/content/captionObserver', () => ({ startCaptionObserver: mocks.observe }));
vi.mock('../src/content/overlay', () => ({ createOverlay: () => mocks.overlay }));
vi.mock('../src/content/transcriptPanel', () => ({ createTranscriptPanel: mocks.createPanel }));
vi.mock('../src/shared/messages', () => ({ sendRequest: mocks.request }));

const listeners: [string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined][] = [];
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.createPanel.mockReturnValue(mocks.panel);
  const add = document.addEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
    listeners.push([type, listener, options]);
    add(type, listener, options);
  });
});
afterEach(() => {
  for (const [type, listener, options] of listeners.splice(0)) document.removeEventListener(type, listener, options);
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('integrates immediate English, debounce, stale response guards, ads and same-ID duration changes', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('location', new URL('https://www.youtube.com/watch?v=first'));
  document.body.innerHTML = '<div id="movie_player"><video class="html5-main-video"></video></div>';
  const player = document.getElementById('movie_player')!;
  const video = player.querySelector('video')!;
  Object.defineProperty(video, 'duration', { configurable: true, value: 1000 });
  const responses: ((res: {ok: true; text: string}) => void)[] = [];
  mocks.request.mockImplementation(() => new Promise(resolve => responses.push(resolve)));
  await import('../src/content/index');
  await Promise.resolve();
  const emit = mocks.observe.mock.calls[0][0] as (text: string | null, context: CaptionContext) => void;
  let context: CaptionContext = { contentId: 'youtube:first', active: true, isAd: false, player };
  video.currentTime = 10;
  emit('Hello', context);
  expect(mocks.overlay.renderLine).toHaveBeenLastCalledWith('Hello', expect.anything(), 10);
  expect(mocks.request).not.toHaveBeenCalled();
  vi.advanceTimersByTime(100);
  video.currentTime = 10.1;
  emit('Hello world', context);
  vi.advanceTimersByTime(350);
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(mocks.request).toHaveBeenLastCalledWith({ type: 'translateLine', text: 'Hello world' });

  // 同じ ID のメディアイベントでは履歴も記録済み位置もリセットしない。
  Object.defineProperty(video, 'duration', { configurable: true, value: 600 });
  video.dispatchEvent(new Event('durationchange'));
  expect(mocks.panel.clear).not.toHaveBeenCalled();
  const recorded = mocks.panel.append.mock.calls.length;
  player.classList.add('ad-showing');
  emit(null, { ...context, isAd: true });
  responses[0]({ ok: true, text: '広告前の応答' });
  await Promise.resolve();
  expect(mocks.panel.setTranslation).not.toHaveBeenCalled();
  expect(mocks.overlay.clearLine).toHaveBeenCalled();
  video.dispatchEvent(new Event('loadstart'));
  player.classList.remove('ad-showing');
  emit(null, context); // 広告終了と字幕再表示が別フレームになるケース。
  video.currentTime = 10.2;
  emit('Hello world', context);
  expect(mocks.panel.append).toHaveBeenCalledTimes(recorded);
  vi.advanceTimersByTime(350);

  // 同じ字幕で動画が変わっても古い応答は表示にも新動画の履歴にも混ざらない。
  vi.stubGlobal('location', new URL('https://www.youtube.com/watch?v=second'));
  context = { ...context, contentId: 'youtube:second' };
  video.currentTime = 0;
  emit('Hello world', context);
  expect(mocks.panel.clear).toHaveBeenCalledTimes(1);
  responses[1]({ ok: true, text: '前動画' });
  await Promise.resolve();
  expect(mocks.overlay.setTranslation).not.toHaveBeenCalledWith({ kind: 'text', text: '前動画' });
  vi.advanceTimersByTime(350);
  responses[2]({ ok: true, text: '新動画' });
  await Promise.resolve();
  expect(mocks.overlay.setTranslation).toHaveBeenLastCalledWith({ kind: 'text', text: '新動画' });

  // A → B → A でも1回目の A 応答を復活させない。
  video.currentTime = 1;
  emit('A', context);
  vi.advanceTimersByTime(350);
  video.currentTime = 2;
  emit('B', context);
  vi.advanceTimersByTime(350);
  video.currentTime = 3;
  emit('A', context);
  vi.advanceTimersByTime(350);
  responses[3]({ ok: true, text: '古い A' });
  await Promise.resolve();
  expect(mocks.overlay.setTranslation).not.toHaveBeenCalledWith({ kind: 'text', text: '古い A' });
  emit(null, { ...context, active: false });
  responses[5]({ ok: true, text: '離脱後' });
  await Promise.resolve();
  expect(mocks.overlay.setTranslation).not.toHaveBeenCalledWith({ kind: 'text', text: '離脱後' });
  expect(mocks.panel.setVisible).toHaveBeenLastCalledWith(false);

  const sent = mocks.request.mock.calls.length;
  for (let i = 0; i < 15; i++) {
    video.currentTime = 4 + i / 10;
    emit(`Rolling ${i}`, context);
    vi.advanceTimersByTime(100);
  }
  expect(mocks.request).toHaveBeenCalledTimes(sent + 1);
  expect(mocks.request).toHaveBeenLastCalledWith({ type: 'translateLine', text: 'Rolling 14' });
  emit(null, context);
});


it('drops the pending pre-ad caption when switching video IDs', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('location', new URL('https://www.youtube.com/watch?v=first'));
  document.body.innerHTML = '<div id="movie_player"><video class="html5-main-video"></video></div>';
  const player = document.getElementById('movie_player')!;
  const video = player.querySelector('video')!;
  mocks.request.mockImplementation(() => new Promise(() => {}));
  await import('../src/content/index');
  await Promise.resolve();
  const emit = mocks.observe.mock.calls[0][0] as (text: string | null, context: CaptionContext) => void;
  let context: CaptionContext = { contentId: 'youtube:first', active: true, isAd: false, player };
  video.currentTime = 10;
  emit('Same caption', context);
  vi.stubGlobal('location', new URL('https://www.youtube.com/watch?v=second'));
  context = { ...context, contentId: 'youtube:second' };
  emit(null, { ...context, isAd: true });
  emit(null, context);
  video.currentTime = 0;
  emit('Same caption', context);
  expect(mocks.panel.clear).toHaveBeenCalledTimes(1);
  expect(mocks.panel.append).toHaveBeenCalledTimes(2);
  emit(null, context);
});

it.each([
  ['youtube', 'before-send'],
  ['youtube', 'awaiting-response'],
  ['prime', 'awaiting-response'],
])('manual history clear preserves current live translation: %s / %s', async (site, timing) => {
  vi.useFakeTimers();
  const youtube = site === 'youtube';
  vi.stubGlobal('location', new URL(youtube
    ? 'https://www.youtube.com/watch?v=first'
    : 'https://www.primevideo.com/detail/B0FIRST'));
  document.body.innerHTML = '<div id="movie_player"><video class="html5-main-video"></video></div>';
  const player = document.getElementById('movie_player')!;
  const video = player.querySelector('video')!;
  video.currentTime = 10;
  let resolve!: (value: { ok: true; text: string }) => void;
  mocks.request.mockImplementation(() => new Promise(done => { resolve = done; }));
  await import('../src/content/index');
  await Promise.resolve();
  const emit = mocks.observe.mock.calls[0][0] as (text: string | null, context: CaptionContext) => void;
  emit('Hello world', { contentId: youtube ? 'youtube:first' : 'B0FIRST', active: true, isAd: false, player });
  if (timing === 'awaiting-response') vi.advanceTimersByTime(350);
  mocks.createPanel.mock.calls[0][0].onClearHistory();
  vi.advanceTimersByTime(350);
  expect(mocks.request).toHaveBeenCalledTimes(1);
  resolve({ ok: true, text: '現在の字幕の訳' });
  await Promise.resolve();
  expect(mocks.overlay.setTranslation).toHaveBeenLastCalledWith({ kind: 'text', text: '現在の字幕の訳' });
  expect(mocks.panel.setTranslation).not.toHaveBeenCalled();
});
