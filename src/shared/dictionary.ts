/** 辞書から得る単語情報（発音記号と音源URL）。 */
export interface WordInfo {
  ipa: string | null;
  audioUrl: string | null;
}

// 許可する語の構成文字（英字・数字・内部アポストロフィ・ハイフン）。
const KEEP = "A-Za-z0-9'’\\-";

/**
 * 選択文字列を辞書照合・URL生成用に正規化する。
 * 前後の空白/記号を除去、連続空白を1つに、内部の `'`/`-` は保持、小文字化。
 */
export function normalizeWord(selection: string): string {
  return selection
    .trim()
    .replace(/\s+/g, ' ')
    .replace(new RegExp(`^[^${KEEP}]+`), '')
    .replace(new RegExp(`[^${KEEP}]+$`), '')
    .toLowerCase();
}

/** 正規化後に内部空白が無く、空でなければ「単語」とみなす。 */
export function isSingleWord(selection: string): boolean {
  const w = normalizeWord(selection);
  return w.length > 0 && !/\s/.test(w);
}

const CAMBRIDGE = 'https://dictionary.cambridge.org';

/** Cambridge（英英）の URL。単語は直接ページ、フレーズは検索エンドポイント。 */
export function cambridgeUrl(selection: string): string {
  const norm = normalizeWord(selection);
  if (isSingleWord(selection)) {
    return `${CAMBRIDGE}/dictionary/english/${encodeURIComponent(norm)}`;
  }
  return `${CAMBRIDGE}/search/direct/?datasetsearch=english&q=${encodeURIComponent(norm)}`;
}

interface RawPhonetic {
  text?: unknown;
  audio?: unknown;
}
interface RawEntry {
  phonetic?: unknown;
  phonetics?: unknown;
}

/**
 * 無料辞書API（api.dictionaryapi.dev）の応答から IPA と音源URLを取り出す。
 * 音源は US → UK → 最初の非空 の優先。IPA は選んだ音源の text → 最初の text → 代表 phonetic。
 * 不正/空入力でも例外を投げず {null,null}。
 */
export function extractWordInfo(json: unknown): WordInfo {
  const entries: RawEntry[] = Array.isArray(json) ? (json as RawEntry[]) : [];
  const phonetics: RawPhonetic[] = entries.flatMap((e) =>
    Array.isArray(e?.phonetics) ? (e.phonetics as RawPhonetic[]) : [],
  );

  const audios = phonetics.filter(
    (p): p is RawPhonetic & { audio: string } =>
      typeof p?.audio === 'string' && p.audio.length > 0,
  );
  const chosen =
    audios.find((p) => /-us\.\w+(\?.*)?$/i.test(p.audio)) ??
    audios.find((p) => /-uk\.\w+(\?.*)?$/i.test(p.audio)) ??
    audios[0] ??
    null;
  const audioUrl = chosen ? chosen.audio : null;

  const textOf = (p: RawPhonetic | null): string | null =>
    p && typeof p.text === 'string' && p.text.length > 0 ? p.text : null;
  const firstText = phonetics.map(textOf).find((t): t is string => t !== null) ?? null;
  const topPhonetic =
    entries
      .map((e) => (typeof e?.phonetic === 'string' && e.phonetic.length > 0 ? e.phonetic : null))
      .find((t): t is string => t !== null) ?? null;
  const ipa = textOf(chosen) ?? firstText ?? topPhonetic ?? null;

  return { ipa, audioUrl };
}
