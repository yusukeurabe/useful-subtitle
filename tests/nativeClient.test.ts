import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeClient } from '../src/background/nativeClient';

function harness() {
  const ports: Array<{ postMessage: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; reply: (value: unknown) => void; lost: () => void }> = [];
  const connect = vi.fn(() => {
    let reply!: (value: unknown) => void;
    let lost!: () => void;
    const port = {
      postMessage: vi.fn(), disconnect: vi.fn(),
      onMessage: { addListener: (fn: typeof reply) => { reply = fn; } },
      onDisconnect: { addListener: (fn: typeof lost) => { lost = fn; } },
    };
    ports.push({ ...port, reply: v => reply(v), lost: () => lost() });
    return port as unknown as chrome.runtime.Port;
  });
  const client = createNativeClient(connect);
  const send = (text = 'hello', tabId = 1, kind: 'translation' | 'interactive' = 'translation', retry = false) => {
    const promise = client.request({ model: 'claude-haiku-5-5', system: 'translate', user: text }, { tabId, kind, retry });
    void promise.catch(() => {});
    return promise;
  };
  const finish = (text = 'ok') => {
    const port = ports.at(-1)!;
    port.reply({ id: port.postMessage.mock.lastCall![0].id, ok: true, text });
  };
  return { client, connect, ports, send, finish };
}

describe('native scheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('deduplicates same-tab requests and omits API key', async () => {
    const h = harness();
    const a = h.client.request({ model: 'm', system: 's', user: 'u', apiKey: 'secret' } as never, { kind: 'translation', tabId: 1 });
    const b = h.client.request({ model: 'm', system: 's', user: 'u' }, { kind: 'translation', tabId: 1 });
    expect(a).toBe(b);
    expect(h.ports[0]!.postMessage.mock.lastCall![0]).not.toHaveProperty('apiKey');
    h.finish();
    expect(await a).toBe('ok');
  });
  it('replaces a pending caption, deduplicates queued work and prioritizes interactive', async () => {
    const h = harness();
    const a = h.send('active');
    const old = h.send('old');
    const latest = h.send('latest');
    expect(h.send('latest')).toBe(latest);
    const interactive = h.send('explain', 1, 'interactive');
    await expect(old).rejects.toMatchObject({ code: 'CANCELED' });
    h.finish(); await a;
    expect(h.ports[0]!.postMessage.mock.lastCall![0].user).toBe('explain');
    h.finish(); await interactive;
    expect(h.ports[0]!.postMessage.mock.lastCall![0].user).toBe('latest');
    h.finish(); await latest;
  });
  it.each(['translation', 'interactive'] as const)('bounds the %s queue', async kind => {
    const h = harness(); h.send('active');
    for (let i = 0; i < 8; i++) h.send(String(i), i + 2, kind);
    await expect(h.send('overflow', 99, kind)).rejects.toMatchObject({ code: 'BUSY' });
    h.client.reset();
  });
  it('drops only work for a closed or navigated tab, including active work', async () => {
    const h = harness(); const a = h.send('same', 1); const b = h.send('same', 2);
    h.client.dropTab(1);
    await expect(a).rejects.toMatchObject({ code: 'CANCELED' });
    expect(h.ports).toHaveLength(1);
    vi.advanceTimersByTime(750);
    expect(h.ports).toHaveLength(2);
    h.ports[0]!.reply({ id: '1', ok: true, text: 'late' });
    h.finish('other'); expect(await b).toBe('other');
  });
  it('drops pending tab requests without affecting active other tab', async () => {
    const h = harness(); const a = h.send('active'); const b = h.send('pending', 2); const c = h.send('click', 2, 'interactive');
    h.client.dropTab(2);
    await expect(b).rejects.toMatchObject({ code: 'CANCELED' });
    await expect(c).rejects.toMatchObject({ code: 'CANCELED' });
    h.finish(); expect(await a).toBe('ok');
  });
  it.each([{ id: '1', ok: true, text: '' }, { id: '1', ok: false, code: 'BAD' }, null, { id: 'wrong', ok: true, text: 'x' }])('fails malformed replies safely: %j', async reply => {
    const h = harness(); const a = h.send(); h.ports[0]!.reply(reply);
    await expect(a).rejects.toMatchObject({ code: 'UNKNOWN' });
  });
  it('maps host error codes without exposing raw error detail', async () => {
    const h = harness(); const a = h.send(); h.ports[0]!.reply({ id: '1', ok: false, code: 'AUTH', error: 'secret raw detail' });
    await expect(a).rejects.toMatchObject({ code: 'AUTH', message: expect.not.stringContaining('secret') });
  });
  it('cleans active and pending requests on timeout and ignores late replies', async () => {
    const h = harness(); const a = h.send(); const b = h.send('pending');
    vi.advanceTimersByTime(55_000);
    await expect(a).rejects.toMatchObject({ code: 'TIMEOUT' });
    await expect(b).rejects.toMatchObject({ code: 'TIMEOUT' });
    h.ports[0]!.reply({ id: '1', ok: true, text: 'late' });
    expect(h.ports[0]!.disconnect).toHaveBeenCalledOnce();
  });
  it('cleans up on disconnect', async () => {
    const h = harness(); const a = h.send(); const b = h.send('pending'); h.ports[0]!.lost();
    await expect(a).rejects.toMatchObject({ code: 'NATIVE_SETUP' });
    await expect(b).rejects.toMatchObject({ code: 'NATIVE_SETUP' });
  });
  it('disconnects after 30 seconds idle', async () => {
    const h = harness(); const a = h.send(); h.finish(); await a;
    vi.advanceTimersByTime(29_999); expect(h.ports[0]!.disconnect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(h.ports[0]!.disconnect).toHaveBeenCalledOnce();
  });
  it('clears pending work and blocks automatic calls for 60 seconds on quota; explicit ping can retry', async () => {
    const h = harness(); const a = h.send(); const b = h.send('pending');
    h.ports[0]!.reply({ id: '1', ok: false, code: 'RATE_LIMIT' });
    await expect(a).rejects.toMatchObject({ code: 'RATE_LIMIT' });
    await expect(b).rejects.toMatchObject({ code: 'RATE_LIMIT' });
    await expect(h.send('blocked')).rejects.toMatchObject({ code: 'RATE_LIMIT' });
    const ping = h.send('ping', 0, 'interactive', true); h.finish(); await ping;
    vi.advanceTimersByTime(60_000);
    const next = h.send('allowed'); h.finish(); await next;
  });
  it('login sends only the login action, runs before queued work and lifts the cooldown', async () => {
    const h = harness();
    const failed = h.send('first', 1, 'interactive');
    h.ports[0]!.reply({ id: h.ports[0]!.postMessage.mock.lastCall![0].id, ok: false, code: 'AUTH' });
    await expect(failed).rejects.toMatchObject({ code: 'AUTH' });
    await expect(h.send('blocked', 1, 'interactive')).rejects.toMatchObject({ code: 'AUTH' });
    const login = h.client.login();
    expect(h.client.login()).toBe(login);
    const sent = h.ports[0]!.postMessage.mock.lastCall![0];
    expect(sent).toEqual({ id: expect.any(String), action: 'login' });
    h.ports[0]!.reply({ id: sent.id, ok: true, text: 'OK' });
    await expect(login).resolves.toBeUndefined();
    const after = h.send('after', 1, 'interactive');
    expect(h.ports.at(-1)!.postMessage.mock.lastCall![0].user).toBe('after');
    h.finish(); await after;
  });
  it('login failure uses the login message and does not start a cooldown', async () => {
    const h = harness();
    const login = h.client.login();
    const sent = h.ports[0]!.postMessage.mock.lastCall![0];
    h.ports[0]!.reply({ id: sent.id, ok: false, code: 'NETWORK' });
    await expect(login).rejects.toMatchObject({ code: 'AUTH', message: 'ログインできませんでした。もう一度お試しください。' });
    const next = h.send('next', 1, 'interactive');
    h.finish(); await expect(next).resolves.toBe('ok');
  });
  it('login waits for the active request and times out after 250 seconds without cooldown', async () => {
    const h = harness();
    const active = h.send('active', 1, 'interactive');
    const login = h.client.login();
    void login.catch(() => {});
    expect(h.ports[0]!.postMessage).toHaveBeenCalledTimes(1);
    h.finish(); await active;
    expect(h.ports[0]!.postMessage.mock.lastCall![0]).toMatchObject({ action: 'login' });
    vi.advanceTimersByTime(60_000);
    expect(h.ports[0]!.disconnect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(190_000);
    await expect(login).rejects.toMatchObject({ code: 'AUTH' });
    expect(h.ports[0]!.disconnect).toHaveBeenCalled();
    vi.advanceTimersByTime(750);
    const next = h.send('next', 1, 'interactive');
    h.finish(); await expect(next).resolves.toBe('ok');
  });
  it('login is not canceled when its tab closes', async () => {
    const h = harness();
    const login = h.client.login();
    h.client.dropTab(1);
    const sent = h.ports[0]!.postMessage.mock.lastCall![0];
    h.ports[0]!.reply({ id: sent.id, ok: true, text: 'OK' });
    await expect(login).resolves.toBeUndefined();
  });
  it('a queued login survives the active request failing with AUTH', async () => {
    const h = harness();
    const active = h.send('active', 1, 'interactive');
    const queued = h.send('queued', 2, 'interactive');
    const login = h.client.login();
    h.ports[0]!.reply({ id: h.ports[0]!.postMessage.mock.lastCall![0].id, ok: false, code: 'AUTH' });
    await expect(active).rejects.toMatchObject({ code: 'AUTH' });
    await expect(queued).rejects.toMatchObject({ code: 'AUTH' });
    const sent = h.ports[0]!.postMessage.mock.lastCall![0];
    expect(sent).toEqual({ id: expect.any(String), action: 'login' });
    h.ports[0]!.reply({ id: sent.id, ok: true, text: 'OK' });
    await expect(login).resolves.toBeUndefined();
  });
  it('login 実行中に接続プログラムが切れても利用停止を掛けない（ログインの失敗として扱う）', async () => {
    const h = harness();
    const login = h.client.login();
    void login.catch(() => {});
    expect(h.ports[0]!.postMessage.mock.lastCall![0]).toMatchObject({ action: 'login' });
    h.ports[0]!.lost();
    await expect(login).rejects.toMatchObject({ code: 'AUTH', message: 'ログインできませんでした。もう一度お試しください。' });
    const next = h.send('next', 1, 'interactive');
    vi.advanceTimersByTime(750);
    expect(h.ports.at(-1)!.postMessage.mock.lastCall![0].user).toBe('next');
    h.finish(); await expect(next).resolves.toBe('ok');
  });
  it('reset cancels a pending login with CANCELED', async () => {
    const h = harness();
    const login = h.client.login();
    h.client.reset();
    await expect(login).rejects.toMatchObject({ code: 'CANCELED' });
  });
});

it.each(['AUTH', 'NATIVE_SETUP', 'NETWORK', 'UNKNOWN'])('prevents caption retry spam after %s and allows an explicit test', async code => {
  const h = harness(); const a = h.send();
  h.ports[0]!.reply({ id: '1', ok: false, code });
  await expect(a).rejects.toMatchObject({ code });
  await expect(h.send('next caption')).rejects.toMatchObject({ code });
  expect(h.ports[0]!.postMessage).toHaveBeenCalledTimes(1);
  const ping = h.send('ping', 0, 'interactive', true); h.finish(); await ping;
  const recovered = h.send('recovered'); h.finish(); await recovered;
  h.client.reset();
});

it('prevents reconnect spam when the host is unavailable', async () => {
  const connect = vi.fn(() => { throw new Error('raw local path'); });
  const client = createNativeClient(connect);
  const params = { model: 'm', system: 's', user: 'u' };
  await expect(client.request(params, { kind: 'translation', tabId: 1 })).rejects.toMatchObject({ code: 'NATIVE_SETUP' });
  await expect(client.request(params, { kind: 'translation', tabId: 1 })).rejects.toMatchObject({ code: 'NATIVE_SETUP' });
  expect(connect).toHaveBeenCalledTimes(1);
});

it('discards an obsolete pending caption when the latest caption matches active work', async () => {
  const h = harness(); const active = h.send('A'); const pending = h.send('B');
  expect(h.send('A')).toBe(active);
  await expect(pending).rejects.toMatchObject({ code: 'CANCELED' });
  h.finish(); await active;
  expect(h.ports[0]!.postMessage).toHaveBeenCalledTimes(1);
  h.client.reset();
});
