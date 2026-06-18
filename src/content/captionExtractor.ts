import { CAPTION_TEXT_SELECTORS } from '../shared/selectors';

/**
 * 要素内のテキストを、子要素や <br> の境界にスペースを入れながら取り出す。
 *
 * textContent は子要素間や <br> 改行に空白を挿入しない。Prime の字幕は
 * 複数行（<br>）や装飾（ネストした span 等）で内部が分割されることがあり、
 * textContent のままだと境界で前後の単語がくっつく（例: "...line<br>Second..."
 * → "...lineSecond..."）。テキストノードはそのまま、子要素と <br> の境界は
 * スペースで区切ることでこれを防ぐ（連続空白は呼び出し側で 1 個に畳む）。
 */
function readTextWithBoundaries(node: Node): string {
  let out = '';
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.nodeValue ?? '';
    } else if (child.nodeName === 'BR') {
      out += ' ';
    } else {
      out += ` ${readTextWithBoundaries(child)} `;
    }
  }
  return out;
}

/**
 * DOM ルートから現在の字幕テキストを取り出す。
 * - セレクタは優先順に試し、最初に非空のテキストが取れたものを採用。
 * - 複数行・装飾（要素内の子要素や <br>、および複数要素）はスペースで区切って
 *   結合し、余分な空白を畳んで trim する。
 * - 見つからない/空なら null。
 */
export function pickCaptionText(
  root: ParentNode,
  selectors: readonly string[] = CAPTION_TEXT_SELECTORS,
): string | null {
  for (const sel of selectors) {
    const nodes = root.querySelectorAll(sel);
    if (nodes.length === 0) continue;
    const text = Array.from(nodes)
      .map((n) => readTextWithBoundaries(n))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) return text;
  }
  return null;
}
