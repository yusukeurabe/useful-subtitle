import {
  extractWordInfo,
  extractCambridgeWordInfo,
  CAMBRIDGE_BASE,
  type WordInfo,
} from '../shared/dictionary';

const DICT_API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const EMPTY: WordInfo = { ipa: null, audioUrl: null };
const CACHE_LIMIT = 300;
// 発音記号が既存の取得先にない語の米国 IPA。
// 出典: https://www.collinsdictionary.com/dictionary/english/intraday
const IPA_FALLBACK = new Map([
  ['intraday', 'ˈɪntrəˌdeɪ'],
  ['intra-day', 'ˈɪntrəˌdeɪ'],
]);

type FetchFn = (url: string) => Promise<Response>;

/**
 * 単語の IPA＋音源 URL＋見出し語の品詞を取得する関数を作る（fetch はテストで差し替え可能）。
 *
 * Cambridge を一次、dictionaryapi.dev を予備とし、IPA や音源が欠けていれば予備 API で補う。
 * 取得できた結果はメモリに覚え、同じ単語の再取得（数百KBの HTML）を省く。
 */
export function createWordInfoFetcher(fetchFn: FetchFn): (word: string) => Promise<WordInfo> {
  const cache = new Map<string, WordInfo>();

  async function tryCambridge(word: string): Promise<WordInfo> {
    try {
      const res = await fetchFn(`${CAMBRIDGE_BASE}/dictionary/english/${encodeURIComponent(word)}`);
      if (!res.ok) return EMPTY;
      return extractCambridgeWordInfo(await res.text());
    } catch {
      return EMPTY;
    }
  }

  async function tryDictionaryApi(word: string): Promise<WordInfo> {
    try {
      const res = await fetchFn(`${DICT_API}${encodeURIComponent(word)}`);
      if (!res.ok) return EMPTY;
      const json = (await res.json().catch(() => null)) as unknown;
      return extractWordInfo(json);
    } catch {
      return EMPTY;
    }
  }

  async function lookup(word: string): Promise<WordInfo> {
    const cam = await tryCambridge(word);
    if (cam.ipa && cam.audioUrl) return cam;
    const dict = await tryDictionaryApi(word);
    const pos = cam.pos ?? dict.pos;
    const info = { ipa: cam.ipa ?? dict.ipa, audioUrl: cam.audioUrl ?? dict.audioUrl };
    return pos ? { ...info, pos } : info;
  }

  /** 取得中の単語。発音（lookupWord）と解説の品詞が同じ単語を同時に引くので、通信を1回にまとめる。 */
  const inFlight = new Map<string, Promise<WordInfo>>();

  async function load(word: string): Promise<WordInfo> {
    const hit = cache.get(word);
    if (hit) return hit;
    const pending = inFlight.get(word);
    if (pending) return pending;
    const request = lookup(word).then((info) => {
      // 何も取れなかった結果は一時的な通信失敗の可能性があるので覚えない。
      if (info.ipa || info.audioUrl || info.pos) {
        if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
        cache.set(word, info);
      }
      return info;
    }).finally(() => inFlight.delete(word));
    inFlight.set(word, request);
    return request;
  }

  return async (word: string): Promise<WordInfo> => {
    const info = await load(word);
    const result = { ipa: info.ipa ?? IPA_FALLBACK.get(word) ?? null, audioUrl: info.audioUrl };
    return info.pos ? { ...result, pos: info.pos } : result;
  };
}
