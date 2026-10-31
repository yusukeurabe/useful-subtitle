import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequestBoundary, isRequest } from '../src/background/requestBoundary';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import type { HandlerDeps } from '../src/background/handler';
const id = 'a'.repeat(32);
const video: chrome.runtime.MessageSender = { id, frameId: 0, tab: { id: 1 } as chrome.tabs.Tab, url: 'https://www.youtube.com/watch?v=one' };
function harness(overrides: Partial<HandlerDeps> = {}) {
  const deps: HandlerDeps = {
    getSettings: async () => ({ ...DEFAULT_SETTINGS, provider: 'claude-subscription' }),
    getCached: async () => undefined, setCached: vi.fn(async () => {}),
    callSubscription: vi.fn(async () => 'native'), callAi: vi.fn(async () => 'api'),
    getWordInfo: vi.fn(async () => ({ ipa: null, audioUrl: null })), playOffscreenAudio: vi.fn(async () => {}), ...overrides,
  };
  const native = { reset: vi.fn(), dropTab: vi.fn(), retireTranslation: vi.fn() };
  return { deps, native, boundary: createRequestBoundary(deps, native) };
}
beforeEach(() => Object.assign(chrome.runtime, { id, getURL: (path: string) => `chrome-extension://${id}/${path}` }));
describe('runtime boundary', () => {
  it.each([null, { type: 'unknown' }, { type: 'translateLine', text: 12 }, { type: 'translateLine', text: 'x'.repeat(8193) }, { type: 'playAudio', url: 'https://evil.test/a' }])('rejects malformed request %j', value => {
    expect(isRequest(value)).toBe(false);
    expect(harness().boundary.dispatch(value, video)).toBeUndefined();
  });
  it.each([{ ...video, id: 'other' }, { ...video, url: 'https://evil.test' }, { ...video, frameId: 1 }, { ...video, url: 'https://www.amazon.com/shop' }, { ...video, url: 'https://www.youtube.com.evil.test/watch' }])('rejects unauthorized sender %j', sender => {
    expect(harness().boundary.dispatch({ type: 'translateLine', text: 'hi' }, sender)).toBeUndefined();
  });
  it('allows only ping from options and never ping from a video', async () => {
    const h = harness(); const sender = { id, url: chrome.runtime.getURL('options.html') };
    expect(await h.boundary.dispatch({ type: 'ping' }, sender)).toMatchObject({ ok: true });
    expect(h.boundary.dispatch({ type: 'ping' }, video)).toBeUndefined();
    expect(h.boundary.dispatch({ type: 'translateLine', text: 'hi' }, sender)).toBeUndefined();
  });
  it('derives native context from sender and ignores tab ID in payload', async () => {
    const h = harness(); await h.boundary.dispatch({ type: 'translateLine', text: 'hi', tabId: 999 }, video);
    expect(h.deps.callSubscription).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ tabId: 1 }));
  });
  it.each(['settings', 'close', 'navigation', 'spa'] as const)('cancels asynchronous cache dispatch after %s', async event => {
    let resolve!: (value: string | undefined) => void;
    const h = harness({ getCached: () => new Promise(yes => { resolve = yes; }) });
    const result = h.boundary.dispatch({ type: 'translateLine', text: 'old' }, video);
    await Promise.resolve();
    if (event === 'settings') h.boundary.settingsChanged();
    else if (event === 'spa') await h.boundary.dispatch({ type: 'contextChanged' }, video);
    else h.boundary.dropTab(1);
    resolve(undefined);
    expect(await result).toMatchObject({ code: 'CANCELED' });
    expect(h.deps.callSubscription).not.toHaveBeenCalled();
  });
  it('cancels stale async settings reads', async () => {
    let resolve!: (value: typeof DEFAULT_SETTINGS) => void;
    const h = harness({ getSettings: () => new Promise(yes => { resolve = yes; }) });
    const result = h.boundary.dispatch({ type: 'translateLine', text: 'old' }, video);
    h.boundary.settingsChanged(); resolve({ ...DEFAULT_SETTINGS, provider: 'claude-subscription' });
    expect(await result).toMatchObject({ code: 'CANCELED' });
    expect(h.deps.callSubscription).not.toHaveBeenCalled();
  });
  it('uses sender URL to invalidate the previous page', async () => {
    const h = harness(); await h.boundary.dispatch({ type: 'translateLine', text: 'one' }, video);
    await h.boundary.dispatch({ type: 'translateLine', text: 'two' }, { ...video, url: 'https://www.youtube.com/watch?v=two' });
    expect(h.native.dropTab).toHaveBeenCalledTimes(2);
  });
  it('does not dispatch an older caption after a slower cache read', async () => {
    let resolve!: (value: undefined) => void;
    const h = harness({ getCached: vi.fn().mockImplementationOnce(() => new Promise(yes => { resolve = yes; })).mockResolvedValue(undefined) });
    const old = h.boundary.dispatch({ type: 'translateLine', text: 'old' }, video); await Promise.resolve();
    await h.boundary.dispatch({ type: 'translateLine', text: 'new' }, video); resolve(undefined);
    expect(await old).toMatchObject({ code: 'CANCELED' });
    expect(h.deps.callSubscription).toHaveBeenCalledTimes(1);
  });
});
