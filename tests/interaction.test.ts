// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runLookup } from '../src/content/interaction';
import { createOverlay, type Overlay } from '../src/content/overlay';
import { DEFAULT_SETTINGS } from '../src/shared/settings';

const request = vi.hoisted(() => vi.fn());
vi.mock('../src/shared/messages', () => ({ sendRequest: request }));
let overlay: Overlay;
const pending: ((value: unknown) => void)[] = [];
const settings = { ...DEFAULT_SETTINGS, autoPauseOnClick: false };
const anchor = (): DOMRect => new DOMRect(100, 100, 50, 20);

beforeEach(() => {
  vi.stubGlobal('location', new URL('https://www.youtube.com/watch?v=first'));
  document.body.innerHTML = '<div id="movie_player"></div>';
  overlay = createOverlay({ onLookup() {}, onPlayAudio() {}, onSeek() {} }, { bottomPercent: 10, onBottomChange() {} });
  pending.length = 0;
  request.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
});
afterEach(() => { overlay.destroy(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(['open', 'close', 'render', 'clear', 'remount'])(
  'does not apply an older same-word lookup after popup %s and a new lookup', async (action) => {
    const old = runLookup(overlay, settings, 'word', 'Video A', anchor());
    if (action === 'close') overlay.hidePopup();
    if (action === 'render') overlay.renderLine('Video B', [], 0);
    if (action === 'clear') overlay.clearLine();
    if (action === 'remount') {
      document.body.innerHTML = '<div id="movie_player"></div>';
      overlay.syncMount();
    }
    const fresh = runLookup(overlay, settings, 'word', 'Video B', anchor());
    pending[2]({ ok: true, kind: 'word', ipa: 'new', audioUrl: 'new.mp3' });
    pending[3]({ ok: true, text: 'New explanation' });
    await fresh;
    pending[0]({ ok: true, kind: 'word', ipa: 'old', audioUrl: 'old.mp3' });
    pending[1]({ ok: true, text: 'Old explanation' });
    await old;
    const shadow = document.getElementById('useful-subtitle-overlay')!.shadowRoot!;
    expect(shadow.querySelector('.body')!.textContent).toContain('New explanation');
    expect(shadow.querySelector('.ipa')!.textContent).toContain('new');
    expect(shadow.querySelector('.popup')!.textContent).not.toContain('Old explanation');
  },
);

it.each(['close', 'render', 'clear', 'remount', 'leave', 'destroy'])(
  'does not apply pending explanation or IPA after popup invalidation by %s', async (action) => {
    const meaning = vi.spyOn(overlay, 'setPopupMeaning');
    const word = vi.spyOn(overlay, 'setPopupWordInfo');
    const lookup = runLookup(overlay, settings, 'word', 'Video A', anchor());
    if (action === 'close') overlay.hidePopup();
    if (action === 'render') overlay.renderLine('Next caption', [], 1);
    if (action === 'clear') overlay.clearLine();
    if (action === 'remount') {
      document.body.innerHTML = '<div id="movie_player"></div>';
      overlay.syncMount();
    }
    if (action === 'leave') {
      vi.stubGlobal('location', new URL('https://www.youtube.com/'));
      overlay.syncMount();
    }
    if (action === 'destroy') overlay.destroy();
    pending[0]({ ok: true, kind: 'word', ipa: 'old', audioUrl: 'old.mp3' });
    pending[1]({ ok: true, text: 'Old explanation' });
    await lookup;
    expect(meaning).not.toHaveBeenCalled();
    expect(word).not.toHaveBeenCalled();
  },
);
