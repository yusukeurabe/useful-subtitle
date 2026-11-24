/** Cambridge の見出し語の定義（品詞ごと）。 */
export interface DefinitionGroup {
  /** その見出しの品詞（"adjective"。1つの見出しに品詞が複数あれば "adverb, adjective"）。 */
  pos: string;
  /** 定義の原文（ページに出てくる順・重複なし・最大8個）。 */
  defs: string[];
}

/** 辞書から得る単語情報（発音記号と音源URL、見出し語の品詞と定義）。 */
export interface WordInfo {
  ipa: string | null;
  audioUrl: string | null;
  /** 辞書に載っている見出し語の品詞（"adjective" など英語・出現順・重複なし）。取れなければ省略。 */
  pos?: string[];
  /** Cambridge の見出し語の定義（品詞ごと）。取れなければ省略。 */
  definitions?: DefinitionGroup[];
}

/** 品詞が1つ以上あるときだけ pos を付ける（空配列は持たない）。 */
function withPos(info: WordInfo, pos: string[]): WordInfo {
  return pos.length > 0 ? { ...info, pos } : info;
}

/** 定義が1つ以上あるときだけ definitions を付ける（空配列は持たない）。 */
function withDefinitions(info: WordInfo, definitions: DefinitionGroup[]): WordInfo {
  return definitions.length > 0 ? { ...info, definitions } : info;
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

/** 見出し・派生語の品詞の span（語義ごとの "pos dsense_pos" は含めない）。 */
const POS_SPAN = /<span\s+class="pos\s+dpos"[^>]*>([^<]*)<\/span>/gi;

/**
 * Cambridge 英英ページ HTML から見出し語の品詞を出現順・重複なしで取り出す。
 * 派生語（incremental のページの incrementally など）も同じ pos-header に品詞を持つが、
 * 見出し語（class="hw"）が無いので除く。見出し語の品詞だけを AI に渡すため。
 */
export function extractCambridgePartsOfSpeech(html: string): string[] {
  if (!html) return [];
  const found: string[] = [];
  for (const m of html.matchAll(POS_SPAN)) {
    const header = html.lastIndexOf('pos-header', m.index);
    if (header < 0) continue;
    if (!/class="hw[\s"]/.test(html.slice(header, m.index))) continue;
    found.push(m[1]);
  }
  return unique(found);
}

/** 1つの品詞につき AI に渡す定義の候補の上限。 */
const MAX_DEFINITIONS_PER_POS = 8;

/**
 * Cambridge 英英ページ HTML から見出し語の定義を品詞ごとに取り出す。
 * 品詞の判定は extractCambridgePartsOfSpeech と同じく、pos-header の品詞の前に
 * 見出し語（class="hw"）があるものだけ（派生語 runon の定義は除く）。
 * 成句（phrase-block。then and there など）の定義も除く: 語義（dsense）の始まりより後に
 * 成句が始まっていれば、その定義は成句のもの。
 */
export function extractCambridgeDefinitions(html: string): DefinitionGroup[] {
  if (!html) return [];
  const groups: DefinitionGroup[] = [];
  for (const m of html.matchAll(/<div\s+class="def\s+ddef_d[^"]*"[^>]*>/gi)) {
    const header = html.lastIndexOf('pos-header', m.index);
    if (header < 0) continue;
    if (html.lastIndexOf('phrase-block', m.index) > html.lastIndexOf('dsense', m.index)) continue;
    const pos = headwordPos(html.slice(header, m.index));
    if (!pos) continue;
    const start = m.index + m[0].length;
    const end = html.indexOf('</div>', start);
    if (end < 0) continue;
    const text = cleanDefinition(html.slice(start, end));
    if (!text) continue;
    let group = groups.find((g) => g.pos === pos);
    if (!group) {
      group = { pos, defs: [] };
      groups.push(group);
    }
    if (group.defs.length < MAX_DEFINITIONS_PER_POS && !group.defs.includes(text)) group.defs.push(text);
  }
  return groups;
}

/** pos-header から定義までの範囲で、見出し語の品詞を "adverb, adjective" の形で返す。派生語なら null。 */
function headwordPos(segment: string): string | null {
  const spans = [...segment.matchAll(POS_SPAN)];
  if (spans.length === 0) return null;
  if (!/class="hw[\s"]/.test(segment.slice(0, spans[0].index))) return null;
  return unique(spans.map((s) => s[1])).join(', ') || null;
}

/** 定義の HTML を1行の文にする（タグ・文字参照・余分な空白・末尾のコロンを処理）。 */
function cleanDefinition(raw: string): string {
  return decodeEntities(raw.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s+,/g, ',')
    .trim()
    .replace(/\s*:$/, '')
    .trim();
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** HTML 文字参照（&#39; &#x27; &amp; など）を文字に戻す。知らないものはそのまま残す。 */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    const c = code.toLowerCase();
    if (c.startsWith('#')) {
      const n = c.startsWith('#x') ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    }
    return NAMED_ENTITIES[c] ?? all;
  });
}

/**
 * Cambridge 英英ページ HTML から US 発音セクションの IPA と mp3 URL を抽出する。
 * 見出し語の品詞と定義も返す。
 * IPA と音源は同じ US セクション内から取得する。片方しかない場合も取得できた方は返す。
 * 音源 URL が相対パスなら絶対 URL 化する。
 *
 * MV3 service worker では DOMParser が信頼できないため、HTML を文字列のまま走査する。
 */
export function extractCambridgeWordInfo(html: string): WordInfo {
  if (!html) return { ipa: null, audioUrl: null };
  try {
    const pos = extractCambridgePartsOfSpeech(html);
    const definitions = extractCambridgeDefinitions(html);
    const extras = (info: WordInfo): WordInfo => withDefinitions(withPos(info, pos), definitions);
    const us = extractSpanContents(html, ['us', 'dpron-i']);
    if (!us) return extras({ ipa: null, audioUrl: null });

    const ipa = extractSpanContents(us, ['ipa', 'dipa'])?.replace(/<[^>]*>/g, '').trim() || null;
    const src = extractCambridgeMp3Src(us);
    const audioUrl = src ? absolutizeCambridgeUrl(src) : null;

    return extras({ ipa, audioUrl });
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
