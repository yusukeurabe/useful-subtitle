import { describe, it, expect } from 'vitest';
import { parseExplanation } from '../src/shared/explanation';

describe('parseExplanation', () => {
  it('splits 訳/説明 labels into gloss and explanation', () => {
    const r = parseExplanation('訳: 言語・言葉・国語\n説明: 文脈ではこう。');
    expect(r.gloss).toBe('言語・言葉・国語');
    expect(r.explanation).toBe('文脈ではこう。');
  });

  it('accepts full-width colons', () => {
    const r = parseExplanation('訳： 言語\n説明： 説明文');
    expect(r.gloss).toBe('言語');
    expect(r.explanation).toBe('説明文');
  });

  it('accepts the 訳語 label variant', () => {
    expect(parseExplanation('訳語: 言語\n説明: x').gloss).toBe('言語');
  });

  it('normalizes separators to ・ and caps at 3', () => {
    expect(parseExplanation('訳: a、b,c／d\n説明: x').gloss).toBe('a・b・c');
  });

  it('keeps multi-line explanation', () => {
    expect(parseExplanation('訳: 言語\n説明: 行1\n行2').explanation).toBe('行1\n行2');
  });

  it('returns null gloss when 訳 label is missing', () => {
    const r = parseExplanation('説明: ただの説明');
    expect(r.gloss).toBeNull();
    expect(r.explanation).toBe('ただの説明');
  });

  it('falls back to whole text when no labels (old cache)', () => {
    const r = parseExplanation('これは普通の説明文です。');
    expect(r.gloss).toBeNull();
    expect(r.explanation).toBe('これは普通の説明文です。');
  });

  it('uses remainder as explanation when 説明 missing but 訳 present', () => {
    const r = parseExplanation('訳: 言語\nラベルなしの説明');
    expect(r.gloss).toBe('言語');
    expect(r.explanation).toBe('ラベルなしの説明');
  });

  it('treats empty gloss value as null', () => {
    const r = parseExplanation('訳:\n説明: x');
    expect(r.gloss).toBeNull();
    expect(r.explanation).toBe('x');
  });

  it('returns empty explanation for blank input', () => {
    const r = parseExplanation('   ');
    expect(r.gloss).toBeNull();
    expect(r.explanation).toBe('');
  });
});
