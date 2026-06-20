// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  normalizeWord,
  isSingleWord,
  cambridgeUrl,
  extractWordInfo,
  extractCambridgeWordInfo,
} from '../src/shared/dictionary';

describe('normalizeWord', () => {
  it('trims and lowercases', () => {
    expect(normalizeWord('  Hello  ')).toBe('hello');
  });
  it('strips surrounding punctuation but keeps inner apostrophe', () => {
    expect(normalizeWord('"don\'t,"')).toBe("don't");
  });
  it('keeps inner hyphen', () => {
    expect(normalizeWord('well-known.')).toBe('well-known');
  });
  it('collapses inner whitespace for phrases', () => {
    expect(normalizeWord('break   a  leg')).toBe('break a leg');
  });
  it('returns empty string for punctuation only', () => {
    expect(normalizeWord('—')).toBe('');
  });
});

describe('isSingleWord', () => {
  it('true for a single word', () => {
    expect(isSingleWord('Resilient')).toBe(true);
  });
  it('true for hyphenated / contraction', () => {
    expect(isSingleWord("don't")).toBe(true);
    expect(isSingleWord('well-known')).toBe(true);
  });
  it('false for a phrase', () => {
    expect(isSingleWord('break a leg')).toBe(false);
  });
  it('false for empty / punctuation', () => {
    expect(isSingleWord('   ')).toBe(false);
    expect(isSingleWord('!!')).toBe(false);
  });
});

describe('cambridgeUrl (english monolingual)', () => {
  it('links directly to the entry for a single word', () => {
    expect(cambridgeUrl('Resilient')).toBe(
      'https://dictionary.cambridge.org/dictionary/english/resilient',
    );
  });
  it('uses the search endpoint for a phrase', () => {
    expect(cambridgeUrl('break a leg')).toBe(
      'https://dictionary.cambridge.org/search/direct/?datasetsearch=english&q=break%20a%20leg',
    );
  });
  it('encodes the query', () => {
    expect(cambridgeUrl("rock 'n' roll")).toContain('q=rock%20');
  });
});

describe('extractWordInfo', () => {
  it('prefers US audio and its IPA', () => {
    const json = [
      {
        phonetic: '/həˈloʊ/',
        phonetics: [
          { text: '/həˈləʊ/', audio: 'https://x/hello-uk.mp3' },
          { text: '/həˈloʊ/', audio: 'https://x/hello-us.mp3' },
        ],
      },
    ];
    expect(extractWordInfo(json)).toEqual({
      ipa: '/həˈloʊ/',
      audioUrl: 'https://x/hello-us.mp3',
    });
  });
  it('falls back to UK audio when no US', () => {
    const json = [{ phonetics: [{ text: '/uk/', audio: 'https://x/w-uk.mp3' }] }];
    expect(extractWordInfo(json)).toEqual({ ipa: '/uk/', audioUrl: 'https://x/w-uk.mp3' });
  });
  it('skips empty audio and uses first non-empty', () => {
    const json = [
      { phonetics: [{ text: '/a/', audio: '' }, { text: '/b/', audio: 'https://x/b.mp3' }] },
    ];
    expect(extractWordInfo(json)).toEqual({ ipa: '/b/', audioUrl: 'https://x/b.mp3' });
  });
  it('uses top-level phonetic when chosen audio entry has no text', () => {
    const json = [{ phonetic: '/top/', phonetics: [{ text: '', audio: 'https://x/x-us.mp3' }] }];
    expect(extractWordInfo(json)).toEqual({ ipa: '/top/', audioUrl: 'https://x/x-us.mp3' });
  });
  it('returns ipa with null audio when only text exists', () => {
    const json = [{ phonetics: [{ text: '/only/' }] }];
    expect(extractWordInfo(json)).toEqual({ ipa: '/only/', audioUrl: null });
  });
  it('returns nulls for empty / invalid json', () => {
    expect(extractWordInfo([])).toEqual({ ipa: null, audioUrl: null });
    expect(extractWordInfo(null)).toEqual({ ipa: null, audioUrl: null });
    expect(extractWordInfo({})).toEqual({ ipa: null, audioUrl: null });
    expect(extractWordInfo([{ title: 'No Definitions Found' }])).toEqual({
      ipa: null,
      audioUrl: null,
    });
  });
});

describe('extractCambridgeWordInfo', () => {
  it('extracts IPA text and absolutized US mp3 URL from a Cambridge US section', () => {
    const html = `
      <html><body>
        <span class="us dpron-i ">
          <span class="region dreg">us</span>
          <span class="daud">
            <audio>
              <source type="audio/mpeg" src="/media/english/us_pron/r/res/resil/resilient.mp3">
              <source type="audio/ogg" src="/media/english/us_pron_ogg/r/res/resil/resilient.ogg">
            </audio>
          </span>
          <span class="pron dpron">/<span class="ipa dipa lpr-2 lpl-1">rɪˈzɪl.i.ənt</span>/</span>
        </span>
      </body></html>`;
    expect(extractCambridgeWordInfo(html)).toEqual({
      ipa: 'rɪˈzɪl.i.ənt',
      audioUrl: 'https://dictionary.cambridge.org/media/english/us_pron/r/res/resil/resilient.mp3',
    });
  });

  it('returns nulls for empty html', () => {
    expect(extractCambridgeWordInfo('')).toEqual({ ipa: null, audioUrl: null });
  });

  it('returns nulls when there is no US section', () => {
    const html = `
      <html><body>
        <span class="uk dpron-i">
          <span class="ipa dipa">rɪˈzɪl.i.ənt</span>
        </span>
      </body></html>`;
    expect(extractCambridgeWordInfo(html)).toEqual({ ipa: null, audioUrl: null });
  });

  it('returns ipa with null audio when US section has IPA but no mp3 source', () => {
    const html = `
      <html><body>
        <span class="us dpron-i">
          <span class="ipa dipa">rɪˈzɪl.i.ənt</span>
        </span>
      </body></html>`;
    expect(extractCambridgeWordInfo(html)).toEqual({
      ipa: 'rɪˈzɪl.i.ənt',
      audioUrl: null,
    });
  });

  it('rejects (returns nulls) when US section has audio but no IPA text', () => {
    const html = `
      <html><body>
        <span class="us dpron-i">
          <source type="audio/mpeg" src="/media/english/us_pron/x/x.mp3">
        </span>
      </body></html>`;
    expect(extractCambridgeWordInfo(html)).toEqual({ ipa: null, audioUrl: null });
  });

  it('keeps already-absolute audio URLs as-is', () => {
    const html = `
      <html><body>
        <span class="us dpron-i">
          <source type="audio/mpeg" src="https://cdn.example.com/r.mp3">
          <span class="ipa dipa">rɪˈzɪl.i.ənt</span>
        </span>
      </body></html>`;
    expect(extractCambridgeWordInfo(html)).toEqual({
      ipa: 'rɪˈzɪl.i.ənt',
      audioUrl: 'https://cdn.example.com/r.mp3',
    });
  });
});
