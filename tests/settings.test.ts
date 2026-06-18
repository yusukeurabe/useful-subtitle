import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, getSettings, saveSettings } from '../src/shared/settings';

describe('settings', () => {
  it('returns defaults when nothing is stored', async () => {
    const s = await getSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('defaults to a Claude Haiku model, Japanese explanations, dual subtitle & auto-pause on', () => {
    expect(DEFAULT_SETTINGS.provider).toBe('anthropic');
    expect(DEFAULT_SETTINGS.model).toContain('haiku');
    expect(DEFAULT_SETTINGS.explanationLanguage).toBe('ja');
    expect(DEFAULT_SETTINGS.dualSubtitle).toBe(true);
    expect(DEFAULT_SETTINGS.autoPauseOnClick).toBe(true);
    expect(DEFAULT_SETTINGS.enabled).toBe(true);
  });

  it('persists saved values', async () => {
    await saveSettings({ apiKey: 'sk-test-123' });
    const s = await getSettings();
    expect(s.apiKey).toBe('sk-test-123');
  });

  it('merges a stored partial with defaults', async () => {
    await saveSettings({ dualSubtitle: false });
    const s = await getSettings();
    expect(s.dualSubtitle).toBe(false);
    expect(s.model).toBe(DEFAULT_SETTINGS.model);
    expect(s.explanationLanguage).toBe('ja');
  });
});
