import { describe, it, expect } from 'vitest';
import { makeCacheKey, getCached, setCached } from '../src/background/cache';

const model = 'claude-haiku-4-5-20251001';

describe('makeCacheKey', () => {
  it('is deterministic for the same input', () => {
    const a = makeCacheKey({ type: 'translateLine', text: 'Hello' }, model, 'ja');
    const b = makeCacheKey({ type: 'translateLine', text: 'Hello' }, model, 'ja');
    expect(a).toBe(b);
  });

  it('differs between translateLine and explainSelection', () => {
    const t = makeCacheKey({ type: 'translateLine', text: 'run' }, model, 'ja');
    const e = makeCacheKey(
      { type: 'explainSelection', selection: 'run', context: 'run' },
      model,
      'ja',
    );
    expect(t).not.toBe(e);
  });

  it('differs when the explanation language changes', () => {
    const ja = makeCacheKey(
      { type: 'explainSelection', selection: 'run', context: 'I run' },
      model,
      'ja',
    );
    const en = makeCacheKey(
      { type: 'explainSelection', selection: 'run', context: 'I run' },
      model,
      'en',
    );
    expect(ja).not.toBe(en);
  });
});

describe('cache store', () => {
  it('returns undefined for a missing key', async () => {
    expect(await getCached('missing-key')).toBeUndefined();
  });

  it('round-trips a stored value', async () => {
    await setCached('round-trip-key', 'value-1');
    expect(await getCached('round-trip-key')).toBe('value-1');
  });
});
