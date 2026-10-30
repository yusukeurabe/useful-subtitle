// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSettings, saveSettings } from '../src/shared/settings';
import { sendRequest } from '../src/shared/messages';
vi.mock('../src/shared/messages', () => ({ sendRequest: vi.fn(async () => ({ ok: true, text: 'OK' })) }));
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };
const field = (id: string) => document.getElementById(id) as HTMLInputElement;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  Object.assign(chrome.runtime, { id: 'a'.repeat(32) });
  document.body.innerHTML = readFileSync('src/options/options.html', 'utf8');
});
async function start() { await import('../src/options/options'); await flush(); }

describe('options provider', () => {
  it('defaults to API and shows the runtime extension ID and setup command', async () => {
    await start();
    expect(field('apiArea').hidden).toBe(false);
    expect(field('subscriptionArea').hidden).toBe(true);
    expect(field('extensionId').textContent).toBe('a'.repeat(32));
    expect(field('setupCommand').value).toBe(`npm run setup:native -- --browser brave --extension-id ${'a'.repeat(32)}`);
  });
  it('switches provider without erasing API key, model, or feature switches', async () => {
    await saveSettings({ apiKey: 'saved-key', model: 'custom-model', dualSubtitle: false });
    await start();
    field('provider').value = 'claude-subscription';
    field('provider').dispatchEvent(new Event('change'));
    await flush();
    expect(field('apiArea').hidden).toBe(true);
    expect(field('subscriptionArea').hidden).toBe(false);
    expect(await getSettings()).toMatchObject({ provider: 'claude-subscription', apiKey: 'saved-key', model: 'custom-model', dualSubtitle: false });
    field('provider').value = 'anthropic'; field('provider').dispatchEvent(new Event('change')); await flush();
    expect(field('apiKey').value).toBe('saved-key');
  });
  it('allows subscription ping without an API key and saves the selected mode first', async () => {
    await start(); field('provider').value = 'claude-subscription'; field('test').click(); await flush();
    expect((await getSettings()).provider).toBe('claude-subscription');
    expect(sendRequest).toHaveBeenCalledWith({ type: 'ping' });
    expect(field('status').textContent).toContain('成功');
  });
  it('blocks API ping without a key', async () => {
    await start(); field('test').click(); await flush();
    expect(sendRequest).not.toHaveBeenCalled();
    expect(field('status').textContent).toContain('APIキー');
  });
});
