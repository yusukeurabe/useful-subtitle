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

  it('asks for the structured 訳/説明 format', () => {
    const { system } = buildExplanationPrompt('word', 'a sentence', 'ja');
    expect(system).toContain('訳:');
    expect(system).toContain('説明:');
  });

  it('asks for up to 3 general translations separated by ・', () => {
    const { system } = buildExplanationPrompt('word', 'a sentence', 'ja');
    expect(system).toMatch(/3つ/);
    expect(system).toContain('・');
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
