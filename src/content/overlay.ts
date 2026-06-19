import type { Token } from '../shared/tokenize';
import type { WordSense } from '../shared/explanation';
import { CAPTION_TEXT_SELECTORS } from '../shared/selectors';
import { cambridgeUrl } from '../shared/dictionary';

export interface OverlayCallbacks {
  /** 単語クリック or フレーズ選択が確定したとき。anchor は対象語のビューポート座標。 */
  onLookup: (selection: string, sentence: string, anchor: DOMRect) => void;
  /** ポップアップの🔊が押されたとき。audioUrl は先読み済みネイティブ音源（無ければ null）。 */
  onPlayAudio: (selection: string, audioUrl: string | null) => void;
}

export interface OverlayOptions {
  /** 字幕の初期縦位置（画面下からの％）。 */
  bottomPercent: number;
  /** ユーザーが位置を変えたとき（永続化用）。 */
  onBottomChange: (percent: number) => void;
}

export type TranslationState =
  | { kind: 'loading' }
  | { kind: 'text'; text: string }
  | { kind: 'none' };

export interface Overlay {
  renderLine(sentence: string, tokens: Token[]): void;
  clearLine(): void;
  setTranslation(state: TranslationState): void;
  openPopup(anchor: DOMRect, selection: string): void;
  setPopupMeaning(explanation: string, senses: WordSense[]): void;
  setPopupError(message: string): void;
  setPopupWordInfo(ipa: string | null, audioUrl: string | null): void;
  hidePopup(): void;
  destroy(): void;
}

const STYLES = `
.subtitle {
  position: fixed; left: 50%; transform: translateX(-50%);
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
.popup .sel { margin-bottom: 4px; }
.popup .sel .sel-word { font-weight: 700; color: #8ab4ff; }
.popup .senses {
  display: grid; grid-template-columns: auto 1fr; column-gap: 10px; row-gap: 2px;
  margin: 0 0 8px;
}
.popup .senses .pos {
  color: #b9c4d6; font-size: 13px; white-space: nowrap;
  font-family: "SF Mono", Menlo, Consolas, monospace;
}
.popup .senses .sense-gloss { color: #d8d8d8; font-size: 13px; }
.popup .body { white-space: pre-wrap; }
.popup .body.loading { opacity: 0.7; }
.popup .body.err { color: #ff8a8a; }
.popup .close {
  position: absolute; top: 6px; right: 8px; cursor: pointer; color: #aaa;
  font-size: 16px; line-height: 1;
}
.popup .ipa {
  color: #b9c4d6; font-size: 13px; margin: 0 0 8px;
  font-family: "SF Mono", Menlo, Consolas, monospace;
}
.popup .actions { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
.popup .act-btn {
  border: 1px solid #3a3a3a; background: #2a2a2a; color: #f3f3f3;
  border-radius: 6px; padding: 4px 10px; font-size: 13px; cursor: pointer;
  font-family: inherit; line-height: 1.2;
}
.popup .act-btn:hover { background: #3a3a3a; }
.popup .act-btn:active { background: #4a4a4a; }
.popup .act-link {
  color: #8ab4ff; text-decoration: none; font-size: 13px; line-height: 1.2;
  border: 1px solid #2f3b52; border-radius: 6px; padding: 4px 10px;
}
.popup .act-link:hover { background: rgba(86, 156, 255, 0.15); }
.pos-controls {
  position: absolute; right: -44px; top: 50%; transform: translateY(-50%);
  display: flex; flex-direction: column; gap: 4px;
  opacity: 0.2; transition: opacity 0.2s;
}
.subtitle:hover .pos-controls { opacity: 0.9; }
.pos-btn {
  width: 32px; height: 32px; border-radius: 6px; border: none;
  background: rgba(0, 0, 0, 0.6); color: #fff; font-size: 13px;
  cursor: pointer; pointer-events: auto; line-height: 1;
}
.pos-btn:hover { background: rgba(86, 156, 255, 0.85); }
`;

interface WordRef {
  el: HTMLSpanElement;
  text: string;
}

export function createOverlay(callbacks: OverlayCallbacks, options: OverlayOptions): Overlay {
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

  let bottomPercent = options.bottomPercent;
  const applyBottom = (): void => {
    subtitle.style.bottom = `${bottomPercent}%`;
  };
  const STEP = 6;
  const MIN = 2;
  const MAX = 85;
  const move = (delta: number): void => {
    bottomPercent = Math.max(MIN, Math.min(MAX, bottomPercent + delta));
    applyBottom();
    options.onBottomChange(bottomPercent);
  };
  const posControls = document.createElement('div');
  posControls.className = 'pos-controls';
  const upBtn = document.createElement('button');
  upBtn.className = 'pos-btn';
  upBtn.textContent = '▲';
  upBtn.title = '字幕を上へ';
  upBtn.addEventListener('click', () => move(STEP));
  const downBtn = document.createElement('button');
  downBtn.className = 'pos-btn';
  downBtn.textContent = '▼';
  downBtn.title = '字幕を下へ';
  downBtn.addEventListener('click', () => move(-STEP));
  posControls.append(upBtn, downBtn);
  subtitle.appendChild(posControls);
  applyBottom();

  shadow.appendChild(subtitle);

  // ネイティブ字幕を隠す（テキストは DOM に残るので読み取りは可能）。
  const hideStyle = document.createElement('style');
  hideStyle.textContent = `${CAPTION_TEXT_SELECTORS.join(', ')} { visibility: hidden !important; }`;

  let popup: HTMLDivElement | null = null;
  let popupBody: HTMLDivElement | null = null;
  let popupIpa: HTMLDivElement | null = null;
  let popupSenses: HTMLDivElement | null = null;
  let popupAnchor: DOMRect | null = null;
  let popupSelection = '';
  let popupAudioUrl: string | null = null;
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

  // ヘッダ（×・選択語・IPA・操作列）は安定して残り、本文だけ「考え中…」→結果/エラーへ更新する。
  function openPopup(anchor: DOMRect, selection: string): void {
    const p = ensurePopup();
    p.replaceChildren();
    popupAnchor = anchor;
    popupSelection = selection;
    popupAudioUrl = null;

    const close = document.createElement('div');
    close.className = 'close';
    close.textContent = '×';
    close.addEventListener('click', hidePopup);
    p.appendChild(close);

    const sel = document.createElement('div');
    sel.className = 'sel';
    const selWord = document.createElement('span');
    selWord.className = 'sel-word';
    selWord.textContent = selection;
    sel.appendChild(selWord);
    p.appendChild(sel);

    // 単語の下に「品詞ごとの訳」グリッド（AI 応答が来たら setPopupMeaning で埋める）。
    popupSenses = document.createElement('div');
    popupSenses.className = 'senses';
    popupSenses.style.display = 'none';
    p.appendChild(popupSenses);

    popupIpa = document.createElement('div');
    popupIpa.className = 'ipa';
    popupIpa.style.display = 'none';
    p.appendChild(popupIpa);

    const actions = document.createElement('div');
    actions.className = 'actions';

    const audioBtn = document.createElement('button');
    audioBtn.className = 'act-btn';
    audioBtn.textContent = '🔊';
    audioBtn.title = '発音を再生';
    audioBtn.addEventListener('click', () => callbacks.onPlayAudio(popupSelection, popupAudioUrl));
    actions.appendChild(audioBtn);

    const link = document.createElement('a');
    link.className = 'act-link';
    link.textContent = 'Cambridge ↗';
    link.title = 'Cambridge 英英辞典で開く';
    link.href = cambridgeUrl(selection);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    actions.appendChild(link);

    p.appendChild(actions);

    popupBody = document.createElement('div');
    popupBody.className = 'body loading';
    popupBody.textContent = '考え中…';
    p.appendChild(popupBody);

    positionPopup(anchor);
  }

  function setPopupMeaning(explanation: string, senses: WordSense[]): void {
    if (popupBody) {
      popupBody.className = 'body';
      popupBody.textContent = explanation;
    }
    if (popupSenses) {
      popupSenses.replaceChildren();
      if (senses.length > 0) {
        // グリッド2列（品詞 / 訳）。pos=null（フレーズ・旧形式）はコード列を空にする。
        for (const s of senses) {
          const pos = document.createElement('span');
          pos.className = 'pos';
          pos.textContent = s.pos ?? '';
          const gloss = document.createElement('span');
          gloss.className = 'sense-gloss';
          gloss.textContent = s.gloss;
          popupSenses.append(pos, gloss);
        }
        popupSenses.style.display = '';
      } else {
        popupSenses.style.display = 'none';
      }
    }
    if (popupAnchor) positionPopup(popupAnchor);
  }

  function setPopupError(message: string): void {
    if (!popupBody) return;
    popupBody.className = 'body err';
    popupBody.textContent = message;
    if (popupAnchor) positionPopup(popupAnchor);
  }

  function setPopupWordInfo(ipa: string | null, audioUrl: string | null): void {
    popupAudioUrl = audioUrl;
    if (!popupIpa) return;
    if (ipa) {
      popupIpa.textContent = ipa;
      popupIpa.style.display = '';
    } else {
      popupIpa.textContent = '';
      popupIpa.style.display = 'none';
    }
    if (popupAnchor) positionPopup(popupAnchor);
  }

  function hidePopup(): void {
    if (popup) {
      popup.remove();
      popup = null;
    }
    popupBody = null;
    popupIpa = null;
    popupSenses = null;
    popupAnchor = null;
    popupAudioUrl = null;
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
    openPopup,
    setPopupMeaning,
    setPopupError,
    setPopupWordInfo,
    hidePopup,
    destroy,
  };
}
