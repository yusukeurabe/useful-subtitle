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
 * 見えない文字（ゼロ幅スペース等）。YouTube の装飾付き字幕は行の前後に ​ を
 * 挟むが、`\s` には含まれないため空白を畳んでも残り、語間が広がったり単語に
 * くっついたりする。読み取り時に空白へ置き換えて畳む。
 */
const INVISIBLE_CHARS = /[​-‍⁠﻿]/g;

const normalizeText = (text: string): string =>
  text.replace(INVISIBLE_CHARS, ' ').replace(/\s+/g, ' ').trim();

export interface PickCaptionOptions {
  /**
   * 字幕を描く「層」（YouTube の `.caption-window`）のセレクタ。指定すると、
   * 字幕ノードを層ごとにまとめ、先に読んだ層と同じ文の層は読み飛ばす。
   *
   * YouTube の装飾付き字幕（作成者アップロードの影・縁取り付き字幕）は、同じ字幕を
   * 影用と縁取り用の 2 枚の層として同じ位置に重ねて描くため、全ノードを連結すると
   * 同じ文が 2 回つながる。違う文の層（上下に分かれた話者など）はそのまま連結する。
   */
  layerSelector?: string;
}

/**
 * DOM ルートから現在の字幕テキストを取り出す。
 * - セレクタは優先順に試し、最初に非空のテキストが取れたものを採用。
 * - 複数行・装飾（要素内の子要素や <br>、および複数要素）はスペースで区切って
 *   結合し、見えない文字と余分な空白を畳んで trim する。
 * - layerSelector があれば、同じ文を重ね描きした層は 1 回だけ読む。
 * - 見つからない/空なら null。
 */
export function pickCaptionText(
  root: ParentNode,
  selectors: readonly string[] = CAPTION_TEXT_SELECTORS,
  { layerSelector }: PickCaptionOptions = {},
): string | null {
  for (const sel of selectors) {
    const nodes = Array.from(root.querySelectorAll(sel));
    if (nodes.length === 0) continue;
    // 層ごとにノードをまとめる（層が無ければノード単位＝従来どおり全部連結）。
    const layers = new Map<Element, Element[]>();
    for (const node of nodes) {
      const layer = (layerSelector && node.closest(layerSelector)) || node;
      const group = layers.get(layer);
      if (group) group.push(node);
      else layers.set(layer, [node]);
    }
    const texts: string[] = [];
    for (const group of layers.values()) {
      const text = normalizeText(group.map((n) => readTextWithBoundaries(n)).join(' '));
      if (!text) continue;
      if (layerSelector && texts.includes(text)) continue;
      texts.push(text);
    }
    const text = texts.join(' ');
    if (text) return text;
  }
  return null;
}
