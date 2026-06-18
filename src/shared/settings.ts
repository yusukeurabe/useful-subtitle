import type { Settings } from './types';

/** Claude Haiku 4.5（高速・低コスト。語句解説・行翻訳に最適）。 */
export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  provider: 'anthropic',
  model: DEFAULT_MODEL,
  explanationLanguage: 'ja',
  dualSubtitle: true,
  autoPauseOnClick: true,
  enabled: true,
};

/** 保存済み設定を読み込み、欠けている項目は既定値で補完して返す。 */
export async function getSettings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get(
    DEFAULT_SETTINGS as unknown as Record<string, unknown>,
  )) as Partial<Settings>;
  return { ...DEFAULT_SETTINGS, ...stored };
}

/** 設定の一部を保存する（指定したキーのみ更新）。 */
export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set(patch);
}
