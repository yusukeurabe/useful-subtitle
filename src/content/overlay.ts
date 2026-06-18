import type { Token } from '../shared/tokenize';
import { CAPTION_TEXT_SELECTORS } from '../shared/selectors';

export interface OverlayCallbacks {
  /** 単語クリック or フレーズ選択が確定したとき。anchor は対象語のビューポート座標。 */
  onLookup: (selection: string, sentence: string, anchor: DOMRect) => void;
}

export type TranslationState =
  | { kind: 'loading' }
  | { kind: 'text'; text: string }
  | { kind: 'none' };

export interface Overlay {
  renderLine(sentence: string, tokens: Token[]): void;
  clearLine(): void;
  setTranslation(state: TranslationState): void;
  showPopupLoading(anchor: DOMRect, selection: string): void;
  showPopupResult(anchor: DOMRect, selection: string, text: string): void;
  showPopupError(anchor: DOMRect, message: string): void;
  hidePopup(): void;
  destroy(): void;
}

const STYLES = `
.subtitle {
  position: fixed; left: 50%; bottom: 12%; transform: translateX(-50%);
  max-width: 80vw; text-align: center; pointer-events: auto; user-select: none;
  font-family: -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
}
.original {
  font-size: clamp(20px, 3.2vw, 40px); font-weight: 700; line-height: 1.3;
  color: #fff; text-shadow: 0 0 4px #000, 0 2px 6px #000;
}
.word { cursor: pointer; border-radius: 4px; padding: 0 1px; }
.word:hover { background: rgba(255, 255, 255, 0.28); }
.word.selected { background: rgba(86, 156, 255, 0.6); }
.translation {
  margin-top: 6px; font-size: clamp(14px, 2vw, 24px); color: #ffe08a;
  text-shadow: 0 0 4px #000, 0 2px 6px #000;
}
.translation.loading { opacity: 0.6; }
.popup {
  position: fixed; max-width: 360px; min-width: 200px;
  background: #1e1e1e; color: #f3f3f3; border: 1px solid #444; border-radius: 10px;
  padding: 12px 28px 12px 14px; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
  font-size: 14px; line-height: 1.6; pointer-events: auto;
  font-family: -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
}
.popup .sel { font-weight: 700; color: #8ab4ff; margin-bottom: 4px; }
.popup .body { white-space: pre-wrap; }
.popup .body.loading { opacity: 0.7; }
.popup .body.err { color: #ff8a8a; }
.popup .close {
  position: absolute; top: 6px; right: 8px; cursor: pointer; color: #aaa;
  font-size: 16px; line-height: 1;
}
`;

interface WordRef {
  el: HTMLSpanElement;
  text: string;
}

export function createOverlay(callbacks: OverlayCallbacks): Overlay {
  const host = document.createElement('div');
  host.id = 'useful-subtitle-overlay';
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLES;
  shadow.appendChild(style);

  const subtitle = document.createElement('div');
  subtitle.className = 'subtitle';
  const original = document.createElement('div');
  original.className = 'original';
  const translation = document.createElement('div');
  translation.className = 'translation';
  subtitle.append(original, translation);
  shadow.appendChild(subtitle);

  // ネイティブ字幕を隠す（テキストは DOM に残るので読み取りは可能）。
  const hideStyle = document.createElement('style');
  hideStyle.textContent = `${CAPTION_TEXT_SELECTORS.join(', ')} { visibility: hidden !important; }`;

  let popup: HTMLDivElement | null = null;
  let currentSentence = '';
  let wordRefs: WordRef[] = [];
  let dragStart = -1;
  let dragEnd = -1;
  let dragging = false;

  const clearHighlight = (): void => {
    for (const w of wordRefs) w.el.classList.remove('selected');
  };
  const highlight = (a: number, b: number): void => {
    clearHighlight();
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    for (let i = lo; i <= hi; i++) wordRefs[i]?.el.classList.add('selected');
  };

  const finishSelection = (a: number, b: number): void => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const first = wordRefs[lo]?.el.getBoundingClientRect();
    const last = wordRefs[hi]?.el.getBoundingClientRect();
    if (!first || !last) return;
    const anchor = new DOMRect(
      Math.min(first.left, last.left),
      Math.min(first.top, last.top),
      Math.max(first.right, last.right) - Math.min(first.left, last.left),
      Math.max(first.bottom, last.bottom) - Math.min(first.top, last.top),
    );
    const selection = wordRefs.slice(lo, hi + 1).map((w) => w.text).join(' ');
    callbacks.onLookup(selection, currentSentence, anchor);
  };

  const onMouseUp = (): void => {
    if (!dragging) return;
    dragging = false;
    if (dragStart >= 0 && dragEnd >= 0) finishSelection(dragStart, dragEnd);
  };

  const onMouseMove = (e: MouseEvent): void => {
    if (!dragging) return;
    const node = shadow.elementFromPoint(e.clientX, e.clientY);
    if (!node) return;
    const idx = wordRefs.findIndex((w) => w.el === node);
    if (idx < 0) return;
    dragEnd = idx;
    highlight(dragStart, dragEnd);
  };

  const onDocMouseDown = (e: MouseEvent): void => {
    // シャドウ内（単語/ポップアップ）クリックは host にリターゲットされる。それ以外なら閉じる。
    if (popup && e.target !== host) hidePopup();
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') hidePopup();
  };

  function renderLine(sentence: string, tokens: Token[]): void {
    currentSentence = sentence;
    hidePopup();
    original.replaceChildren();
    wordRefs = [];
    for (const t of tokens) {
      if (!t.isWord) {
        original.appendChild(document.createTextNode(t.text));
        continue;
      }
      const span = document.createElement('span');
      span.className = 'word';
      span.textContent = t.text;
      const index = wordRefs.length;
      span.addEventListener('mousedown', (e) => {
        e.preventDefault();
        dragging = true;
        dragStart = index;
        dragEnd = index;
        highlight(index, index);
      });
      original.appendChild(span);
      wordRefs.push({ el: span, text: t.text });
    }
  }

  function clearLine(): void {
    original.replaceChildren();
    wordRefs = [];
    setTranslation({ kind: 'none' });
    hidePopup();
  }

  function setTranslation(state: TranslationState): void {
    if (state.kind === 'none') {
      translation.textContent = '';
      translation.className = 'translation';
    } else if (state.kind === 'loading') {
      translation.textContent = '… 翻訳中';
      translation.className = 'translation loading';
    } else {
      translation.textContent = state.text;
      translation.className = 'translation';
    }
  }

  const ensurePopup = (): HTMLDivElement => {
    if (popup) return popup;
    popup = document.createElement('div');
    popup.className = 'popup';
    shadow.appendChild(popup);
    return popup;
  };

  const buildPopupShell = (selection: string): HTMLDivElement => {
    const p = ensurePopup();
    p.replaceChildren();
    const close = document.createElement('div');
    close.className = 'close';
    close.textContent = '×';
    close.addEventListener('click', hidePopup);
    p.appendChild(close);
    if (selection) {
      const sel = document.createElement('div');
      sel.className = 'sel';
      sel.textContent = selection;
      p.appendChild(sel);
    }
    const body = document.createElement('div');
    body.className = 'body';
    p.appendChild(body);
    return body;
  };

  const positionPopup = (anchor: DOMRect): void => {
    if (!popup) return;
    const margin = 8;
    const pw = popup.offsetWidth;
    const ph = popup.offsetHeight;
    let left = anchor.left + anchor.width / 2 - pw / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - pw - margin));
    let top = anchor.top - ph - margin;
    if (top < margin) top = anchor.bottom + margin;
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  };

  function showPopupLoading(anchor: DOMRect, selection: string): void {
    const body = buildPopupShell(selection);
    body.className = 'body loading';
    body.textContent = '考え中…';
    positionPopup(anchor);
  }
  function showPopupResult(anchor: DOMRect, selection: string, text: string): void {
    const body = buildPopupShell(selection);
    body.textContent = text;
    positionPopup(anchor);
  }
  function showPopupError(anchor: DOMRect, message: string): void {
    const body = buildPopupShell('');
    body.className = 'body err';
    body.textContent = message;
    positionPopup(anchor);
  }

  function hidePopup(): void {
    if (popup) {
      popup.remove();
      popup = null;
    }
    clearHighlight();
  }

  // --- マウント & 全画面追従 ---
  const attach = (): void => {
    const target = document.fullscreenElement ?? document.body;
    if (host.parentElement !== target) target.appendChild(host);
  };
  const onFullscreenChange = (): void => attach();

  document.head.appendChild(hideStyle);
  document.addEventListener('mouseup', onMouseUp, true);
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('mousedown', onDocMouseDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('fullscreenchange', onFullscreenChange, true);
  attach();

  function destroy(): void {
    document.removeEventListener('mouseup', onMouseUp, true);
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('mousedown', onDocMouseDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('fullscreenchange', onFullscreenChange, true);
    hideStyle.remove();
    host.remove();
  }

  return {
    renderLine,
    clearLine,
    setTranslation,
    showPopupLoading,
    showPopupResult,
    showPopupError,
    hidePopup,
    destroy,
  };
}
