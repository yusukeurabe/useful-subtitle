import { describe, it, expect } from 'vitest';
import { buildTranslationPrompt, buildExplanationPrompt } from '../src/shared/prompts';

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
});
