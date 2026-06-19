import { describe, it, expect } from 'vitest';
import { parseExplanation, parseSentenceMeaning } from '../src/shared/explanation';

describe('parseExplanation', () => {
  it('parses per-POS lines into senses with explanation', () => {
    const r = parseExplanation('V[I/T]: 走る・運営する\nN[C]: 走ること・得点\n説明: 文脈ではこう。');
    expect(r.senses).toEqual([
      { pos: 'V[I/T]', gloss: '走る・運営する' },
      { pos: 'N[C]', gloss: '走ること・得点' },
    ]);
    expect(r.explanation).toBe('文脈ではこう。');
  });

  it('accepts full-width colons in POS and 説明 lines', () => {
    const r = parseExplanation('Adj.： 美しい\n説明： 説明文');
    expect(r.senses).toEqual([{ pos: 'Adj.', gloss: '美しい' }]);
    expect(r.explanation).toBe('説明文');
  });

  it('tolerates a leading bullet on POS lines', () => {
    const r = parseExplanation('- V[I]: 走る\n説明: x');
    expect(r.senses).toEqual([{ pos: 'V[I]', gloss: '走る' }]);
  });

  it('normalizes separators to ・ and caps each POS at 3', () => {
    const r = parseExplanation('N[C]: a、b,c／d\n説明: x');
    expect(r.senses).toEqual([{ pos: 'N[C]', gloss: 'a・b・c' }]);
  });

  it('keeps multi-line explanation', () => {
    const r = parseExplanation('V[I]: 走る\n説明: 行1\n行2');
    expect(r.explanation).toBe('行1\n行2');
  });

  it('falls back to a single POS-less sense for a phrase 訳 line', () => {
    const r = parseExplanation('訳: 幸運を祈る\n説明: 舞台前のイディオム。');
    expect(r.senses).toEqual([{ pos: null, gloss: '幸運を祈る' }]);
    expect(r.explanation).toBe('舞台前のイディオム。');
  });

  it('accepts the 訳語 label variant for phrases', () => {
    expect(parseExplanation('訳語: 言語\n説明: x').senses).toEqual([{ pos: null, gloss: '言語' }]);
  });

  it('returns no senses when only 説明 is present', () => {
    const r = parseExplanation('説明: ただの説明');
    expect(r.senses).toEqual([]);
    expect(r.explanation).toBe('ただの説明');
  });

  it('falls back to whole text when no labels (old cache)', () => {
    const r = parseExplanation('これは普通の説明文です。');
    expect(r.senses).toEqual([]);
    expect(r.explanation).toBe('これは普通の説明文です。');
  });

  it('uses remainder as explanation when 説明 missing but POS present', () => {
    const r = parseExplanation('V[I]: 走る\nラベルなしの説明');
    expect(r.senses).toEqual([{ pos: 'V[I]', gloss: '走る' }]);
    expect(r.explanation).toBe('ラベルなしの説明');
  });

  it('drops POS lines whose gloss is empty', () => {
    const r = parseExplanation('N[C]:\n説明: x');
    expect(r.senses).toEqual([]);
    expect(r.explanation).toBe('x');
  });

  it('returns empty for blank input', () => {
    const r = parseExplanation('   ');
    expect(r.senses).toEqual([]);
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
