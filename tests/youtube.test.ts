// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startCaptionObserver, type CaptionObserver } from '../src/content/captionObserver';
import { extractContentId, createTitleSwitchDetector } from '../src/content/contentIdentity';
import { findVideo, seekVideo } from '../src/content/videoControl';
import { createOverlay, type Overlay } from '../src/content/overlay';

function navigate(path: string): void {
  vi.stubGlobal('location', new URL(`https://www.youtube.com${path}`));
  document.dispatchEvent(new Event('yt-navigate-finish'));
}
function player(text = 'Hello world'): HTMLElement {
  const el = document.createElement('div');
  el.id = 'movie_player';
  el.innerHTML = `<video class="video-stream html5-main-video"></video><div class="ytp-caption-window-container"><div class="caption-window"><div class="captions-text"><span class="caption-visual-line"><span class="ytp-caption-segment">${text}</span></span></div></div></div>`;
  document.body.append(el);
  return el;
}
async function frame(): Promise<void> {
  await Promise.resolve();
  vi.advanceTimersByTime(20);
  await Promise.resolve();
}
let observer: CaptionObserver | undefined;
let overlay: Overlay | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
  navigate('/watch?v=first');
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
});
afterEach(() => {
  observer?.stop();
  overlay?.destroy();
  observer = undefined;
  overlay = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('YouTube captions and lifecycle', () => {
  it('hides Language Reactor UI while preserving native captions and restores it on departure', async () => {
    const p = player();
    p.insertAdjacentHTML('beforeend', '<div id="lln-bottom-panel"><div id="lln-main-subs">LR caption</div></div><div id="lln-extension-controls">ON</div><div class="lln-toggle-vertical-view">Toggle</div><div class="lln-yt-mini-playback-bar">Progress</div>');
    document.body.insertAdjacentHTML('beforeend', '<div class="lln-vertical-view">LR history</div><div class="lln-vv-toggle-in-sidebar">Subtitles</div><div id="lln-vv-translations">LR translation</div><div id="lln-vv-image">LR image</div><div id="unrelated-panel">Other extension</div>');
    const lrElements = [
      document.getElementById('lln-bottom-panel')!, document.getElementById('lln-extension-controls')!,
      document.querySelector('.lln-toggle-vertical-view')!, document.querySelector('.lln-yt-mini-playback-bar')!,
      document.querySelector('.lln-vertical-view')!, document.querySelector('.lln-vv-toggle-in-sidebar')!,
      document.getElementById('lln-vv-translations')!, document.getElementById('lln-vv-image')!,
    ];
    overlay = createOverlay({ onLookup() {}, onPlayAudio() {}, onSeek() {} }, { bottomPercent: 10, onBottomChange() {} });
    for (const element of lrElements) expect(getComputedStyle(element).display).toBe('none');
    expect(getComputedStyle(document.getElementById('unrelated-panel')!).display).not.toBe('none');
    const change = vi.fn();
    observer = startCaptionObserver(change);
    await frame();
    expect(change.mock.calls.at(-1)?.[0]).toBe('Hello world');
    p.querySelector('.ytp-caption-segment')!.textContent = 'Next caption';
    await frame();
    expect(change.mock.calls.at(-1)?.[0]).toBe('Next caption');
    expect(document.getElementById('lln-main-subs')!.textContent).toBe('LR caption');
    // LR can mount after Useful Subtitle, without another observer or DOM removal.
    document.querySelector('.lln-vertical-view')!.remove();
    const late = document.createElement('div'); late.className = 'lln-vertical-view'; document.body.append(late);
    expect(getComputedStyle(late).display).toBe('none');
    navigate('/'); overlay.syncMount();
    expect(getComputedStyle(late).display).not.toBe('none');
    navigate('/watch?v=first'); overlay.syncMount();
    expect(getComputedStyle(late).display).toBe('none');
    overlay.destroy();
    expect(getComputedStyle(late).display).not.toBe('none');
  });

  it('does not suppress Language Reactor on Prime Video', () => {
    vi.stubGlobal('location', new URL('https://www.primevideo.com/detail/B0FIRST'));
    document.body.innerHTML = '<div id="lln-bottom-panel">Other subtitles</div><div class="lln-vertical-view">History</div>';
    overlay = createOverlay({ onLookup() {}, onPlayAudio() {}, onSeek() {} }, { bottomPercent: 10, onBottomChange() {} });
    expect(getComputedStyle(document.getElementById('lln-bottom-panel')!).display).not.toBe('none');
    expect(getComputedStyle(document.querySelector('.lln-vertical-view')!).display).not.toBe('none');
  });

  it('reads native segments only, joins lines and ignores other subtitle extensions', async () => {
    const p = player();
    p.querySelector('.captions-text')!.insertAdjacentHTML('beforeend', '<span class="caption-visual-line"><span class="ytp-caption-segment">Second line</span></span>');
    document.body.insertAdjacentHTML('beforeend', '<div class="captions-text">Other extension</div><span class="ytp-caption-segment">Preview</span>');
    const change = vi.fn();
    observer = startCaptionObserver(change);
    await frame();
    expect(change.mock.calls.at(-1)?.[0]).toBe('Hello world Second line');
  });

  it('starts on home, follows watch SPA navigation, same-text video switches and departures', async () => {
    navigate('/');
    const change = vi.fn();
    observer = startCaptionObserver(change);
    await frame();
    player();
    navigate('/watch?v=first');
    await frame();
    expect(change.mock.calls.at(-1)?.[0]).toBe('Hello world');
    const count = change.mock.calls.length;
    navigate('/watch?v=second');
    await frame();
    expect(change.mock.calls.length).toBeGreaterThan(count);
    expect(change.mock.calls.at(-1)?.[1].contentId).toBe('youtube:second');
    navigate('/shorts/second');
    await frame();
    expect(change.mock.calls.at(-1)?.[0]).toBeNull();
  });

  it('suppresses ads changed by class only, restores captions and detects captions off', async () => {
    const p = player();
    const change = vi.fn();
    observer = startCaptionObserver(change);
    await frame();
    p.className = 'html5-video-player ad-showing';
    await frame();
    expect(change.mock.calls.at(-1)?.[0]).toBeNull();
    p.className = 'html5-video-player';
    await frame();
    expect(change.mock.calls.at(-1)?.[0]).toBe('Hello world');
    p.querySelector('.ytp-caption-window-container')!.replaceChildren();
    await frame();
    expect(change.mock.calls.at(-1)?.[0]).toBeNull();
  });

  it('clears during navigation, recognizes late/replaced player, and cancels pending frames on stop', async () => {
    const change = vi.fn();
    observer = startCaptionObserver(change);
    await frame();
    const p = player();
    await frame();
    expect(change.mock.calls.at(-1)?.[0]).toBe('Hello world');
    document.dispatchEvent(new Event('yt-navigate-start'));
    await frame();
    expect(change.mock.calls.at(-1)?.[0]).toBeNull();
    p.remove();
    const next = player('Next');
    navigate('/watch?v=second');
    await frame();
    expect(change.mock.calls.at(-1)?.[1].player).toBe(next);
    change.mockClear();
    next.querySelector('.ytp-caption-segment')!.textContent = 'Stopped';
    await Promise.resolve();
    observer.stop();
    await frame();
    expect(change).not.toHaveBeenCalled();
  });

  it.each(['/shorts/first', '/embed/first', '/watch'])('does not read unsupported page %s', async (path) => {
    navigate(path);
    player();
    const change = vi.fn();
    observer = startCaptionObserver(change);
    await frame();
    expect(change.mock.calls.some(([text]) => text !== null)).toBe(false);
  });

  it('selects only the watch player video and prevents seeking an ad', () => {
    const p = player();
    document.body.prepend(document.createElement('video'));
    const video = p.querySelector('video')!;
    expect(findVideo()).toBe(video);
    video.play = vi.fn(() => Promise.resolve());
    seekVideo(12);
    expect(video.currentTime).toBe(12);
    p.classList.add('ad-showing');
    expect(findVideo()).toBeNull();
    seekVideo(30);
    expect(video.currentTime).toBe(12);
  });

  it('uses YouTube video ID, ignores duration changes, and excludes non-watch URLs', () => {
    expect(extractContentId('https://www.youtube.com/watch?v=abc-123&t=2')).toBe('youtube:abc-123');
    expect(extractContentId('https://youtube.com/shorts/abc')).toBe('');
    const detector = createTitleSwitchDetector({ useDuration: false });
    expect(detector.check({ id: 'youtube:first', durationRaw: 1000 })).toBe(false);
    expect(detector.check({ id: 'youtube:first', durationRaw: 600 })).toBe(false);
    expect(detector.check({ id: 'youtube:second', durationRaw: 600 })).toBe(true);
  });

  it('does not loop when its own overlay mounts and renders', async () => {
    player();
    overlay = createOverlay({ onLookup() {}, onPlayAudio() {}, onSeek() {} }, { bottomPercent: 10, onBottomChange() {} });
    const change = vi.fn((text: string | null) => {
      overlay!.syncMount();
      if (text) overlay!.renderLine(text, [], 0);
    });
    observer = startCaptionObserver(change);
    await frame();
    await frame();
    await frame();
    expect(change).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.ytp-caption-segment')!.textContent).toBe('Hello world');
  });

  it('keeps tall popup content scrollable within nonzero player bounds', () => {
    player();
    overlay = createOverlay({ onLookup() {}, onPlayAudio() {}, onSeek() {} }, { bottomPercent: 10, onBottomChange() {} });
    const host = document.getElementById('useful-subtitle-overlay')!;
    host.getBoundingClientRect = () => new DOMRect(100, 50, 800, 180);
    overlay.openPopup(new DOMRect(300, 180, 60, 20), 'Hello');
    const popup = host.shadowRoot!.querySelector<HTMLElement>('.popup')!;
    Object.defineProperty(popup, 'offsetHeight', { get: () => Math.min(900, parseFloat(popup.style.maxHeight) || 900) });
    Object.defineProperty(popup, 'offsetWidth', { value: 320 });
    overlay.setPopupMeaning('Long explanation '.repeat(200), []);
    expect(popup.style.maxHeight).toBe('164px');
    expect(popup.style.boxSizing).toBe('border-box');
    expect(popup.style.overflowY).toBe('auto');
    expect(parseFloat(popup.style.top)).toBe(8);
    expect(parseFloat(popup.style.top) + popup.offsetHeight).toBeLessThanOrEqual(172);
  });

  it('mounts in the player, converts popup coordinates, follows replacement and fullscreen', () => {
    const p = player();
    overlay = createOverlay({ onLookup() {}, onPlayAudio() {}, onSeek() {} }, { bottomPercent: 10, onBottomChange() {} });
    const host = document.getElementById('useful-subtitle-overlay')!;
    expect(host.parentElement).toBe(p);
    expect(host.style.position).toBe('absolute');
    expect(host.shadowRoot!.querySelector<HTMLElement>('.subtitle')!.style.position).toBe('absolute');
    host.getBoundingClientRect = () => new DOMRect(100, 50, 800, 450);
    overlay.openPopup(new DOMRect(300, 250, 60, 20), 'Hello');
    const popup = host.shadowRoot!.querySelector<HTMLElement>('.popup')!;
    expect(popup.style.position).toBe('absolute');
    expect(popup.style.left).toBe('230px');
    expect(popup.style.top).toBe('192px');
    p.remove();
    const next = player();
    overlay.syncMount();
    expect(host.parentElement).toBe(next);
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: next });
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(host.parentElement).toBe(next);
    navigate('/');
    overlay.syncMount();
    expect(host.isConnected).toBe(false);
  });
});
