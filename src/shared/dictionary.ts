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

/**
 * Cambridge 英英ページ HTML から US 発音セクションの IPA と mp3 URL を抽出する。
 * IPA は主目的のため、IPA が取れなければ {null,null} を返す（呼び出し側はフォールバックする）。
 * 音源 URL が相対パスなら絶対 URL 化する。失敗系は静かに {null,null}。
 *
 * MV3 service worker では DOMParser が信頼できないため、HTML を文字列のまま走査する。
 */
export function extractCambridgeWordInfo(html: string): WordInfo {
  if (!html) return { ipa: null, audioUrl: null };
  try {
    const us = sliceCambridgeUsBlock(html);
    if (!us) return { ipa: null, audioUrl: null };

    const ipa = extractCambridgeIpa(us);
    if (!ipa) return { ipa: null, audioUrl: null };

    const src = extractCambridgeMp3Src(us);
    const audioUrl = src ? absolutizeCambridgeUrl(src) : null;

    return { ipa, audioUrl };
  } catch {
    return { ipa: null, audioUrl: null };
  }
}

// class 属性に us と dpron-i を両方含む最初の <span> から、次の dpron-i ブロック
// （UK または別語義の US）の直前までを切り出す。閉じ </span> をネスト追跡しないので
// 次のセクション開始位置でスコープを切る簡易策で十分。
function sliceCambridgeUsBlock(html: string): string | null {
  const usStart = matchClassAttr(html, ['us', 'dpron-i']);
  if (!usStart) return null;
  const after = html.slice(usStart.end);
  const next = matchClassAttr(after, ['dpron-i']); // uk/us いずれの次ブロックも検出
  return next ? after.slice(0, next.start) : after;
}

function extractCambridgeIpa(block: string): string | null {
  // <span class="... ipa ... dipa ...">CONTENT</span> の CONTENT 内側のタグを剥がして trim
  const m = block.match(
    /<span\s+class="(?=[^"]*\bipa\b)(?=[^"]*\bdipa\b)[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
  );
  if (!m) return null;
  const text = m[1].replace(/<[^>]*>/g, '').trim();
  return text || null;
}

function extractCambridgeMp3Src(block: string): string | null {
  // <source ... type="audio/mpeg" ... src="..."> の属性順入れ替えにも対応
  const ordered = block.match(/<source\s+type="audio\/mpeg"\s+src="([^"]+)"/i);
  if (ordered) return ordered[1];
  const reversed = block.match(/<source\s+src="([^"]+)"\s+type="audio\/mpeg"/i);
  return reversed ? reversed[1] : null;
}

// class 属性の値に指定した全クラスを（順不同・他クラス混在可で）含む最初の開始タグを探す。
function matchClassAttr(
  html: string,
  classes: string[],
): { start: number; end: number } | null {
  const lookaheads = classes.map((c) => `(?=[^"]*\\b${escapeRe(c)}\\b)`).join('');
  const re = new RegExp(`<span\\s+class="${lookaheads}[^"]*"`, 'i');
  const m = html.match(re);
  return m && m.index !== undefined
    ? { start: m.index, end: m.index + m[0].length }
    : null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
