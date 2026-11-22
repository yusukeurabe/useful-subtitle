// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CaptionContext, CaptionObserver } from '../src/content/captionObserver';
import type { Overlay } from '../src/content/overlay';

const mocks = vi.hoisted(() => ({
  observe: vi.fn(),
  overlay: { renderLine: vi.fn(), clearLine: vi.fn(), setTranslation: vi.fn(), setPlaying: vi.fn(), syncMount: vi.fn() },
  panel: { clear: vi.fn(), append: vi.fn(), setTranslation: vi.fn(), updateActiveByTime: vi.fn(), setVisible: vi.fn() },
  request: vi.fn(),
  createPanel: vi.fn(),
  createOverlay: vi.fn(),
}));
vi.mock('../src/content/captionObserver', () => ({ startCaptionObserver: mocks.observe }));
vi.mock('../src/content/overlay', () => ({ createOverlay: mocks.createOverlay }));
vi.mock('../src/content/transcriptPanel', () => ({ createTranscriptPanel: mocks.createPanel }));
vi.mock('../src/shared/messages', () => ({ sendRequest: mocks.request }));

const listeners: [string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined][] = [];
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.observe.mockReset();
  mocks.createPanel.mockReturnValue(mocks.panel);
  mocks.createOverlay.mockReturnValue(mocks.overlay);
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

async function bootWithAutoPause(autoPauseOnClick: boolean) {
  return bootWithSettings({ autoPauseOnClick });
}

async function bootWithSettings(settings: Record<string, unknown>) {
  vi.stubGlobal('location', new URL('https://www.youtube.com/watch?v=autopause'));
  document.body.innerHTML = '<div id="movie_player"><video class="html5-main-video"></video></div>';
  const video = document.querySelector('video')!;
  Object.defineProperty(video, 'paused', { configurable: true, value: false });
  const pause = vi.spyOn(video, 'pause').mockImplementation(() => undefined);
  await chrome.storage.local.set(settings);
  await import('../src/content/index');
  await new Promise(resolve => setTimeout(resolve, 0));
  return {
    pause,
    callbacks: mocks.createPanel.mock.calls[0][0],
    overlayCallbacks: mocks.createOverlay.mock.calls[0][0],
  };
}

it.each([
  {
    url: 'https://www.youtube.com/watch?v=first',
    player: 'id="movie_player"',
    button: 'class="ytp-subtitles-button"',
    attribute: 'aria-pressed',
    on: 'true',
    off: 'false',
    captionContainer: 'ytp-caption-window-container',
    captionClass: 'ytp-caption-segment',
  },
  {
    url: 'https://www.primevideo.com/detail/B0FIRST',
    player: 'class="atvwebplayersdk-player-container"',
    button: '',
    attribute: 'aria-label',
    on: 'Turn off subtitles',
    off: 'Turn on subtitles',
    captionContainer: 'atvwebplayersdk-captions-overlay',
    captionClass: 'atvwebplayersdk-captions-text',
  },
])('hides subtitle controls on $url when captions are switched off between lines', async (site) => {
  vi.useFakeTimers();
  vi.stubGlobal('location', new URL(site.url));
  document.body.innerHTML = `<div ${site.player}>
    <button ${site.button} ${site.attribute}="${site.on}"></button>
    <div class="${site.captionContainer}"><span class="${site.captionClass}">Hello</span></div>
  </div>`;
  const caption = document.querySelector(`.${site.captionClass}`)!;
  const toggle = document.querySelector('button')!;
  const { startCaptionObserver } = await vi.importActual<typeof import('../src/content/captionObserver')>('../src/content/captionObserver');
  const { createOverlay } = await vi.importActual<typeof import('../src/content/overlay')>('../src/content/overlay');
  let observer: CaptionObserver | undefined;
  let overlay: Overlay | undefined;
  mocks.observe.mockImplementation(onChange => (observer = startCaptionObserver(onChange)));
  mocks.createOverlay.mockImplementation((callbacks, options) => (overlay = createOverlay(callbacks, options)));
  await chrome.storage.local.set({ showTranscriptPanel: false, dualSubtitle: false });
  const nextFrame = async (): Promise<void> => {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(20);
  };
  try {
    await import('../src/content/index');
    await nextFrame();
    const shadow = document.getElementById('useful-subtitle-overlay')!.shadowRoot!;
    const bar = shadow.querySelector<HTMLElement>('.rewind-bar')!;
    expect(bar.hidden).toBe(false);

    caption.textContent = '';
    await nextFrame();
    expect(bar.hidden).toBe(false);

    toggle.setAttribute(site.attribute, site.off);
    await nextFrame();
    expect(bar.hidden).toBe(true);

    caption.textContent = 'Caption left in the player';
    await nextFrame();
    expect(bar.hidden).toBe(true);

    toggle.setAttribute(site.attribute, site.on);
    await nextFrame();
    expect(bar.hidden).toBe(false);
  } finally {
    observer?.stop();
    overlay?.destroy();
  }
});

it('pauses the video on a history word click when auto pause is on', async () => {
  const { pause, callbacks } = await bootWithAutoPause(true);
  callbacks.onWordClick();
  expect(pause).toHaveBeenCalledTimes(1);
});

it('leaves history word clicks to the row seek when auto pause is off', async () => {
  const { callbacks } = await bootWithAutoPause(false);
  expect(callbacks.onWordClick).toBeUndefined();
});

it('pauses the video when the cursor enters the subtitle with hover pause on (default)', async () => {
  const { pause, overlayCallbacks } = await bootWithSettings({});
  overlayCallbacks.onHoverStart();
  expect(pause).toHaveBeenCalledTimes(1);
});

it('does not pause on subtitle hover when hover pause is off', async () => {
  const { pause, overlayCallbacks } = await bootWithSettings({ pauseOnSubtitleHover: false });
  overlayCallbacks.onHoverStart();
  expect(pause).not.toHaveBeenCalled();
});

it('keeps progressive YouTube words in one history row with the original seek time', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('location', new URL('https://www.youtube.com/watch?v=rolling'));
  document.body.innerHTML = '<div id="movie_player"><video class="html5-main-video"></video></div>';
  const player = document.getElementById('movie_player')!;
  const video = player.querySelector('video')!;
  vi.spyOn(video, 'play').mockResolvedValue();
  const actual = await vi.importActual<typeof import('../src/content/transcriptPanel')>('../src/content/transcriptPanel');
  let panel!: import('../src/content/transcriptPanel').TranscriptPanel;
  mocks.createPanel.mockImplementation(callbacks => (panel = actual.createTranscriptPanel(callbacks)));
  const responses: ((value: { ok: true; text: string }) => void)[] = [];
  mocks.request.mockImplementation(() => new Promise(resolve => responses.push(resolve)));
  await import('../src/content/index'); await Promise.resolve();
  const emit = mocks.observe.mock.calls[0][0] as (text: string | null, context: CaptionContext) => void;
  const context = { contentId: 'youtube:rolling', active: true, isAd: false, captionsOff: false, player };
  const captions = ['Good', 'Good ', 'Good morning,', 'Good morning, sleepy',
    'Good morning, sleepy heads.', 'Good morning, sleepy heads. It',
    'Good morning, sleepy heads. It is', 'Good morning, sleepy heads. It is day',
    'Good morning, sleepy heads. It is day nine'];
  try {
    for (const [i, text] of captions.entries()) {
      video.currentTime = 10 + i * 0.4;
      emit(text, context);
      vi.advanceTimersByTime(400);
    }
    const shadow = document.getElementById('useful-subtitle-transcript')!.shadowRoot!;
    expect(shadow.querySelectorAll('.row')).toHaveLength(1);
    expect(shadow.querySelector('.en')!.textContent).toBe('Good morning, sleepy heads. It is day nine');
    // An older, shorter caption's translation must not overwrite the expanded row.
    responses[0]({ ok: true, text: '途中の訳' }); await Promise.resolve();
    expect(shadow.querySelector('.ja')!.textContent).toBe('');
    responses.at(-1)!({ ok: true, text: 'おはよう、9日目です' }); await Promise.resolve();
    expect(shadow.querySelector('.ja')!.textContent).toBe('おはよう、9日目です');
    (shadow.querySelector('.row') as HTMLElement).click();
    expect(video.currentTime).toBe(10);
    video.currentTime = 14;
    emit('We are leaving now', context);
    expect(shadow.querySelectorAll('.row')).toHaveLength(2);
    // Replaying already recorded words must neither append nor shorten a row.
    video.currentTime = 10.4;
    emit('Good morning,', context);
    expect(shadow.querySelectorAll('.row')).toHaveLength(2);
    expect(shadow.querySelector('.en')!.textContent).toBe('Good morning, sleepy heads. It is day nine');
  } finally { panel.destroy(); emit(null, context); }
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
  let context: CaptionContext = { contentId: 'youtube:first', active: true, isAd: false, captionsOff: false, player };
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
  let context: CaptionContext = { contentId: 'youtube:first', active: true, isAd: false, captionsOff: false, player };
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
  emit('Hello world', { contentId: youtube ? 'youtube:first' : 'B0FIRST', active: true, isAd: false, captionsOff: false, player });
  if (timing === 'awaiting-response') vi.advanceTimersByTime(350);
  mocks.createPanel.mock.calls[0][0].onClearHistory();
  vi.advanceTimersByTime(350);
  expect(mocks.request).toHaveBeenCalledTimes(1);
  resolve({ ok: true, text: '現在の字幕の訳' });
  await Promise.resolve();
  expect(mocks.overlay.setTranslation).toHaveBeenLastCalledWith({ kind: 'text', text: '現在の字幕の訳' });
  expect(mocks.panel.setTranslation).not.toHaveBeenCalled();
});

it('shows quota guidance inline while canceled translations remain silent', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('location', new URL('https://www.youtube.com/watch?v=quota'));
  document.body.innerHTML = '<div id="movie_player"><video class="html5-main-video"></video></div>';
  const player = document.getElementById('movie_player')!;
  mocks.request.mockResolvedValueOnce({ ok: false, code: 'RATE_LIMIT', error: '利用上限: 60秒停止します' })
    .mockResolvedValueOnce({ ok: false, code: 'CANCELED', error: '取り消しました' });
  await import('../src/content/index'); await Promise.resolve();
  const emit = mocks.observe.mock.calls[0][0] as (text: string | null, context: CaptionContext) => void;
  const context: CaptionContext = { contentId: 'youtube:quota', active: true, isAd: false, captionsOff: false, player };
  emit('Hello', context); await vi.advanceTimersByTimeAsync(350);
  expect(mocks.overlay.setTranslation).toHaveBeenLastCalledWith({ kind: 'text', text: '利用上限: 60秒停止します' });
  emit('Next', context); await vi.advanceTimersByTimeAsync(350);
  expect(mocks.overlay.setTranslation).toHaveBeenLastCalledWith({ kind: 'none' });
});

it('records captions in a skipped range when the user seeks back into it (regression)', async () => {
  vi.stubGlobal('location', new URL('https://www.youtube.com/watch?v=skipback'));
  document.body.innerHTML = '<div id="movie_player"><video class="html5-main-video"></video></div>';
  const player = document.getElementById('movie_player')!;
  const video = player.querySelector('video')!;
  mocks.request.mockReturnValue(new Promise(() => {}));
  await import('../src/content/index'); await Promise.resolve();
  const emit = mocks.observe.mock.calls[0][0] as (text: string | null, context: CaptionContext) => void;
  const context = { contentId: 'youtube:skipback', active: true, isAd: false, captionsOff: false, player };
  const seekTo = (t: number): void => {
    video.currentTime = t;
    video.dispatchEvent(new Event('seeking'));
  };
  video.currentTime = 5;
  emit('Intro line', context);
  seekTo(1200);
  emit('Late line', context);
  seekTo(10);
  emit('Skipped line', context);
  expect(mocks.panel.append).toHaveBeenLastCalledWith({ id: 3, english: 'Skipped line', videoTime: 10 });
  // Re-entering the already watched late range must not duplicate it.
  seekTo(1200);
  emit('Late line', context);
  expect(mocks.panel.append).toHaveBeenCalledTimes(3);
  emit(null, context);
});
