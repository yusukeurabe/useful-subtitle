// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadWordInfo } from '../src/content/word';
import { playPronunciation } from '../src/content/audio';
import type { Overlay } from '../src/content/overlay';

const request = vi.hoisted(() => vi.fn());
vi.mock('../src/shared/messages', () => ({ sendRequest: request }));

const speak = vi.fn();
const overlay = {
  isPopupCurrent: () => true,
  setPopupWordInfo: vi.fn(),
} as unknown as Overlay;

beforeEach(() => {
  request.mockReset();
  speak.mockReset();
  vi.stubGlobal('speechSynthesis', { cancel() {}, speak, getVoices: () => [] });
  vi.stubGlobal('SpeechSynthesisUtterance', class { lang = ''; voice = null; constructor(public text: string) {} });
});
afterEach(() => vi.unstubAllGlobals());

it('辞書取得の完了前に🔊を押しても、取得を待ってネイティブ音源で再生する', async () => {
  let resolveLookup!: (v: unknown) => void;
  request.mockImplementation((req: { type: string }) => {
    if (req.type === 'lookupWord') return new Promise(r => { resolveLookup = r; });
    return Promise.resolve({ ok: true, kind: 'audio', played: true });
  });
  void loadWordInfo(overlay, 'resilient', 1);
  // まだ辞書応答が来ていない（ポップアップ上の audioUrl は null）時点で🔊を押す。
  const playing = playPronunciation('resilient', null);
  resolveLookup({ ok: true, kind: 'word', ipa: 'rɪˈzɪl.jənt', audioUrl: 'https://x/resilient.mp3' });
  await playing;
  expect(request).toHaveBeenCalledWith({ type: 'playAudio', url: 'https://x/resilient.mp3' });
  expect(speak).not.toHaveBeenCalled();
});

it('別の単語の取得待ちは使わず、音源が無ければ読み上げにフォールバックする', async () => {
  request.mockImplementation(() => new Promise(() => {}));
  void loadWordInfo(overlay, 'other', 1);
  await playPronunciation('resilient', null);
  expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'playAudio' }));
  expect(speak).toHaveBeenCalled();
});

it('取得が長引く場合は待ちすぎず読み上げにフォールバックする', async () => {
  vi.useFakeTimers();
  try {
    request.mockImplementation(() => new Promise(() => {}));
    void loadWordInfo(overlay, 'resilient', 1);
    const playing = playPronunciation('resilient', null);
    await vi.advanceTimersByTimeAsync(10_000);
    await playing;
    expect(speak).toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it('ネイティブ再生に失敗したら読み上げにフォールバックする', async () => {
  request.mockResolvedValue({ ok: true, kind: 'audio', played: false });
  await playPronunciation('resilient', 'https://x/resilient.mp3');
  expect(speak).toHaveBeenCalled();
});
