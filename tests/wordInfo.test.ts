import { describe, it, expect, vi } from 'vitest';
import { createWordInfoFetcher } from '../src/background/wordInfo';

const CAMBRIDGE_US_AUDIO = '<span class="daud"><audio><source type="audio/mpeg" src="/media/english/us_pron/r/run.mp3"/></audio></span>';
const INTRADAY_AUDIO_PATH = '/media/english/us_pron/u/usb/usbp0/usbp0575.mp3';
const INTRADAY_CAMBRIDGE = `<span class="us dpron-i"><audio><source type="audio/mpeg" src="${INTRADAY_AUDIO_PATH}"></audio></span>`;
const CAMBRIDGE_WITH_AUDIO = `
<span class="us dpron-i "><span class="region dreg">us</span>
${CAMBRIDGE_US_AUDIO}
<span class="pron dpron">/<span class="ipa dipa lpr-2 lpl-1">rʌn</span>/</span></span>`;
const CAMBRIDGE_IPA_ONLY = `
<span class="us dpron-i "><span class="region dreg">us</span>
<span class="pron dpron">/<span class="ipa dipa lpr-2 lpl-1">rʌn</span>/</span></span>`;
const DICT_API_JSON = [{ phonetics: [{ text: '/rʌn/', audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/run-us.mp3' }] }];

function response(body: string | unknown, ok = true): Response {
  return {
    ok,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  } as Response;
}

function fetcher(cambridge: Response, dictApi: Response) {
  return vi.fn(async (url: string | URL | Request) =>
    String(url).startsWith('https://dictionary.cambridge.org') ? cambridge : dictApi,
  );
}

describe('createWordInfoFetcher', () => {
  it('Cambridge に IPA と音源があればそれを使い、予備APIは呼ばない', async () => {
    const f = fetcher(response(CAMBRIDGE_WITH_AUDIO), response(DICT_API_JSON));
    const info = await createWordInfoFetcher(f)('run');
    expect(info).toEqual({ ipa: 'rʌn', audioUrl: 'https://dictionary.cambridge.org/media/english/us_pron/r/run.mp3' });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('Cambridge が IPA だけのときは、予備APIの音源で補う', async () => {
    const f = fetcher(response(CAMBRIDGE_IPA_ONLY), response(DICT_API_JSON));
    const info = await createWordInfoFetcher(f)('run');
    expect(info).toEqual({ ipa: 'rʌn', audioUrl: 'https://api.dictionaryapi.dev/media/pronunciations/en/run-us.mp3' });
  });

  it('Cambridge 未収録なら予備APIの結果を使う', async () => {
    const f = fetcher(response('', false), response(DICT_API_JSON));
    const info = await createWordInfoFetcher(f)('run');
    expect(info).toEqual({ ipa: '/rʌn/', audioUrl: 'https://api.dictionaryapi.dev/media/pronunciations/en/run-us.mp3' });
  });

  it('Cambridge に音源だけあれば、予備APIに発音記号がなくても音源を使う', async () => {
    const audioOnly = `<span class="us dpron-i">${CAMBRIDGE_US_AUDIO}</span>`;
    const f = fetcher(response(audioOnly), response([{ word: 'run', phonetics: [] }]));
    expect(await createWordInfoFetcher(f)('run')).toEqual({
      ipa: null,
      audioUrl: 'https://dictionary.cambridge.org/media/english/us_pron/r/run.mp3',
    });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it.each(['intraday', 'intra-day'])('%s の発音記号を補い、Cambridge の音源を使う', async (word) => {
    const f = fetcher(response(INTRADAY_CAMBRIDGE), response([{ word, phonetics: [] }]));
    expect(await createWordInfoFetcher(f)(word)).toEqual({
      ipa: 'ˈɪntrəˌdeɪ',
      audioUrl: `https://dictionary.cambridge.org${INTRADAY_AUDIO_PATH}`,
    });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('通信失敗時も intraday の発音記号を補い、次の検索で音源を再取得する', async () => {
    const f = fetcher(response(INTRADAY_CAMBRIDGE), response([{ word: 'intraday', phonetics: [] }]))
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'));
    const get = createWordInfoFetcher(f);
    expect(await get('intraday')).toEqual({ ipa: 'ˈɪntrəˌdeɪ', audioUrl: null });
    expect((await get('intraday')).audioUrl).toBe(`https://dictionary.cambridge.org${INTRADAY_AUDIO_PATH}`);
  });

  it('取得できた結果は覚えておき、同じ単語で再取得しない', async () => {
    const f = fetcher(response(CAMBRIDGE_WITH_AUDIO), response(DICT_API_JSON));
    const get = createWordInfoFetcher(f);
    await get('run');
    await get('run');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('何も取れなかった結果は覚えない（一時的な失敗で以後ずっと音源なしにしない）', async () => {
    const f = vi.fn(async () => { throw new Error('offline'); });
    const get = createWordInfoFetcher(f);
    expect(await get('run')).toEqual({ ipa: null, audioUrl: null });
    await get('run');
    expect(f.mock.calls.length).toBeGreaterThan(2);
  });

  it('Cambridge の見出し語の品詞を返す', async () => {
    const html = `<div class="pos-header dpos-h"><span class="hw dhw">run</span><span class="pos dpos">verb</span></div>${CAMBRIDGE_WITH_AUDIO}`;
    const f = fetcher(response(html), response(DICT_API_JSON));
    expect((await createWordInfoFetcher(f)('run')).pos).toEqual(['verb']);
  });

  it('Cambridge に品詞が無ければ予備APIの品詞を使う', async () => {
    const f = fetcher(response('', false), response([{ ...DICT_API_JSON[0], meanings: [{ partOfSpeech: 'verb' }] }]));
    expect((await createWordInfoFetcher(f)('run')).pos).toEqual(['verb']);
  });

  it('品詞だけ取れた結果も覚えておく', async () => {
    const html = '<div class="pos-header dpos-h"><span class="hw dhw">run</span><span class="pos dpos">verb</span></div>';
    const f = fetcher(response(html), response([]));
    const get = createWordInfoFetcher(f);
    await get('run');
    const calls = f.mock.calls.length;
    expect((await get('run')).pos).toEqual(['verb']);
    expect(f).toHaveBeenCalledTimes(calls);
  });

  it('同じ単語の同時取得は1回の通信にまとめる（発音と解説が同時に辞書を引く）', async () => {
    const f = fetcher(response(CAMBRIDGE_WITH_AUDIO), response(DICT_API_JSON));
    const get = createWordInfoFetcher(f);
    const [a, b] = await Promise.all([get('run'), get('run')]);
    expect(a).toEqual(b);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('Cambridge の見出し語の定義を返す（予備APIで補うときも残す）', async () => {
    const html =
      '<div class="pos-header dpos-h"><span class="hw dhw">run</span><span class="pos dpos">verb</span></div>' +
      `<div class="pr dsense "><div class="def ddef_d db">to move fast: </div></div>${CAMBRIDGE_IPA_ONLY}`;
    const f = fetcher(response(html), response(DICT_API_JSON));
    const info = await createWordInfoFetcher(f)('run');
    expect(info.definitions).toEqual([{ pos: 'verb', defs: ['to move fast'] }]);
    expect(info.audioUrl).toBe('https://api.dictionaryapi.dev/media/pronunciations/en/run-us.mp3');
  });

  it('品詞と定義が取れた結果は覚えておく', async () => {
    const html =
      '<div class="pos-header dpos-h"><span class="hw dhw">run</span><span class="pos dpos">verb</span></div>' +
      '<div class="pr dsense "><div class="def ddef_d db">to move fast: </div></div>';
    const f = fetcher(response(html), response([]));
    const get = createWordInfoFetcher(f);
    await get('run');
    const calls = f.mock.calls.length;
    expect((await get('run')).definitions).toEqual([{ pos: 'verb', defs: ['to move fast'] }]);
    expect(f).toHaveBeenCalledTimes(calls);
  });
});
