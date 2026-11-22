import type { Settings } from './types';

/** Claude Haiku 5.5（高速・低コスト。語句解説・行翻訳に最適）。 */
export const DEFAULT_MODEL = 'claude-haiku-5-5';

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  provider: 'anthropic',
  model: DEFAULT_MODEL,
  explanationLanguage: 'ja',
  dualSubtitle: true,
  autoPauseOnClick: true,
  pauseOnSubtitleHover: true,
  truecaseSubtitle: true,
  subtitleBottomPercent: 12,
  showTranscriptPanel: true,
};

/** 保存済み設定を読み込み、欠けている項目は既定値で補完して返す。 */
export async function getSettings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get(
    DEFAULT_SETTINGS as unknown as Record<string, unknown>,
  )) as Partial<Settings>;
  // 旧既定モデルだけ移行し、API キーやカスタムモデルなどの保存値は維持する。
  if (stored.model === 'claude-haiku-4-5-20251001' || stored.model === 'claude-haiku-4-5') {
    await chrome.storage.local.set({ model: DEFAULT_MODEL });
    stored.model = DEFAULT_MODEL;
  }
  // 廃止した enabled=false の利用者は、更新後に自動送信が再開しないよう自動翻訳 OFF へ引き継ぐ。
  // 書き込みに失敗しても次回やり直せるよう、enabled の削除は最後に行う。
  const { enabled } = await chrome.storage.local.get('enabled');
  if (enabled === false) {
    await chrome.storage.local.set({ dualSubtitle: false });
    stored.dualSubtitle = false;
  }
  if (enabled !== undefined) await chrome.storage.local.remove('enabled');
  return { ...DEFAULT_SETTINGS, ...stored };
}

/** 設定の一部を保存する（指定したキーのみ更新）。 */
export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set(patch);
}

/**
 * content script から投げっぱなしで保存するための版。失敗しても reject しない。
 * 拡張を再読み込み（↻）した後もタブに残る古い content script では、storage を叩くと
 * "Extension context invalidated" が（同期例外として）出る。保存できなくてもそのページでは
 * 動かした値のまま使えるので、未処理エラーとしてコンソールに出さずに握りつぶす。
 */
export async function saveSettingsQuietly(patch: Partial<Settings>): Promise<void> {
  try {
    await chrome.storage.local.set(patch);
  } catch {
    // 再読み込み（F5）すれば新しい content script で保存できるようになる。
  }
}
