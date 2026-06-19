/** 1 つの品詞とその一般訳。フレーズ・旧形式は pos=null。 */
export interface WordSense {
  /** Cambridge 式の品詞コード（"V[I/T]" / "N[C]" / "Adj." …）。フレーズ・旧形式は null。 */
  pos: string | null;
  /** その品詞の一般的な訳語（最大3つ・中黒区切り）。 */
  gloss: string;
}

/** AI 解説レスポンスを「品詞ごとの訳(senses)」と「文脈依存の説明(explanation)」に分解した結果。 */
export interface ParsedExplanation {
  /** 品詞ごとの訳。0 件以上。 */
  senses: WordSense[];
  /** 文脈に沿った説明文。 */
  explanation: string;
}

/** 品詞行 = 行頭の任意の箇条書き記号 + 英字始まりの品詞コード(英字・. [ ] /) + コロン + 訳。 */
const POS_LINE = /^\s*[-*]?\s*([A-Za-z][A-Za-z.[\]/]*)\s*[:：]\s*(.+?)\s*$/;
/** フレーズ・旧キャッシュ用の単一訳ラベル（訳: / 訳語:）。 */
const GLOSS_LINE = /^\s*訳(?:語)?\s*[:：]\s*(.+?)\s*$/;
/** 説明ラベル行（全角コロン可）。 */
const EXPL_LABEL = /^\s*説明\s*[:：]/;

/** 訳語の区切り（、 , ・ ／ /）を「・」に正規化し、最大3つに丸める。空なら ''。 */
function normalizeGloss(raw: string): string {
  return raw
    .split(/[、,・／/]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join('・');
}

/**
 * AI の構造化レスポンスを分解する。
 * - 単語: 品詞ごとの行（"V[I/T]: 走る・運営する"）を senses に。
 * - フレーズ/旧キャッシュ: 品詞行が無く "訳:" があれば pos=null の 1 件にフォールバック。
 * - "説明:" 以降を explanation に。ラベルが一切無ければ全文を explanation とし、安全に劣化する。
 */
export function parseExplanation(raw: string): ParsedExplanation {
  const text = (raw ?? '').trim();
  if (!text) return { senses: [], explanation: '' };

  const lines = text.split('\n');
  const explIdx = lines.findIndex((l) => EXPL_LABEL.test(l));
  // 品詞・訳の探索は説明ラベルより前の行に限る（説明本文を訳として誤検出しない）。
  const headLines = explIdx >= 0 ? lines.slice(0, explIdx) : lines.slice();

  const senses: WordSense[] = [];
  const consumed = new Set<number>();

  headLines.forEach((line, i) => {
    const m = line.match(POS_LINE);
    if (!m) return;
    const gloss = normalizeGloss(m[2]);
    if (!gloss) return;
    senses.push({ pos: m[1], gloss });
    consumed.add(i);
  });

  // 品詞行が 1 つも無いときだけ、フレーズ/旧形式の "訳:" を 1 件として拾う。
  if (senses.length === 0) {
    for (let i = 0; i < headLines.length; i++) {
      const m = headLines[i].match(GLOSS_LINE);
      if (!m) continue;
      const gloss = normalizeGloss(m[1]);
      if (gloss) {
        senses.push({ pos: null, gloss });
        consumed.add(i);
      }
      break;
    }
  }

  let explanation: string;
  if (explIdx >= 0) {
    const first = lines[explIdx].replace(/^\s*説明\s*[:：]\s*/, '');
    explanation = [first, ...lines.slice(explIdx + 1)].join('\n').trim();
  } else {
    explanation = headLines.filter((_, i) => !consumed.has(i)).join('\n').trim();
  }

  return { senses, explanation };
}
