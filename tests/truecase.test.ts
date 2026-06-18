import { describe, it, expect } from 'vitest';
import { toTrueCase } from '../src/shared/truecase';

describe('toTrueCase', () => {
  it('returns an empty string unchanged', () => {
    expect(toTrueCase('')).toBe('');
  });

  it('lowercases an all-caps sentence and capitalizes the first letter', () => {
    expect(toTrueCase('HELLO WORLD')).toBe('Hello world');
  });

  it('capitalizes the first letter after . ! ?', () => {
    expect(toTrueCase('HELLO. HOW ARE YOU? GREAT!')).toBe('Hello. How are you? Great!');
  });

  it('always capitalizes the pronoun I and its contractions', () => {
    expect(toTrueCase("I THINK I'M RIGHT AND I'LL WIN")).toBe("I think I'm right and I'll win");
  });

  it('does not capitalize i inside other words', () => {
    expect(toTrueCase('IT IS HIS')).toBe('It is his');
  });

  it('leaves proper nouns lowercased (known limitation)', () => {
    expect(toTrueCase('MY NAME IS JOHN')).toBe('My name is john');
  });

  it('passes through text that already has mixed case', () => {
    expect(toTrueCase('Hello, my name is John.')).toBe('Hello, my name is John.');
  });

  it('handles letterless input', () => {
    expect(toTrueCase('...')).toBe('...');
    expect(toTrueCase('123 - 456')).toBe('123 - 456');
  });
});
