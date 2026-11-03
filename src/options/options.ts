import { getSettings, saveSettings } from '../shared/settings';
import { sendRequest } from '../shared/messages';
import type { AiProvider, ExplanationLanguage } from '../shared/types';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} が見つかりません`);
  return node as T;
}

const API_USAGE = {
  title: 'API を使用する機能（従量課金）',
  used: 'API を使用する',
  unused: '使用しない',
  note: '一度翻訳・解説した内容は保存されるため、同じ内容の再表示では API を使用しません。',
};
const SUBSCRIPTION_USAGE = {
  title: 'サブスク枠を使う機能',
  used: 'サブスク枠を使う',
  unused: '使わない',
  note: '一度翻訳・解説した内容は保存されるため、同じ内容の再表示では枠を使いません。',
};

function renderUsage(provider: string): void {
  const usage = provider === 'claude-subscription' ? SUBSCRIPTION_USAGE : API_USAGE;
  el<HTMLElement>('usageTitle').textContent = usage.title;
  el<HTMLElement>('usageNote').textContent = usage.note;
  document.querySelectorAll<HTMLElement>('[data-uses-ai]').forEach((row) => {
    const state = row.querySelector('.usage-state');
    if (state) state.textContent = row.dataset.usesAi === 'true' ? usage.used : usage.unused;
  });
}

export async function init(): Promise<void> {
  const provider = el<HTMLSelectElement>('provider');
  const apiArea = el<HTMLElement>('apiArea');
  const subscriptionArea = el<HTMLElement>('subscriptionArea');
  const apiKey = el<HTMLInputElement>('apiKey');
  const model = el<HTMLInputElement>('model');
  const lang = el<HTMLSelectElement>('lang');
  const dualSubtitle = el<HTMLInputElement>('dualSubtitle');
  const autoPause = el<HTMLInputElement>('autoPause');
  const enabled = el<HTMLInputElement>('enabled');
  const truecaseSubtitle = el<HTMLInputElement>('truecaseSubtitle');
  const showTranscriptPanel = el<HTMLInputElement>('showTranscriptPanel');
  const testBtn = el<HTMLButtonElement>('test');
  const status = el<HTMLSpanElement>('status');

  const s = await getSettings();
  provider.value = s.provider;
  const showProvider = (): void => {
    apiArea.hidden = provider.value === 'claude-subscription';
    subscriptionArea.hidden = provider.value !== 'claude-subscription';
    renderUsage(provider.value);
  };
  showProvider();
  el<HTMLElement>('extensionId').textContent = chrome.runtime.id;
  el<HTMLInputElement>('setupCommand').value = `npm run setup:native -- --browser brave --extension-id ${chrome.runtime.id}`;
  apiKey.value = s.apiKey;
  model.value = s.model;
  lang.value = s.explanationLanguage;
  dualSubtitle.checked = s.dualSubtitle;
  autoPause.checked = s.autoPauseOnClick;
  enabled.checked = s.enabled;
  truecaseSubtitle.checked = s.truecaseSubtitle;
  showTranscriptPanel.checked = s.showTranscriptPanel;

  const setStatus = (msg: string, kind: '' | 'ok' | 'err' = ''): void => {
    status.textContent = msg;
    status.className = `status ${kind}`.trim();
  };

  const persist = (): Promise<void> =>
    saveSettings({
      provider: provider.value as AiProvider,
      apiKey: apiKey.value.trim(),
      model: model.value.trim() || s.model,
      explanationLanguage: lang.value as ExplanationLanguage,
      dualSubtitle: dualSubtitle.checked,
      autoPauseOnClick: autoPause.checked,
      enabled: enabled.checked,
      truecaseSubtitle: truecaseSubtitle.checked,
      showTranscriptPanel: showTranscriptPanel.checked,
    });

  for (const field of [
    provider, apiKey, model, lang, dualSubtitle, autoPause, enabled,
    truecaseSubtitle, showTranscriptPanel,
  ]) {
    field.addEventListener('change', () => {
      showProvider();
      void persist().then(() => setStatus('保存しました', 'ok'));
    });
  }

  testBtn.addEventListener('click', () => {
    void (async () => {
      await persist();
      if (provider.value === 'anthropic' && !apiKey.value.trim()) {
        setStatus('APIキーを入力してください', 'err');
        return;
      }
      setStatus('確認中…');
      testBtn.disabled = true;
      const res = await sendRequest({ type: 'ping' });
      testBtn.disabled = false;
      if (res.ok) setStatus('接続成功 ✓', 'ok');
      else setStatus(`接続失敗: ${res.error}`, 'err');
    })();
  });
}

void init().catch((e) => console.error('[Useful Subtitle] options init failed', e));
