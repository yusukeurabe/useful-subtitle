import { afterEach, describe, it, expect, vi } from 'vitest';
import { DEFAULT_MODEL, DEFAULT_SETTINGS, getSettings, saveSettings } from '../src/shared/settings';

describe('settings', () => {
  afterEach(() => vi.restoreAllMocks());
  it('returns defaults when nothing is stored', async () => {
    const s = await getSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('defaults to a Claude Haiku model, Japanese explanations, dual subtitle & auto-pause on', () => {
    expect(DEFAULT_SETTINGS.provider).toBe('anthropic');
    expect(DEFAULT_MODEL).toBe('claude-haiku-5-5');
    expect(DEFAULT_SETTINGS.model).toBe('claude-haiku-5-5');
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

  it('defaults to truecasing on, subtitle at 12% and transcript panel on', () => {
    expect(DEFAULT_SETTINGS.truecaseSubtitle).toBe(true);
    expect(DEFAULT_SETTINGS.subtitleBottomPercent).toBe(12);
    expect(DEFAULT_SETTINGS.showTranscriptPanel).toBe(true);
  });
});


describe('Haiku 5.5 settings migration', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(['claude-haiku-4-5-20251001', 'claude-haiku-4-5'])(
    'migrates %s once while preserving all other saved settings', async (model) => {
      const original = {
        ...DEFAULT_SETTINGS,
        model,
        apiKey: 'fake-key-for-migration-test',
        explanationLanguage: 'en' as const,
        dualSubtitle: false,
        subtitleBottomPercent: 24,
        showTranscriptPanel: false,
      };
      await saveSettings(original);
      const write = vi.spyOn(chrome.storage.local, 'set');
      const expected = { ...original, model: 'claude-haiku-5-5' };
      expect(await getSettings()).toEqual(expected);
      expect(await chrome.storage.local.get(null)).toEqual(expected);
      expect(write).toHaveBeenCalledExactlyOnceWith({ model: 'claude-haiku-5-5' });
      expect(await getSettings()).toEqual(expected);
      expect(write).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['my-custom-model', 'claude-haiku-4-5-custom', 'claude-haiku-5-5'])(
    'preserves %s without rewriting storage', async (model) => {
      await saveSettings({ model });
      const write = vi.spyOn(chrome.storage.local, 'set');
      expect((await getSettings()).model).toBe(model);
      expect(write).not.toHaveBeenCalled();
    },
  );
});
