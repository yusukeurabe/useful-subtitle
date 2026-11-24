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

  it('drops an exact duplicate POS line the LLM repeated', () => {
    const r = parseExplanation('Adv.: その時・それから・そして\nAdv.: その時・それから・そして\n説明: x');
    expect(r.senses).toEqual([{ pos: 'Adv.', gloss: 'その時・それから・そして' }]);
  });

  it('merges repeated POS lines into one, keeping unique glosses up to 3', () => {
    const r = parseExplanation('Adv.: その時・それから\nAdj.: 当時の\nAdv.: それから・次に・さらに\n説明: x');
    expect(r.senses).toEqual([
      { pos: 'Adv.', gloss: 'その時・それから・次に' },
      { pos: 'Adj.', gloss: '当時の' },
    ]);
  });

  it('splits an English definition after | from the Japanese gloss', () => {
    const r = parseExplanation(
      'V[I/T]: 走る・運営する | to move quickly on foot\nN[C]: 走ること｜an act of running\n説明: x',
    );
    expect(r.senses).toEqual([
      { pos: 'V[I/T]', gloss: '走る・運営する', definition: 'to move quickly on foot' },
      { pos: 'N[C]', gloss: '走ること', definition: 'an act of running' },
    ]);
  });

  it('keeps slashes in the English definition (not treated as gloss separators)', () => {
    const r = parseExplanation('N[C]: 入力 | data and/or commands put into a computer\n説明: x');
    expect(r.senses).toEqual([
      { pos: 'N[C]', gloss: '入力', definition: 'data and/or commands put into a computer' },
    ]);
  });

  it('keeps the first English definition when a POS line is repeated', () => {
    const r = parseExplanation('Adv.: その時 | at that time\nAdv.: それから | after that\n説明: x');
    expect(r.senses).toEqual([
      { pos: 'Adv.', gloss: 'その時・それから', definition: 'at that time' },
    ]);
  });

  it('splits an English definition on a phrase 訳 line', () => {
    const r = parseExplanation('訳: 幸運を祈る | used to wish someone good luck\n説明: x');
    expect(r.senses).toEqual([
      { pos: null, gloss: '幸運を祈る', definition: 'used to wish someone good luck' },
    ]);
  });

  it('returns empty for blank input', () => {
    const r = parseExplanation('   ');
    expect(r.senses).toEqual([]);
    expect(r.explanation).toBe('');
  });

  // 実際に Brave で incremental の意味が出なかったときの応答（品詞が日本語名だった）。
  it('maps a Japanese POS name (形容詞) to its code instead of dropping the line', () => {
    const r = parseExplanation(
      '形容詞: 増分の・追加の | Increasing by a small, additional amount added to something that already exists.\n' +
        '説明: ここでは「年間30兆ドルの増分」という意味です。',
    );
    expect(r.senses).toEqual([
      {
        pos: 'Adj.',
        gloss: '増分の・追加の',
        definition: 'Increasing by a small, additional amount added to something that already exists.',
      },
    ]);
    expect(r.explanation).toBe('ここでは「年間30兆ドルの増分」という意味です。');
  });

  it.each([
    ['名詞', 'N'],
    ['可算名詞', 'N[C]'],
    ['不可算名詞', 'N[U]'],
    ['動詞', 'V'],
    ['自動詞', 'V[I]'],
    ['他動詞', 'V[T]'],
    ['副詞', 'Adv.'],
    ['代名詞', 'Pron.'],
    ['前置詞', 'Prep.'],
    ['接続詞', 'Conj.'],
    ['限定詞', 'Det.'],
    ['間投詞', 'Int.'],
    ['感動詞', 'Int.'],
  ])('maps the Japanese POS name %s to %s', (name, code) => {
    expect(parseExplanation(`${name}: 訳 | def\n説明: x`).senses).toEqual([
      { pos: code, gloss: '訳', definition: 'def' },
    ]);
  });

  it.each([
    ['Adjective', 'Adj.'],
    ['noun', 'N'],
    ['Verb', 'V'],
    ['Adverb', 'Adv.'],
  ])('maps the spelled-out English POS name %s to %s', (name, code) => {
    expect(parseExplanation(`${name}: 訳\n説明: x`).senses).toEqual([{ pos: code, gloss: '訳' }]);
  });

  it('accepts a code followed by a parenthesized Japanese name', () => {
    expect(parseExplanation('Adj.（形容詞）: 増分の\n説明: x').senses).toEqual([
      { pos: 'Adj.', gloss: '増分の' },
    ]);
    expect(parseExplanation('Adj. (形容詞): 増分の\n説明: x').senses).toEqual([
      { pos: 'Adj.', gloss: '増分の' },
    ]);
  });

  it('accepts a markdown-bolded POS code', () => {
    expect(parseExplanation('**Adj.**: 増分の\n説明: x').senses).toEqual([
      { pos: 'Adj.', gloss: '増分の' },
    ]);
  });

  it('keeps an unrecognized label line with | as a sense rather than dropping the meaning', () => {
    expect(parseExplanation('助動詞: 〜できる | used to say that something is possible\n説明: x').senses).toEqual([
      { pos: '助動詞', gloss: '〜できる', definition: 'used to say that something is possible' },
    ]);
  });

  it('keeps an unlabeled "gloss | definition" line as a POS-less sense', () => {
    expect(parseExplanation('増分の | added to something\n説明: x').senses).toEqual([
      { pos: null, gloss: '増分の', definition: 'added to something' },
    ]);
  });

  it('does not treat unknown non-POS labels without | as senses', () => {
    const r = parseExplanation('例: an incremental increase\n説明: x');
    expect(r.senses).toEqual([]);
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
