import { describe, it, expect } from 'vitest';
import { tokenizeLine } from '../src/shared/tokenize';

const text = (line: string) => tokenizeLine(line).map((t) => t.text).join('');
const words = (line: string) =>
  tokenizeLine(line).filter((t) => t.isWord).map((t) => t.text);

describe('tokenizeLine', () => {
  it('returns an empty array for an empty string', () => {
    expect(tokenizeLine('')).toEqual([]);
  });

  it('preserves the original text when tokens are concatenated', () => {
    for (const line of ['Hello world', '  Wait... really?', 'A B  C', "It's me, Mario!"]) {
      expect(text(line)).toBe(line);
    }
  });

  it('splits words from the spaces between them', () => {
    expect(tokenizeLine('Hello world')).toEqual([
      { text: 'Hello', isWord: true },
      { text: ' ', isWord: false },
      { text: 'world', isWord: true },
    ]);
  });

  it('keeps an internal apostrophe inside a single word', () => {
    expect(words("I don't know")).toEqual(['I', "don't", 'know']);
  });

  it('keeps a hyphenated compound as a single word', () => {
    expect(words('a well-known fact')).toEqual(['a', 'well-known', 'fact']);
  });

  it('treats punctuation as non-word tokens', () => {
    expect(tokenizeLine('Hi, there!')).toEqual([
      { text: 'Hi', isWord: true },
      { text: ', ', isWord: false },
      { text: 'there', isWord: true },
      { text: '!', isWord: false },
    ]);
  });
});
