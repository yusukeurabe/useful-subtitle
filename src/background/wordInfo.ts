import {
  extractWordInfo,
  extractCambridgeWordInfo,
  CAMBRIDGE_BASE,
  type WordInfo,
} from '../shared/dictionary';

const DICT_API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const EMPTY: WordInfo = { ipa: null, audioUrl: null };
const CACHE_LIMIT = 300;

type FetchFn = (url: string) => Promise<Response>;

/**
 * 単語の IPA＋音源 URL を取得する関数を作る（fetch はテストで差し替え可能）。
 *
 * Cambridge を一次、dictionaryapi.dev を予備とする。Cambridge で IPA は取れたが音源が
 * 無いときは、予備 API の音源で補う（以前は補わず、🔊 が TTS になっていた）。
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
    if (cam.ipa) return { ipa: cam.ipa, audioUrl: dict.audioUrl };
    return dict;
  }

  return async (word: string): Promise<WordInfo> => {
    const hit = cache.get(word);
    if (hit) return hit;
    const info = await lookup(word);
    // 何も取れなかった結果は一時的な通信失敗の可能性があるので覚えない。
    if (info.ipa || info.audioUrl) {
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
      cache.set(word, info);
    }
    return info;
  };
}
