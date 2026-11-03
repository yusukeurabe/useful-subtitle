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

describe('options usage list', () => {
  const states = (selector: string) =>
    [...document.querySelectorAll(`.usage ${selector} .usage-state`)].map(cell => cell.textContent);
  const switchStates = () =>
    Object.fromEntries(
      ['dualSubtitle', 'showTranscriptPanel'].map(id => [
        id,
        field(id).closest('.row')?.querySelector('.usage-state')?.textContent,
      ]),
    );
  const selectProvider = async (value: string) => {
    field('provider').value = value;
    field('provider').dispatchEvent(new Event('change'));
    await flush();
  };

  it('lists only the features that actually consume the quota', async () => {
    await start();
    expect([...document.querySelectorAll('.usage tr td:first-child')].map(cell => cell.textContent)).toEqual([
      '字幕の語句をクリックしたときの解説',
      '接続テスト',
    ]);
  });
  it('has no switch for turning the whole extension off', async () => {
    await start();
    expect(document.getElementById('enabled')).toBeNull();
  });
  it('shows API wording for the default provider', async () => {
    await start();
    expect(field('usageTitle').textContent).toBe('その他の API を使用する機能（従量課金）');
    expect(states('[data-usage="used"]')).toEqual(Array(2).fill('API を使用する'));
    expect(field('usageNote').textContent).toContain('同じ内容の再表示では API を使用しません');
  });
  it('shows subscription wording for a saved subscription provider', async () => {
    await saveSettings({ provider: 'claude-subscription' });
    await start();
    expect(field('usageTitle').textContent).toBe('その他のサブスク枠を使う機能');
    expect(states('[data-usage="used"]')).toEqual(Array(2).fill('サブスク枠を使う'));
    expect(field('usageNote').textContent).toContain('同じ内容の再表示では枠を使いません');
  });
  it('labels each feature switch with API wording', async () => {
    await start();
    expect(switchStates()).toEqual({
      dualSubtitle: 'ON で API を使用する',
      showTranscriptPanel: 'カーソルを合わせると API を使用する',
    });
  });
  it('switches the feature switch labels with the provider', async () => {
    await start();
    await selectProvider('claude-subscription');
    expect(switchStates()).toEqual({
      dualSubtitle: 'ON でサブスク枠を使う',
      showTranscriptPanel: 'カーソルを合わせるとサブスク枠を使う',
    });
  });
  it.each(['anthropic', 'claude-subscription'])('shows no usage label on switches that do not consume the quota (%s)', async provider => {
    await start();
    await selectProvider(provider);
    for (const id of ['truecaseSubtitle', 'autoPause']) {
      expect(field(id).closest('.row')?.querySelector('.usage-state')).toBeNull();
    }
    expect(document.body.textContent).not.toMatch(/使わない|使用しない/);
  });
  it('places the feature switches between the provider and the usage list', async () => {
    await start();
    const follows = (a: string, b: string) =>
      Boolean(field(a).compareDocumentPosition(field(b)) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows('provider', 'dualSubtitle')).toBe(true);
    expect(follows('autoPause', 'usageTitle')).toBe(true);
  });
  it('marks the usage heading with a warning sign', async () => {
    await start();
    expect(field('usageTitle').parentElement?.textContent).toContain('⚠️');
  });
  it('updates the wording as soon as the provider changes', async () => {
    await start();
    await selectProvider('claude-subscription');
    expect(field('usageTitle').textContent).toBe('その他のサブスク枠を使う機能');
    await selectProvider('anthropic');
    expect(field('usageTitle').textContent).toBe('その他の API を使用する機能（従量課金）');
    expect(states('[data-usage="used"]')).toEqual(Array(2).fill('API を使用する'));
  });
});
