import { describe, it, expect } from 'vitest';
import {
  normalizeWord,
  isSingleWord,
  cambridgeUrl,
  extractWordInfo,
  extractCambridgeWordInfo,
  extractCambridgePartsOfSpeech,
  extractCambridgeDefinitions,
  formatIpaForDisplay,
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
  it('turns protocol-relative audio URLs into https (otherwise rejected by playAudio)', () => {
    const json = [{ phonetics: [{ text: '/w/', audio: '//ssl.gstatic.com/dictionary/static/sounds/w.mp3' }] }];
    expect(extractWordInfo(json).audioUrl).toBe('https://ssl.gstatic.com/dictionary/static/sounds/w.mp3');
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

  it('keeps intra-day audio without taking the IPA from the Word of the Day', () => {
    const html = `
      <html><body>
        <span class="us dpron-i">
          <span class="region dreg">us</span>
          <span class="daud"><audio>
            <source type="audio/mpeg" src="/media/english/us_pron/u/usb/usbp0/usbp0575.mp3">
          </audio></span>
        </span>
        <div><p>Word of the Day</p><a href="/dictionary/english/spoiler">spoiler</a>
          <span class="ipa dipa">/ˈspɔɪ.lə<span>r</span>/</span>
        </div>
      </body></html>`;
    expect(extractCambridgeWordInfo(html)).toEqual({
      ipa: null,
      audioUrl: 'https://dictionary.cambridge.org/media/english/us_pron/u/usb/usbp0/usbp0575.mp3',
    });
  });

  it('does not take a later audio source when the US span only contains IPA', () => {
    const html = `
      <span class="us dpron-i"><span class="ipa dipa">rʌn</span></span>
      <audio><source type="audio/mpeg" src="/media/english/us_pron/s/spoiler.mp3"></audio>`;
    expect(extractCambridgeWordInfo(html)).toEqual({ ipa: 'rʌn', audioUrl: null });
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

  // 実 HTML 構造の回帰テスト：Cambridge の "interrogation" ページ抜粋。
  // -tion 系では .ipa.dipa の中に <span class="sp dsp">ə</span> が入れ子で挟まり、
  // その直後に "n" が続く。非貪欲な単発正規表現だと最初の </span> で止まり末尾 "n" を
  // 取りこぼす（実機で /ɪnˌter.əˈɡeɪ.ʃə/ になる）回帰。
  it('extracts the full IPA when the dipa span has a nested <span> (e.g. -tion words)', () => {
    const html = `
      <span class="us dpron-i ">
        <span class="region dreg">us</span>
        <span class="daud">
          <audio>
            <source type="audio/mpeg" src="/media/english/us_pron/i/int/inter/interrogation.mp3"/>
          </audio>
        </span>
        <span class="pron dpron">/<span class="ipa dipa lpr-2 lpl-1">ɪnˌter.əˈɡeɪ.ʃ<span class="sp dsp">ə</span>n</span>/</span>
      </span>`;
    expect(extractCambridgeWordInfo(html)).toEqual({
      ipa: 'ɪnˌter.əˈɡeɪ.ʃən',
      audioUrl:
        'https://dictionary.cambridge.org/media/english/us_pron/i/int/inter/interrogation.mp3',
    });
  });

  // 実 HTML 構造の回帰テスト：Cambridge の "around" ページ抜粋。
  // UK ブロックが先に並ぶページでも US が選ばれること、UK の mp3 を誤って拾わないこと、
  // 入れ子の <span class="pron dpron"> 越しに `.ipa.dipa` の中身だけ拾えることを確認する。
  it('extracts the US IPA from a real Cambridge "around"-style slice (UK before US)', () => {
    const html = `
      <span class="uk dpron-i ">
        <span class="region dreg">uk</span>
        <span class="daud">
          <audio>
            <source type="audio/mpeg" src="/media/english/uk_pron/u/uka/ukarm/ukarmho014.mp3"/>
          </audio>
        </span>
        <span class="pron dpron">/<span class="ipa dipa lpr-2 lpl-1">əˈraʊnd</span>/</span>
      </span>
      <span class="us dpron-i ">
        <span class="region dreg">us</span>
        <span class="daud">
          <audio>
            <source type="audio/mpeg" src="/media/english/us_pron/a/aro/aroun/around.mp3"/>
          </audio>
        </span>
        <span class="pron dpron">/<span class="ipa dipa lpr-2 lpl-1">əˈraʊnd</span>/</span>
      </span>
      <div class="lmt--5"></div>`;
    expect(extractCambridgeWordInfo(html)).toEqual({
      ipa: 'əˈraʊnd',
      audioUrl:
        'https://dictionary.cambridge.org/media/english/us_pron/a/aro/aroun/around.mp3',
    });
  });
});

describe('formatIpaForDisplay', () => {
  it('wraps a bare IPA in slashes', () => {
    expect(formatIpaForDisplay('əˈraʊnd')).toBe('/əˈraʊnd/');
  });
  it('keeps the existing wrapping when the IPA already has slashes', () => {
    expect(formatIpaForDisplay('/həˈloʊ/')).toBe('/həˈloʊ/');
  });
  it('trims surrounding whitespace before wrapping', () => {
    expect(formatIpaForDisplay('  əˈraʊnd  ')).toBe('/əˈraʊnd/');
  });
  it('strips multiple leading/trailing slashes and re-wraps once', () => {
    expect(formatIpaForDisplay('//əˈraʊnd//')).toBe('/əˈraʊnd/');
  });
  it('returns empty for empty / slash-only input (caller decides to hide)', () => {
    expect(formatIpaForDisplay('')).toBe('');
    expect(formatIpaForDisplay('   ')).toBe('');
    expect(formatIpaForDisplay('//')).toBe('');
  });
});

// Cambridge 実ページ（incremental）の構造を縮めたもの。見出し語の品詞は hw の後、
// 派生語（incrementally）の品詞は hw の無い pos-header の中にある。
const CAMBRIDGE_INCREMENTAL = `
<div class="pos-header dpos-h"><div class="di-title"><span class="headword hdb tw-bw dhw dpos-h_hw "><span class="hw dhw">incremental</span></span></div><div class="posgram dpos-g hdib lmr-5"><span class="pos dpos" title="A word that describes a noun or pronoun.">adjective</span></div></div>
<div class="pos-header dpos-h"><div class="di-title"><span class="headword hdb tw-bw dhw dpos-h_hw "><span class="hw dhw">incremental</span></span></div><div class="posgram dpos-g hdib lmr-5"><span class="pos dpos" title="A word that describes a noun or pronoun.">adjective</span></div></div>
<span class="runon-head"><span class="w dw">incrementally</span></span><div class="pos-header dpos-h"><span class="pos dpos" title="A word that describes or gives more information about a verb.">adverb</span></div>`;
const CAMBRIDGE_FAST = `
<div class="pos-header dpos-h"><span class="hw dhw">fast</span><div class="posgram"><span class="pos dpos">adjective</span></div></div>
<div class="pos-header dpos-h"><span class="hw dhw">fast</span><div class="posgram"><span class="pos dpos">adverb</span>, <span class="pos dpos">adjective</span></div></div>
<div class="pos-header dpos-h"><span class="hw dhw">fast</span><div class="posgram"><span class="pos dpos">verb</span></div></div>`;

describe('extractCambridgePartsOfSpeech', () => {
  it('見出し語の品詞だけを重複なく返し、派生語（runon）の品詞は含めない', () => {
    expect(extractCambridgePartsOfSpeech(CAMBRIDGE_INCREMENTAL)).toEqual(['adjective']);
  });

  it('複数の品詞を出てきた順に返す（1つの見出しに2つの品詞があっても拾う）', () => {
    expect(extractCambridgePartsOfSpeech(CAMBRIDGE_FAST)).toEqual(['adjective', 'adverb', 'verb']);
  });

  it('品詞が無い・空の HTML では空配列', () => {
    expect(extractCambridgePartsOfSpeech('')).toEqual([]);
    expect(extractCambridgePartsOfSpeech('<html>no entry</html>')).toEqual([]);
  });

  it('extractCambridgeWordInfo は US 発音が無くても品詞を返す', () => {
    expect(extractCambridgeWordInfo(CAMBRIDGE_INCREMENTAL)).toEqual({
      ipa: null,
      audioUrl: null,
      pos: ['adjective'],
    });
  });
});

describe('extractWordInfo の品詞', () => {
  it('dictionaryapi.dev の meanings[].partOfSpeech を重複なく返す', () => {
    const json = [
      { meanings: [{ partOfSpeech: 'adjective' }, { partOfSpeech: 'noun' }] },
      { meanings: [{ partOfSpeech: 'adjective' }] },
    ];
    expect(extractWordInfo(json).pos).toEqual(['adjective', 'noun']);
  });
});

// Cambridge 実ページ（then・run）の構造を縮めたもの。
// 1つ目の見出しは品詞が2つ（adverb, adjective）。2つ目の見出しには成句（then and there）と、
// 末尾に派生語（runon。hw の無い pos-header）がある。
const CAMBRIDGE_DEFS = `
<div class="pr entry-body__el"><div class="pos-header dpos-h"><div class="di-title"><span class="headword hdb tw-bw dhw dpos-h_hw "><span class="hw dhw">then</span></span></div><div class="posgram dpos-g hdib lmr-5"><span class="pos dpos" title="x">adverb</span>, <span class="pos dpos" title="x">adjective</span></div></div>
<div class="pr dsense dsense-noh"><div class="sense-body dsense_b"><div class="def-block ddef_block "><div class="ddef_h"><div class="def ddef_d db">(at) that <a class="query" href="/x">time</a> (in the past or in the future): </div></div></div></div></div></div>
<div class="pr entry-body__el"><div class="pos-header dpos-h"><span class="hw dhw">then</span><span class="pos dpos">adverb</span></div>
<div class="pr dsense "><h3 class="dsense_h"><span class="hw dsense_hw">then</span> <span class="pos dsense_pos">adverb</span></h3><div class="sense-body dsense_b"><div class="def-block ddef_block "><div class="def ddef_d db">next or <a class="query">after</a> that: </div></div>
<div class="pr phrase-block dphrase-block lmb-25"><div class="phrase-head dphrase_h"><span class="phrase-title dphrase-title"><b>then and there</b></span></div><div class="phrase-body dphrase_b"><div class="def-block ddef_block "><div class="def ddef_d db">immediately: </div></div></div></div></div></div>
<div class="pr dsense "><div class="sense-body dsense_b"><div class="def-block ddef_block "><div class="def ddef_d db">in <a>addition</a>: </div></div></div></div>
<span class="runon-head"><span class="w dw">thenly</span></span><div class="pos-header dpos-h"><span class="pos dpos">adverb</span></div><div class="def ddef_d db">a runon definition: </div>
</div>`;

describe('extractCambridgeDefinitions', () => {
  it('見出し語の定義を品詞ごとに取り出し、成句と派生語の定義は除く', () => {
    expect(extractCambridgeDefinitions(CAMBRIDGE_DEFS)).toEqual([
      { pos: 'adverb, adjective', defs: ['(at) that time (in the past or in the future)'] },
      { pos: 'adverb', defs: ['next or after that', 'in addition'] },
    ]);
  });

  it('タグを外し、文字参照を戻し、括弧内の余分な空白と末尾のコロンを取る', () => {
    const html =
      '<div class="pos-header dpos-h"><span class="hw dhw">gauntlet</span><span class="pos dpos">noun</span></div>' +
      '<div class="pr dsense "><div class="def ddef_d db">a long, thick <a>glove</a> ( <a>hand</a> covering), it&#39;s &amp; worn: </div></div>';
    expect(extractCambridgeDefinitions(html)).toEqual([
      { pos: 'noun', defs: ["a long, thick glove (hand covering), it's & worn"] },
    ]);
  });

  it('同じ品詞の重複は省き、1つの品詞につき8個までにする', () => {
    const defs = Array.from({ length: 10 }, (_, i) => `<div class="def ddef_d db">sense ${i}: </div>`).join('');
    const html =
      '<div class="pos-header dpos-h"><span class="hw dhw">run</span><span class="pos dpos">verb</span></div>' +
      `<div class="pr dsense "><div class="def ddef_d db">sense 0: </div>${defs}</div>`;
    const groups = extractCambridgeDefinitions(html);
    expect(groups).toHaveLength(1);
    expect(groups[0].defs).toEqual(['sense 0', 'sense 1', 'sense 2', 'sense 3', 'sense 4', 'sense 5', 'sense 6', 'sense 7']);
  });

  it('前の見出し語の成句で、語義（dsense）に包まれていない後の見出し語の定義を除かない', () => {
    const html =
      '<div class="pos-header dpos-h"><span class="hw dhw">run</span><span class="pos dpos">noun</span></div>' +
      '<div class="pr dsense "><div class="def ddef_d db">an act of running: </div>' +
      '<div class="pr phrase-block dphrase-block"><div class="def ddef_d db">a phrase definition: </div></div></div>' +
      '<div class="pos-header dpos-h"><span class="hw dhw">run</span><span class="pos dpos">verb</span></div>' +
      '<div class="def ddef_d db">to move your legs fast: </div>';
    expect(extractCambridgeDefinitions(html)).toEqual([
      { pos: 'noun', defs: ['an act of running'] },
      { pos: 'verb', defs: ['to move your legs fast'] },
    ]);
  });

  it('定義が無い・空の HTML では空配列', () => {
    expect(extractCambridgeDefinitions('')).toEqual([]);
    expect(extractCambridgeDefinitions('<html>no entry</html>')).toEqual([]);
  });

  it('extractCambridgeWordInfo は定義も返す', () => {
    expect(extractCambridgeWordInfo(CAMBRIDGE_DEFS)).toEqual({
      ipa: null,
      audioUrl: null,
      pos: ['adverb', 'adjective'],
      definitions: [
        { pos: 'adverb, adjective', defs: ['(at) that time (in the past or in the future)'] },
        { pos: 'adverb', defs: ['next or after that', 'in addition'] },
      ],
    });
  });
});
