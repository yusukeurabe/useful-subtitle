import { describe, it, expect } from 'vitest';
import {
  buildTranslationPrompt,
  buildExplanationPrompt,
  buildSentenceMeaningPrompt,
} from '../src/shared/prompts';

describe('buildTranslationPrompt', () => {
  it('puts the subtitle line into the user message', () => {
    const { user } = buildTranslationPrompt('How are you doing today?');
    expect(user).toContain('How are you doing today?');
  });

  it('tells the model to output a Japanese translation', () => {
    const { system } = buildTranslationPrompt('Hello');
    expect(system).toMatch(/日本語/);
    expect(system).toMatch(/訳|翻訳/);
  });
});

describe('buildExplanationPrompt の辞書の品詞', () => {
  it('辞書の品詞を渡すと、その品詞だけで書くよう指示する（incremental が名詞にされた不具合）', () => {
    const { system } = buildExplanationPrompt('incremental', '$30 trillion a year incremental.', 'ja', undefined, ['adjective']);
    expect(system).toContain('辞書に載っている品詞: adjective');
    expect(system).toMatch(/この品詞だけ/);
  });

  it('前後の字幕を渡すときも辞書の品詞の指示を残す', () => {
    const { system } = buildExplanationPrompt('incremental', 'a', 'ja', { after: ['b'] }, ['adjective', 'adverb']);
    expect(system).toContain('辞書に載っている品詞: adjective, adverb');
  });

  it('辞書の品詞が無くても、文脈上の使われ方で辞書に無い品詞を作らないよう指示する', () => {
    const { system } = buildExplanationPrompt('incremental', 'a', 'ja');
    expect(system).not.toContain('辞書に載っている品詞:');
    expect(system).toMatch(/文脈で別の品詞のように使われていても/);
  });

  it('フレーズには辞書の品詞を渡さない', () => {
    const { system } = buildExplanationPrompt('break a leg', 'a', 'ja', undefined, ['noun']);
    expect(system).not.toContain('辞書に載っている品詞:');
  });
});

describe('buildExplanationPrompt', () => {
  it('includes both the selected phrase and the surrounding sentence', () => {
    const { user } = buildExplanationPrompt(
      'break a leg',
      'Hey, break a leg out there!',
      'ja',
    );
    expect(user).toContain('break a leg');
    expect(user).toContain('Hey, break a leg out there!');
  });

  it('requests a Japanese explanation for language "ja"', () => {
    const { system } = buildExplanationPrompt('word', 'a sentence', 'ja');
    expect(system).toMatch(/日本語/);
  });

  it('requests an English explanation for language "en"', () => {
    const { system } = buildExplanationPrompt('word', 'a sentence', 'en');
    expect(system).toMatch(/英語|English/i);
  });

  it('lists Cambridge-style part-of-speech codes', () => {
    const { system } = buildExplanationPrompt('word', 'a sentence', 'ja');
    expect(system).toContain('V[I]');
    expect(system).toContain('V[I/T]');
    expect(system).toContain('N[C]');
    expect(system).toContain('N[C/U]');
    expect(system).toContain('Adj.');
    expect(system).toContain('Adv.');
  });

  it('asks for a per-POS line plus the 説明 line', () => {
    const { system } = buildExplanationPrompt('word', 'a sentence', 'ja');
    expect(system).toContain('品詞');
    expect(system).toContain('説明:');
  });

  it('tells phrases to fall back to a single 訳 line', () => {
    const { system } = buildExplanationPrompt('break a leg', 'a sentence', 'ja');
    expect(system).toContain('訳:');
  });

  it('asks for an English definition after | on each POS line and on the phrase 訳 line', () => {
    const word = buildExplanationPrompt('word', 'a sentence', 'ja').system;
    expect(word).toContain('英語の定義');
    expect(word).toMatch(/V\[I\/T\]: 走る・運営する \| .+/);
    const phrase = buildExplanationPrompt('break a leg', 'a sentence', 'ja').system;
    expect(phrase).toContain('英語の定義');
    expect(phrase).toMatch(/訳: 幸運を祈る \| .+/);
  });

  it('asks for up to 3 translations separated by ・', () => {
    const { system } = buildExplanationPrompt('word', 'a sentence', 'ja');
    expect(system).toMatch(/3つ/);
    expect(system).toContain('・');
  });

  // gauntlet など慣用句に強い単語で、LLM が文脈に引きずられて訳:形式を返し
  // pos=null になる事故を防ぐため、単語選択時は訳:形式自体を見せない。
  it('does not expose the phrase 訳 format when the selection is a single word', () => {
    const { system } = buildExplanationPrompt('gauntlet', 'throw down the gauntlet', 'ja');
    expect(system).not.toContain('訳:');
  });

  it('instructs to keep the word format even when the word is part of an idiom', () => {
    const { system } = buildExplanationPrompt('gauntlet', 'throw down the gauntlet', 'ja');
    expect(system).toMatch(/慣用句|句動詞|イディオム/);
  });

  it('does not list POS codes when the selection is a phrase', () => {
    const { system } = buildExplanationPrompt('break a leg', 'a sentence', 'ja');
    expect(system).not.toContain('N[C]');
    expect(system).not.toContain('V[I]');
  });

  it('labels the user message as 単語 / フレーズ to match the system prompt', () => {
    expect(buildExplanationPrompt('gauntlet', 'x', 'ja').user).toContain('単語');
    expect(buildExplanationPrompt('break a leg', 'x', 'ja').user).toContain('フレーズ');
  });
});

describe('buildSentenceMeaningPrompt', () => {
  it('puts the whole sentence into the user message', () => {
    const { user } = buildSentenceMeaningPrompt('I could eat a horse.', 'ja');
    expect(user).toContain('I could eat a horse.');
  });

  it('asks for the structured 訳/説明 format with a full-sentence translation', () => {
    const { system } = buildSentenceMeaningPrompt('x', 'ja');
    expect(system).toContain('訳:');
    expect(system).toContain('説明:');
    expect(system).toMatch(/全文|1文/);
  });

  it('requests a Japanese explanation for "ja" and English for "en"', () => {
    expect(buildSentenceMeaningPrompt('x', 'ja').system).toMatch(/日本語/);
    expect(buildSentenceMeaningPrompt('x', 'en').system).toMatch(/英語|English/i);
  });
});

describe('前後の字幕をまたぐ文・フレーズ', () => {
  const neighbors = { before: ['So, about dinner tonight?'], after: ['a rain check on that.'] };

  it('単語の解説で、前後の字幕を出た順に並べて渡す', () => {
    const { system, user } = buildExplanationPrompt('take', "I'm gonna take", 'ja', neighbors);
    expect(user).toBe(
      '前の字幕: "So, about dinner tonight?"\n' +
        '対象の字幕: "I\'m gonna take"\n' +
        '次の字幕: "a rain check on that."\n' +
        '対象の字幕の中の単語 "take" の意味を教えてください。',
    );
    expect(system).toContain('字幕は文やフレーズの途中で区切られ');
    expect(system).toContain('字幕をまたいで続く');
    // 単語の品詞行の形式は保つ。
    expect(system).toContain('品詞コード');
  });

  it('フレーズの解説では、訳もまたいだフレーズ全体を踏まえた意味にさせる', () => {
    const { system, user } = buildExplanationPrompt('gonna take', "I'm gonna take", 'ja', neighbors);
    expect(user).toContain('対象の字幕の中のフレーズ "gonna take"');
    expect(system).toContain('訳はそのフレーズ全体を踏まえた文脈上の意味');
  });

  it('前後の字幕が無ければ従来どおりのプロンプト', () => {
    expect(buildExplanationPrompt('take', 'I take it', 'ja', {})).toEqual(buildExplanationPrompt('take', 'I take it', 'ja'));
    expect(buildSentenceMeaningPrompt('I take it', 'ja', { before: [], after: [] })).toEqual(
      buildSentenceMeaningPrompt('I take it', 'ja'),
    );
  });

  it('文の意味では、訳は対象の字幕の部分だけにし、つながりは説明で補足させる', () => {
    const { system, user } = buildSentenceMeaningPrompt("I'm gonna take", 'ja', neighbors);
    expect(user).toContain('対象の字幕: "I\'m gonna take"');
    expect(user).toContain('次の字幕: "a rain check on that."');
    expect(system).toContain('対象の字幕の部分だけ');
    expect(system).toContain('前後の字幕の内容は訳に含めない');
    expect(system).toContain('訳:');
    expect(system).toContain('説明:');
  });
});
