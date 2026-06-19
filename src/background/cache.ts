import type {
  ExplainSelectionRequest,
  ExplainSentenceRequest,
  ExplanationLanguage,
  TranslateLineRequest,
} from '../shared/types';

/** 字幕に出にくい区切り文字（Unit Separator）。 */
const SEP = '␟';
const STORAGE_PREFIX = 'cache:';

/**
 * リクエスト内容＋モデル＋（解説の）言語から決定的なキャッシュキーを作る。
 * モデルや言語が変わると別エントリになり、古い結果が混ざらない。
 */
export function makeCacheKey(
  req: TranslateLineRequest | ExplainSelectionRequest | ExplainSentenceRequest,
  model: string,
  language: ExplanationLanguage,
): string {
  if (req.type === 'translateLine') {
    return ['t', model, req.text].join(SEP);
  }
  if (req.type === 'explainSentence') {
    return ['s', model, language, req.text].join(SEP);
  }
  return ['e', model, language, req.selection, req.context].join(SEP);
}

/** Service Worker の生存中だけ有効な高速メモリ層。 */
const memory = new Map<string, string>();

/** メモリ → chrome.storage の順で参照。見つからなければ undefined。 */
export async function getCached(key: string): Promise<string | undefined> {
  const cached = memory.get(key);
  if (cached !== undefined) return cached;

  const storeKey = STORAGE_PREFIX + key;
  const got = await chrome.storage.local.get(storeKey);
  const value = got[storeKey];
  if (typeof value === 'string') {
    memory.set(key, value);
    return value;
  }
  return undefined;
}

/** メモリと chrome.storage の両方に保存する。 */
export async function setCached(key: string, value: string): Promise<void> {
  memory.set(key, value);
  await chrome.storage.local.set({ [STORAGE_PREFIX + key]: value });
}
