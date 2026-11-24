import type {
  AiProvider,
  CaptionNeighbors,
  ExplainSelectionRequest,
  ExplainSentenceRequest,
  ExplanationLanguage,
  TranslateLineRequest,
} from '../shared/types';

/** 字幕に出にくい区切り文字（Unit Separator）。 */
const SEP = '␟';
const STORAGE_PREFIX = 'cache:';

/**
 * explainSelection プロンプトのバージョン。プロンプト形式を変更したら必ず上げる。
 * 過去キャッシュは別キーに移るので破棄され、新プロンプトで再生成される。
 * （古いエントリは storage に残るが orphan として無視される。）
 */
const EXPLANATION_PROMPT_VERSION = 'v6';

/**
 * explainSentence プロンプトのバージョン。v1 は前後の字幕を渡す前の形式（バージョン欄なし）。
 * 形式を変えたら上げる。
 */
const SENTENCE_PROMPT_VERSION = 'v2';

/** 前後の字幕の区切り（字幕に出にくい Record Separator）。 */
const LIST_SEP = '␞';

/** 前後の字幕をキーの2欄にする。同じ字幕でも前後が違えば解説が変わりうるので別エントリ。 */
function neighborParts(n: CaptionNeighbors): string[] {
  return [(n.before ?? []).join(LIST_SEP), (n.after ?? []).join(LIST_SEP)];
}

/**
 * リクエスト内容＋モデル＋（解説の）言語から決定的なキャッシュキーを作る。
 * モデルや言語が変わると別エントリになり、古い結果が混ざらない。
 */
export function makeCacheKey(
  req: TranslateLineRequest | ExplainSelectionRequest | ExplainSentenceRequest,
  model: string,
  language: ExplanationLanguage,
  provider: AiProvider = 'anthropic',
): string {
  if (req.type === 'translateLine') {
    return ['t', provider, model, language, req.text].join(SEP);
  }
  if (req.type === 'explainSentence') {
    return ['s', SENTENCE_PROMPT_VERSION, provider, model, language, req.text, ...neighborParts(req)].join(SEP);
  }
  return ['e', EXPLANATION_PROMPT_VERSION, provider, model, language, req.selection, req.context, ...neighborParts(req)].join(SEP);
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
