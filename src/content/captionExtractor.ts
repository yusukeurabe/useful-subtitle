import { CAPTION_TEXT_SELECTORS } from '../shared/selectors';

/**
 * DOM ルートから現在の字幕テキストを取り出す。
 * - セレクタは優先順に試し、最初に非空のテキストが取れたものを採用。
 * - 複数行（複数要素）はスペースで結合し、余分な空白を畳んで trim する。
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
      .map((n) => n.textContent ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) return text;
  }
  return null;
}
