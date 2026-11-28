export interface Token {
  text: string;
  /** クリックで意味を引ける「単語」なら true。空白・記号は false。 */
  isWord: boolean;
}

// 英単語（内部のアポストロフィ・ハイフン・& を含む。例: don't, well-known, R&D, AT&T）。
// & は前後が英字で挟まれているときだけ語の一部にする（"rock & roll" の & は区切り）。
const WORD_RE = /[A-Za-z]+(?:['’\-&][A-Za-z]+)*/g;

/**
 * 字幕一文を「単語」と「それ以外（空白・記号）」のトークン列に分解する。
 * tokens を text 連結すると必ず元の文字列に戻る（描画時に欠落させないため）。
 */
export function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const m of line.matchAll(WORD_RE)) {
    const start = m.index;
    if (start > last) tokens.push({ text: line.slice(last, start), isWord: false });
    tokens.push({ text: m[0], isWord: true });
    last = start + m[0].length;
  }
  if (last < line.length) tokens.push({ text: line.slice(last), isWord: false });
  return tokens;
}
