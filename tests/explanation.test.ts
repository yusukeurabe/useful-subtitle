import { describe, it, expect } from 'vitest';
import { parseExplanation, parseSentenceMeaning } from '../src/shared/explanation';

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

describe('parseSentenceMeaning', () => {
  it('splits 訳/説明 into translation and explanation', () => {
    const r = parseSentenceMeaning('訳: ずっと電話しようと思ってた\n説明: have been doing の継続。');
    expect(r.translation).toBe('ずっと電話しようと思ってた');
    expect(r.explanation).toBe('have been doing の継続。');
  });

  it('accepts full-width colons', () => {
    const r = parseSentenceMeaning('訳： こんにちは\n説明： あいさつ');
    expect(r.translation).toBe('こんにちは');
    expect(r.explanation).toBe('あいさつ');
  });

  it('keeps the full translation including 読点 (does not truncate like gloss)', () => {
    const r = parseSentenceMeaning('訳: 彼は、走って、逃げた\n説明: x');
    expect(r.translation).toBe('彼は、走って、逃げた');
  });

  it('keeps multi-line explanation', () => {
    expect(parseSentenceMeaning('訳: a\n説明: 行1\n行2').explanation).toBe('行1\n行2');
  });

  it('uses remainder as explanation when 説明 missing but 訳 present', () => {
    const r = parseSentenceMeaning('訳: 走る\nラベルなしの説明');
    expect(r.translation).toBe('走る');
    expect(r.explanation).toBe('ラベルなしの説明');
  });

  it('falls back to whole text when no labels', () => {
    const r = parseSentenceMeaning('ただの説明文。');
    expect(r.translation).toBe('');
    expect(r.explanation).toBe('ただの説明文。');
  });

  it('returns empty fields for blank input', () => {
    const r = parseSentenceMeaning('   ');
    expect(r.translation).toBe('');
    expect(r.explanation).toBe('');
  });
});
