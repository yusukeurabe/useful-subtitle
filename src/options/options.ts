import { getSettings, saveSettings } from '../shared/settings';
import { sendRequest } from '../shared/messages';
import type { ExplanationLanguage } from '../shared/types';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} が見つかりません`);
  return node as T;
}

async function init(): Promise<void> {
  const apiKey = el<HTMLInputElement>('apiKey');
  const model = el<HTMLInputElement>('model');
  const lang = el<HTMLSelectElement>('lang');
  const dualSubtitle = el<HTMLInputElement>('dualSubtitle');
  const autoPause = el<HTMLInputElement>('autoPause');
  const enabled = el<HTMLInputElement>('enabled');
  const testBtn = el<HTMLButtonElement>('test');
  const status = el<HTMLSpanElement>('status');

  const s = await getSettings();
  apiKey.value = s.apiKey;
  model.value = s.model;
  lang.value = s.explanationLanguage;
  dualSubtitle.checked = s.dualSubtitle;
  autoPause.checked = s.autoPauseOnClick;
  enabled.checked = s.enabled;

  const setStatus = (msg: string, kind: '' | 'ok' | 'err' = ''): void => {
    status.textContent = msg;
    status.className = `status ${kind}`.trim();
  };

  const persist = (): Promise<void> =>
    saveSettings({
      apiKey: apiKey.value.trim(),
      model: model.value.trim() || s.model,
      explanationLanguage: lang.value as ExplanationLanguage,
      dualSubtitle: dualSubtitle.checked,
      autoPauseOnClick: autoPause.checked,
      enabled: enabled.checked,
    });

  for (const field of [apiKey, model, lang, dualSubtitle, autoPause, enabled]) {
    field.addEventListener('change', () => {
      void persist().then(() => setStatus('保存しました', 'ok'));
    });
  }

  testBtn.addEventListener('click', () => {
    void (async () => {
      await persist();
      if (!apiKey.value.trim()) {
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
