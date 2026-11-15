import { describe, it, expect, vi } from 'vitest';
import { createWordInfoFetcher } from '../src/background/wordInfo';

const CAMBRIDGE_WITH_AUDIO = `
<span class="us dpron-i "><span class="region dreg">us</span>
<span class="daud"><audio><source type="audio/mpeg" src="/media/english/us_pron/r/run.mp3"/></audio></span>
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
});
