/** 辞書から得る単語情報（発音記号と音源URL、見出し語の品詞）。 */
export interface WordInfo {
  ipa: string | null;
  audioUrl: string | null;
  /** 辞書に載っている見出し語の品詞（"adjective" など英語・出現順・重複なし）。取れなければ省略。 */
  pos?: string[];
}

/** 品詞が1つ以上あるときだけ pos を付ける（空配列は持たない）。 */
function withPos(info: { ipa: string | null; audioUrl: string | null }, pos: string[]): WordInfo {
  return pos.length > 0 ? { ...info, pos } : info;
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

export const CAMBRIDGE_BASE = 'https://dictionary.cambridge.org';

/** Cambridge（英英）の URL。単語は直接ページ、フレーズは検索エンドポイント。 */
export function cambridgeUrl(selection: string): string {
  const norm = normalizeWord(selection);
  if (isSingleWord(selection)) {
    return `${CAMBRIDGE_BASE}/dictionary/english/${encodeURIComponent(norm)}`;
  }
  return `${CAMBRIDGE_BASE}/search/direct/?datasetsearch=english&q=${encodeURIComponent(norm)}`;
}

interface RawPhonetic {
  text?: unknown;
  audio?: unknown;
}
interface RawEntry {
  phonetic?: unknown;
  phonetics?: unknown;
  meanings?: unknown;
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
  // 古い収録語はプロトコル相対（//ssl.gstatic.com/...）で返るため https に揃える。
  const audioUrl = chosen
    ? chosen.audio.startsWith('//') ? `https:${chosen.audio}` : chosen.audio
    : null;

  const textOf = (p: RawPhonetic | null): string | null =>
    p && typeof p.text === 'string' && p.text.length > 0 ? p.text : null;
  const firstText = phonetics.map(textOf).find((t): t is string => t !== null) ?? null;
  const topPhonetic =
    entries
      .map((e) => (typeof e?.phonetic === 'string' && e.phonetic.length > 0 ? e.phonetic : null))
      .find((t): t is string => t !== null) ?? null;
  const ipa = textOf(chosen) ?? firstText ?? topPhonetic ?? null;

  const pos = entries.flatMap((e) =>
    Array.isArray(e?.meanings)
      ? (e.meanings as Array<{ partOfSpeech?: unknown }>).map((m) => m?.partOfSpeech)
      : [],
  );
  return withPos({ ipa, audioUrl }, unique(pos));
}

/** 文字列だけを取り出し、前後の空白を除いて重複を省く（出現順は保つ）。 */
function unique(values: unknown[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    const t = typeof v === 'string' ? v.trim().toLowerCase() : '';
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * Cambridge 英英ページ HTML から見出し語の品詞を出現順・重複なしで取り出す。
 * 派生語（incremental のページの incrementally など）も同じ pos-header に品詞を持つが、
 * 見出し語（class="hw"）が無いので除く。見出し語の品詞だけを AI に渡すため。
 */
export function extractCambridgePartsOfSpeech(html: string): string[] {
  if (!html) return [];
  const found: string[] = [];
  for (const m of html.matchAll(/<span\s+class="pos\s+dpos"[^>]*>([^<]*)<\/span>/gi)) {
    const header = html.lastIndexOf('pos-header', m.index);
    if (header < 0) continue;
    if (!/class="hw[\s"]/.test(html.slice(header, m.index))) continue;
    found.push(m[1]);
  }
  return unique(found);
}

/**
 * Cambridge 英英ページ HTML から US 発音セクションの IPA と mp3 URL を抽出する。
 * IPA と音源は同じ US セクション内から取得する。片方しかない場合も取得できた方は返す。
 * 音源 URL が相対パスなら絶対 URL 化する。
 *
 * MV3 service worker では DOMParser が信頼できないため、HTML を文字列のまま走査する。
 */
export function extractCambridgeWordInfo(html: string): WordInfo {
  if (!html) return { ipa: null, audioUrl: null };
  try {
    const pos = extractCambridgePartsOfSpeech(html);
    const us = extractSpanContents(html, ['us', 'dpron-i']);
    if (!us) return withPos({ ipa: null, audioUrl: null }, pos);

    const ipa = extractSpanContents(us, ['ipa', 'dipa'])?.replace(/<[^>]*>/g, '').trim() || null;
    const src = extractCambridgeMp3Src(us);
    const audioUrl = src ? absolutizeCambridgeUrl(src) : null;

    return withPos({ ipa, audioUrl }, pos);
  } catch {
    return { ipa: null, audioUrl: null };
  }
}

function extractSpanContents(html: string, classes: string[]): string | null {
  const lookaheads = classes.map((name) => `(?=(?:[^"]*\\s)?${name}(?:\\s|"))`).join('');
  const opening = new RegExp(`<span\\s+class="${lookaheads}[^"]*"[^>]*>`, 'i').exec(html);
  if (!opening) return null;
  const contents = html.slice(opening.index + opening[0].length);

  // US セクションも IPA も span が入れ子になるため、対応する閉じタグまでを取る。
  let depth = 1;
  for (const tag of contents.matchAll(/<(\/?)span\b[^>]*>/gi)) {
    depth += tag[1] ? -1 : 1;
    if (depth === 0) return contents.slice(0, tag.index);
  }
  return null;
}

function extractCambridgeMp3Src(block: string): string | null {
  // <source ... type="audio/mpeg" ... src="..."> の属性順入れ替えにも対応
  const ordered = block.match(/<source\s+type="audio\/mpeg"\s+src="([^"]+)"/i);
  if (ordered) return ordered[1];
  const reversed = block.match(/<source\s+src="([^"]+)"\s+type="audio\/mpeg"/i);
  return reversed ? reversed[1] : null;
}

/**
 * 表示用に IPA を `/.../` で囲む。Cambridge はスラッシュ無しで、dictionaryapi.dev は
 * もともと `/.../` 付きで返るため、まず両端のスラッシュと空白を剥がしてから 1 回だけ巻き直す。
 * 中身が空になる場合は空文字を返し、呼び出し側で非表示にできるようにする。
 */
export function formatIpaForDisplay(ipa: string): string {
  const stripped = ipa.trim().replace(/^\/+|\/+$/g, '').trim();
  return stripped ? `/${stripped}/` : '';
}

function absolutizeCambridgeUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith('/')) return `${CAMBRIDGE_BASE}${path}`;
  return `${CAMBRIDGE_BASE}/${path}`;
}
