import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeClient } from '../src/background/nativeClient';
import { createRequestBoundary } from '../src/background/requestBoundary';
import { makeCacheKey } from '../src/background/cache';
import { DEFAULT_SETTINGS, getSettings, saveSettings } from '../src/shared/settings';
import type { HandlerDeps } from '../src/background/handler';

const id = 'a'.repeat(32);
const video = (tabId = 1): chrome.runtime.MessageSender => ({ id, frameId: 0, tab: { id: tabId } as chrome.tabs.Tab, url: 'https://www.youtube.com/watch?v=one' });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const clients: ReturnType<typeof createNativeClient>[] = [];
function harness(overrides: Partial<HandlerDeps> = {}) {
  let reply!: (value: unknown) => void;
  const port = {
    postMessage: vi.fn(), disconnect: vi.fn(),
    onMessage: { addListener: (fn: typeof reply) => { reply = fn; } },
    onDisconnect: { addListener: vi.fn() },
  };
  const native = createNativeClient(() => port as unknown as chrome.runtime.Port);
  clients.push(native);
  const cached = new Map<string, string>();
  const deps: HandlerDeps = {
    getSettings: async () => ({ ...DEFAULT_SETTINGS, provider: 'claude-subscription' }),
    getCached: async key => cached.get(key),
    setCached: vi.fn(async (key, text) => { cached.set(key, text); }),
    callSubscription: vi.fn(native.request), callAi: vi.fn(async () => 'api'),
    getWordInfo: async () => ({ ipa: null, audioUrl: null }), playOffscreenAudio: async () => {},
    ...overrides,
  };
  const boundary = createRequestBoundary(deps, native);
  const send = (text: string, tabId = 1) => boundary.dispatch({ type: 'translateLine', text }, video(tabId))!;
  const finish = (text: string) => reply({ id: port.postMessage.mock.lastCall![0].id, ok: true, text });
  const key = (text: string) => makeCacheKey({ type: 'translateLine', text }, DEFAULT_SETTINGS.model, 'ja', 'claude-subscription');
  return { native, port, cached, deps, boundary, send, finish, key };
}
beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(chrome.runtime, { id, getURL: (path: string) => `chrome-extension://${id}/${path}` });
});
afterEach(() => { for (const client of clients.splice(0)) client.reset(); vi.useRealTimers(); });

describe('boundary + handler + native scheduler', () => {
  it('returns and caches started A for history after B arrives', async () => {
    const h = harness(); const a = h.send('A'); await flush();
    const b = h.send('B'); await flush();
    h.finish('translated A');
    expect(await a).toEqual({ ok: true, text: 'translated A' });
    expect(h.cached.get(h.key('A'))).toBe('translated A');
    expect(h.port.postMessage.mock.lastCall![0].user).toContain('\nB');
    h.finish('translated B'); expect(await b).toEqual({ ok: true, text: 'translated B' });
  });
  it('retires pending A before reading cached B without canceling active work, interactions or other tabs', async () => {
    const h = harness(); const active = h.send('X', 2); await flush();
    const pending = h.send('A'); await flush();
    const other = h.send('other', 3); await flush();
    const interactive = h.boundary.dispatch({ type: 'explainSentence', text: 'explain' }, video())!; await flush();
    h.cached.set(h.key('B'), 'cached B');
    expect(await h.send('B')).toEqual({ ok: true, text: 'cached B' });
    h.finish('translated X'); await active; await flush();
    expect(h.port.postMessage.mock.lastCall![0].user).toContain('explain');
    h.finish('explanation'); await interactive; await flush();
    expect(h.port.postMessage.mock.lastCall![0].user).toContain('\nother');
    h.finish('other translation'); await other; await flush();
    expect(h.port.postMessage).toHaveBeenCalledTimes(3);
    expect(await pending).toMatchObject({ code: 'CANCELED' });
  });
  it('retires the prior queue synchronously even while the newest cache read is unresolved', async () => {
    let resolve!: (value: string) => void;
    const h = harness({ getCached: async key => key.endsWith('␟B')
      ? new Promise<string>(yes => { resolve = yes; }) : undefined });
    const active = h.send('X', 2); await flush();
    const pending = h.send('A'); await flush();
    const newest = h.send('B');
    // The older active task can finish before B's first async settings read returns.
    h.finish('translated X'); await active; await flush();
    expect(h.port.postMessage).toHaveBeenCalledTimes(1);
    expect(await pending).toMatchObject({ code: 'CANCELED' });
    resolve('cached B');
    expect(await newest).toEqual({ ok: true, text: 'cached B' });
    expect(h.port.postMessage).toHaveBeenCalledTimes(1);
  });
  it('does not enqueue a slow old cache miss after newer cached B', async () => {
    let resolve!: (value: undefined) => void;
    const h = harness({ getCached: vi.fn().mockImplementationOnce(() => new Promise(yes => { resolve = yes; })).mockResolvedValue('cached B') });
    const old = h.send('A'); await flush();
    expect(await h.send('B')).toEqual({ ok: true, text: 'cached B' });
    resolve(undefined);
    expect(await old).toMatchObject({ code: 'CANCELED' });
    expect(h.port.postMessage).not.toHaveBeenCalled();
  });
  it('shares active A for A→B→A and retires queued B through the actual boundary', async () => {
    const h = harness(); const first = h.send('A'); await flush();
    const b = h.send('B'); await flush();
    const latest = h.send('A'); await flush();
    h.finish('translated A');
    expect(await first).toEqual({ ok: true, text: 'translated A' });
    expect(await latest).toEqual({ ok: true, text: 'translated A' });
    expect(await b).toMatchObject({ code: 'CANCELED' });
    expect(h.port.postMessage).toHaveBeenCalledTimes(1);
  });
  it.each(['settings', 'navigation'] as const)('still cancels active and pending work on %s', async reason => {
    const h = harness(); const active = h.send('A'); await flush(); const pending = h.send('B'); await flush();
    if (reason === 'settings') h.boundary.settingsChanged();
    else h.boundary.dropTab(1);
    expect(await active).toMatchObject({ code: 'CANCELED' });
    expect(await pending).toMatchObject({ code: 'CANCELED' });
    expect(h.deps.setCached).not.toHaveBeenCalled();
  });
  it('preserves started API responses when another caption arrives', async () => {
    const resolve: Array<(text: string) => void> = [];
    const h = harness({
      getSettings: async () => ({ ...DEFAULT_SETTINGS, apiKey: 'saved' }),
      callAi: () => new Promise(yes => resolve.push(yes)),
    });
    const a = h.send('A'); await flush(); const b = h.send('B'); await flush();
    resolve[0]!('API A'); expect(await a).toEqual({ ok: true, text: 'API A' });
    resolve[1]!('API B'); expect(await b).toEqual({ ok: true, text: 'API B' });
    expect(h.deps.setCached).toHaveBeenCalledTimes(2);
  });
});


describe('saved feature switches on subsequent requests', () => {
  it.each([
    ['anthropic', 'dualSubtitle'], ['claude-subscription', 'dualSubtitle'],
    ['anthropic', 'enabled'], ['claude-subscription', 'enabled'],
  ] as const)('%s stops new AI work after saving %s=false and resumes when enabled', async (provider, toggle) => {
    await saveSettings({ provider, apiKey: 'saved', enabled: true, dualSubtitle: true });
    const getCached = vi.fn(async () => undefined);
    const h = harness({ getSettings, getCached });
    const initial = h.send('initial'); await flush();
    if (provider === 'claude-subscription') h.finish('initial');
    expect(await initial).toMatchObject({ ok: true });
    vi.mocked(h.deps.callAi).mockClear();
    vi.mocked(h.deps.callSubscription).mockClear();
    getCached.mockClear();

    // Empty API key also proves OFF is checked before key validation.
    await saveSettings({ [toggle]: false, apiKey: '' });
    h.boundary.settingsChanged();
    expect(await h.send('after saving OFF')).toMatchObject({ ok: false, code: 'CANCELED' });
    if (toggle === 'enabled') {
      expect(await h.boundary.dispatch({ type: 'explainSentence', text: 'new sentence' }, video())).toMatchObject({ code: 'CANCELED' });
      expect(await h.boundary.dispatch({ type: 'explainSelection', selection: 'new', context: 'new sentence' }, video())).toMatchObject({ code: 'CANCELED' });
    }
    expect(h.deps.callAi).not.toHaveBeenCalled();
    expect(h.deps.callSubscription).not.toHaveBeenCalled();
    expect(getCached).not.toHaveBeenCalled();

    await saveSettings({ [toggle]: true, apiKey: 'saved' });
    h.boundary.settingsChanged();
    const restored = h.send('after saving ON'); await flush();
    if (provider === 'claude-subscription') h.finish('restored');
    expect(await restored).toMatchObject({ ok: true });
    expect(h.deps.callAi).toHaveBeenCalledTimes(provider === 'anthropic' ? 1 : 0);
    expect(h.deps.callSubscription).toHaveBeenCalledTimes(provider === 'claude-subscription' ? 1 : 0);
  });

  it.each(['anthropic', 'claude-subscription'] as const)('%s still permits explicit ping and dictionary/audio while disabled', async provider => {
    const h = harness({ getSettings });
    await saveSettings({ provider, apiKey: 'saved', enabled: false, dualSubtitle: false });
    h.boundary.settingsChanged();
    const ping = h.boundary.dispatch({ type: 'ping' }, { id, url: chrome.runtime.getURL('options.html') });
    await flush();
    if (provider === 'claude-subscription') h.finish('OK');
    expect(await ping).toMatchObject({ ok: true });
    expect(await h.boundary.dispatch({ type: 'lookupWord', text: 'word' }, video())).toMatchObject({ ok: true, kind: 'word' });
    expect(await h.boundary.dispatch({ type: 'playAudio', url: 'https://dictionary.cambridge.org/audio.mp3' }, video())).toMatchObject({ ok: true, played: true });
    expect(h.deps.callAi).toHaveBeenCalledTimes(provider === 'anthropic' ? 1 : 0);
    expect(h.deps.callSubscription).toHaveBeenCalledTimes(provider === 'claude-subscription' ? 1 : 0);
  });

  it.each(['anthropic', 'claude-subscription'] as const)('%s permits manual explanation with only automatic translation disabled', async provider => {
    const h = harness({ getSettings });
    await saveSettings({ provider, apiKey: 'saved', enabled: true, dualSubtitle: false });
    h.boundary.settingsChanged();
    const explanation = h.boundary.dispatch({ type: 'explainSentence', text: 'a sentence' }, video());
    await flush();
    if (provider === 'claude-subscription') h.finish('explanation');
    expect(await explanation).toMatchObject({ ok: true });
  });
});
