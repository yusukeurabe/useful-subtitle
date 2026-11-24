import { describe, it, expect } from 'vitest';
import { numberDefinitions, resolveDefinitionRefs } from '../src/shared/definitionRefs';

const GROUPS = [
  { pos: 'adjective', defs: ['in a series of amounts', 'happening gradually, in a series of small amounts'] },
  { pos: 'noun', defs: ['an amount added'] },
];

describe('numberDefinitions', () => {
  it('品詞をまたいで 1 から通し番号を振る', () => {
    expect(numberDefinitions(GROUPS)).toEqual([
      { n: 1, pos: 'adjective', text: 'in a series of amounts' },
      { n: 2, pos: 'adjective', text: 'happening gradually, in a series of small amounts' },
      { n: 3, pos: 'noun', text: 'an amount added' },
    ]);
  });

  it('定義が無ければ空配列', () => {
    expect(numberDefinitions(undefined)).toEqual([]);
    expect(numberDefinitions([])).toEqual([]);
  });
});

describe('resolveDefinitionRefs', () => {
  const candidates = numberDefinitions(GROUPS);

  it('品詞行の [番号] を候補の原文に置き換える', () => {
    expect(resolveDefinitionRefs('Adj.: 増分の・追加の | [2]\n説明: x', candidates)).toBe(
      'Adj.: 増分の・追加の | happening gradually, in a series of small amounts\n説明: x',
    );
  });

  it('全角の縦棒・全角の括弧・括弧内の空白も受け付ける', () => {
    expect(resolveDefinitionRefs('N[C]: 増分｜［ 3 ］', candidates)).toBe('N[C]: 増分 | an amount added');
  });

  it('全角数字の番号も受け付ける', () => {
    expect(resolveDefinitionRefs('N[C]: 増分 | ［３］', candidates)).toBe('N[C]: 増分 | an amount added');
  });

  it('複数の番号を並べたときは最初の番号を使う', () => {
    const expected = 'Adj.: 増分の | in a series of amounts';
    expect(resolveDefinitionRefs('Adj.: 増分の | [1, 3]', candidates)).toBe(expected);
    expect(resolveDefinitionRefs('Adj.: 増分の | [1,3]', candidates)).toBe(expected);
    expect(resolveDefinitionRefs('Adj.: 増分の | [1・3]', candidates)).toBe(expected);
  });

  it('改行が CRLF でも行ごとに置き換える', () => {
    expect(resolveDefinitionRefs('Adj.: 増分の・追加の | [2]\r\n説明: x', candidates)).toBe(
      'Adj.: 増分の・追加の | happening gradually, in a series of small amounts\n説明: x',
    );
  });

  it('番号の後ろに AI が文を書き足していても原文にそろえる', () => {
    expect(resolveDefinitionRefs('Adj.: 増分の | [2] happening gradually', candidates)).toBe(
      'Adj.: 増分の | happening gradually, in a series of small amounts',
    );
  });

  it('存在しない番号なら英語の部分を取り除いて日本語訳だけ残す', () => {
    expect(resolveDefinitionRefs('Adj.: 増分の | [9]\n説明: x', candidates)).toBe('Adj.: 増分の\n説明: x');
  });

  it('存在しない番号でも後ろに文があればその文を残す', () => {
    expect(resolveDefinitionRefs('Adj.: 増分の | [9] added bit by bit', candidates)).toBe(
      'Adj.: 増分の | added bit by bit',
    );
  });

  it('AI が自分で書いた定義と、番号の無い行はそのまま残す', () => {
    const raw = 'Adj.: 増分の | increasing little by little\n説明: [2] は使わない';
    expect(resolveDefinitionRefs(raw, candidates)).toBe(raw);
  });

  it('候補が無ければ何もしない', () => {
    expect(resolveDefinitionRefs('Adj.: 増分の | [2]', [])).toBe('Adj.: 増分の | [2]');
  });
});
