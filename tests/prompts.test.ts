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
