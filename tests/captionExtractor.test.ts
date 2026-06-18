// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { pickCaptionText } from '../src/content/captionExtractor';

const SEL = ['.primary', '.fallback'];

const clearBody = (): void => {
  document.body.replaceChildren();
};

const addSpan = (className: string, text: string): void => {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  document.body.appendChild(span);
};

describe('pickCaptionText', () => {
  beforeEach(clearBody);

  it('returns null when no caption element is present', () => {
    expect(pickCaptionText(document, SEL)).toBeNull();
  });

  it('returns trimmed text from the primary selector', () => {
    addSpan('primary', '  Hello there  ');
    expect(pickCaptionText(document, SEL)).toBe('Hello there');
  });

  it('joins multiple caption lines with a single space', () => {
    addSpan('primary', 'Line one');
    addSpan('primary', 'Line two');
    expect(pickCaptionText(document, SEL)).toBe('Line one Line two');
  });

  it('falls back to the next selector when the primary is absent', () => {
    addSpan('fallback', 'From fallback');
    expect(pickCaptionText(document, SEL)).toBe('From fallback');
  });

  it('returns null when the caption element is empty or whitespace', () => {
    addSpan('primary', '   ');
    expect(pickCaptionText(document, SEL)).toBeNull();
  });
});
