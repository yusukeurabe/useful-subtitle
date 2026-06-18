/** AI 解説レスポンスを「一般訳(gloss)」と「文脈依存の説明(explanation)」に分解した結果。 */
export interface ParsedExplanation {
  /** 一般的な訳語（最大3つ・中黒区切り）。無ければ null。 */
  gloss: string | null;
  /** 文脈に沿った説明文。 */
  explanation: string;
}

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
 * AI の構造化レスポンス（「訳: …」「説明: …」）を分解する。
 * ラベルが無い場合（旧キャッシュ・形式逸脱）は gloss=null・全文を explanation とし、安全に劣化する。
 */
export function parseExplanation(raw: string): ParsedExplanation {
  const text = (raw ?? '').trim();
  if (!text) return { gloss: null, explanation: '' };

  const glossMatch = text.match(/^訳(?:語)?[ \t]*[:：][ \t]*(.+?)[ \t]*$/m);
  const explMatch = text.match(/^説明[ \t]*[:：]\s*([\s\S]+)$/m);

  const gloss = glossMatch ? normalizeGloss(glossMatch[1]) : '';

  let explanation: string;
  if (explMatch) {
    explanation = explMatch[1].trim();
  } else if (glossMatch) {
    explanation = text.replace(glossMatch[0], '').trim();
  } else {
    explanation = text;
  }

  return { gloss: gloss || null, explanation };
}
