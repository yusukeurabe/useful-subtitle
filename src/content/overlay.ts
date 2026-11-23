import { isYouTube, youtubePlayer } from './site';
import type { Token } from '../shared/tokenize';
import type { WordSense } from '../shared/explanation';
import { CAPTION_TEXT_SELECTORS, YOUTUBE_CAPTION_SELECTORS } from '../shared/selectors';
import { cambridgeUrl, formatIpaForDisplay } from '../shared/dictionary';
import { createListIcon, createPauseIcon, createPlayIcon, createSpeakerButton } from './icons';

export interface OverlayCallbacks {
  /** 単語クリック or フレーズ選択が確定したとき。anchor は対象語のビューポート座標。 */
  onLookup: (selection: string, sentence: string, anchor: DOMRect) => void;
  /** ポップアップの🔊が押されたとき。audioUrl は先読み済みネイティブ音源（無ければ null）。 */
  onPlayAudio: (selection: string, audioUrl: string | null) => void;
  /** 字幕先頭の▶が押されたとき。引数はその字幕が現れた瞬間の動画位置（秒）。 */
  onSeek: (videoTime: number) => void;
  /** 字幕下の巻き戻しボタン（↺5 / ↺10）が押されたとき。引数は戻す秒数。 */
  onRewind?: (seconds: number) => void;
  /** 字幕下の早送りボタン（↻5 / ↻10）が押されたとき。引数は進める秒数。 */
  onForward?: (seconds: number) => void;
  /** 字幕下の再生/一時停止ボタンが押されたとき。 */
  onTogglePlay?: () => void;
  /** 字幕下の字幕リスト開閉ボタンが押されたとき。未指定ならボタンを出さない（字幕リスト無効時）。 */
  onToggleTranscript?: () => void;
  /** 字幕枠にカーソルが入ったとき（字幕ホバーで一時停止用）。 */
  onHoverStart?: () => void;
  /**
   * 字幕枠とポップアップのホバーが終わったとき。
   * resume=false はポップアップ外側のクリック等で閉じた場合（再開はユーザーに委ねる）。
   */
  onHoverEnd?: (opts: { resume: boolean }) => void;
}

export interface OverlayOptions {
  /** 字幕の初期縦位置（画面下からの％）。 */
  bottomPercent: number;
  /** ユーザーが位置を変えたとき（永続化用）。 */
  onBottomChange: (percent: number) => void;
}

/** ポップアップ下段に出す「いま表示中の字幕一文」の意味。null＝取得中。 */
export type PopupSentenceMeaning =
  | { ok: true; translation: string; explanation: string }
  | { ok: false; error: string }
  | null;

export type TranslationState =
  | { kind: 'loading' }
  | { kind: 'text'; text: string }
  | { kind: 'none' };

export interface Overlay {
  renderLine(sentence: string, tokens: Token[], videoTime: number): void;
  clearLine(hideControls?: boolean): void;
  setTranslation(state: TranslationState): void;
  openPopup(anchor: DOMRect, selection: string): number;
  isPopupCurrent(token: number): boolean;
  setPopupMeaning(explanation: string, senses: WordSense[]): void;
  setPopupError(message: string): void;
  setPopupWordInfo(ipa: string | null, audioUrl: string | null): void;
  /** ポップアップ下段（字幕一文の和訳＋解説）を描画する。呼ぶまでは下段を出さない。 */
  setPopupSentence(meaning: PopupSentenceMeaning): void;
  hidePopup(): void;
  /** 字幕下の再生/一時停止ボタンの見た目を動画の状態に合わせる（true＝再生中）。 */
  setPlaying(playing: boolean): void;
  /** 字幕下の字幕リスト開閉ボタンの点灯を、字幕リストの開閉状態に合わせる（true＝開いている）。 */
  setTranscriptOpen(open: boolean): void;
  syncMount(): void;
  destroy(): void;
}

const STYLES = `
.subtitle {
  position: fixed; left: 50%; transform: translateX(-50%);
  max-width: 80vw; text-align: center; pointer-events: auto; user-select: none;
  font-family: -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
  background: rgba(0, 0, 0, 0.6); border-radius: 4px;
  padding: 6px 10px; box-sizing: border-box;
}
.original {
  position: relative; display: inline-block;
  font-size: clamp(16px, 1.8vw, 28px); font-weight: 700; line-height: 1.3;
  color: #fff; text-shadow: 0 0 4px #000, 0 2px 6px #000;
}
.replay-btn {
  position: absolute; right: calc(100% + 8px); top: 50%; transform: translateY(-50%);
  width: 32px; height: 32px; border-radius: 6px; border: none;
  background: rgba(0, 0, 0, 0.6); color: #fff; font-size: 13px; line-height: 1;
  cursor: pointer; pointer-events: auto;
  opacity: 0; transition: opacity 0.2s;
}
.subtitle:hover .replay-btn { opacity: 0.9; }
.replay-btn:hover { background: rgba(86, 156, 255, 0.85); }
.word { cursor: pointer; border-radius: 4px; padding: 0 1px; }
.word:hover { background: rgba(255, 255, 255, 0.28); }
.word.selected { background: rgba(86, 156, 255, 0.6); }
.translation {
  margin-top: 6px; font-size: clamp(13px, 1.4vw, 20px); color: #ffe08a;
  text-shadow: 0 0 4px #000, 0 2px 6px #000;
}
.translation.loading { opacity: 0.6; }
.translation:empty { display: none; }
/* 幅は内容によらず固定する（読み込み中→結果で幅が変わると、中央寄せの位置ごと単語・発音記号が横にずれるため）。
   border-box なので min-height/max-height の px がそのまま見た目の高さになる。 */
.popup {
  position: fixed; box-sizing: border-box; width: 404px; max-width: calc(100% - 16px);
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
/* 英語の定義は訳語の真下（訳語と同じ 2 列目）に、一回り小さく控えめに出す。 */
.popup .senses .sense-def {
  grid-column: 2; color: #a9a9a9; font-size: 12px; line-height: 1.45; margin: -1px 0 3px;
}
.popup .body { white-space: pre-wrap; }
.popup .body.loading { opacity: 0.7; }
.popup .body.err { color: #ff8a8a; }
/* 読み込み中のスケルトン。1 本の高さ＝その場所に入る文字 1 行ぶん（font-size×line-height）にして、
   結果が届いて文字に置き換わっても背の高さがほぼ変わらないようにする。 */
.popup .senses .skeleton { grid-column: 1 / -1; display: grid; row-gap: 2px; font-size: 13px; }
.popup .skel-line { height: 1.6em; display: flex; align-items: center; }
.popup .skel-line::before {
  content: ''; display: block; width: 100%; height: 0.8em; border-radius: 4px;
  background: #343434; animation: us-skel-pulse 1.2s ease-in-out infinite;
}
.popup .skel-line:last-child::before { width: 60%; }
.popup .senses .skel-line::before { width: 55%; }
@keyframes us-skel-pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
/* 下段：いま表示中の字幕一文の和訳＋解説（字幕一覧のホバーポップアップ下段と同じ見せ方）。 */
.popup .sentence { margin-top: 10px; padding-top: 10px; border-top: 1px solid #3a3a3a; }
.popup .sentence .s-label { font-size: 11px; color: #8ab4ff; font-weight: 700; margin-bottom: 2px; }
.popup .sentence .s-trans { color: #ffe08a; white-space: pre-wrap; margin-bottom: 4px; }
.popup .sentence .s-expl { white-space: pre-wrap; color: #cfcfcf; font-size: 13px; }
.popup .close {
  position: absolute; top: 6px; right: 8px; cursor: pointer; color: #aaa;
  font-size: 16px; line-height: 1;
}
.popup .pronounce {
  display: flex; align-items: center; gap: 8px; margin: 0 0 8px;
}
.popup .audio-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0; flex: none;
  border: 1px solid #2f3b52; border-radius: 50%; background: transparent;
  color: #8ab4ff; cursor: pointer; transition: background 0.15s, color 0.15s;
}
.popup .audio-btn:hover { background: rgba(86, 156, 255, 0.15); color: #b3cdff; }
.popup .audio-btn:active { background: rgba(86, 156, 255, 0.28); }
.popup .ipa {
  color: #b9c4d6; font-size: 13px;
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
/* padding-left: 12px は right:-44px からボタン幅 32px を引いた値で、字幕枠と▲▼の
   すき間を埋めている。片方を変えたらもう片方も合わせること（すき間が開くと
   ▲▼へ移る途中で字幕枠から出たことになり、再生が一瞬動いてしまう）。 */
.pos-controls {
  position: absolute; right: -44px; top: 50%; transform: translateY(-50%);
  display: flex; flex-direction: column; gap: 4px; padding-left: 12px;
  opacity: 0.2; transition: opacity 0.2s;
}
.subtitle:hover .pos-controls { opacity: 0.9; }
.pos-btn {
  width: 32px; height: 32px; border-radius: 6px; border: none;
  background: rgba(0, 0, 0, 0.6); color: #fff; font-size: 13px;
  cursor: pointer; pointer-events: auto; line-height: 1;
}
.pos-btn:hover { background: rgba(86, 156, 255, 0.85); }
.pos-handle {
  width: 32px; height: 22px; border-radius: 6px;
  background: rgba(0, 0, 0, 0.6); color: #fff; font-size: 14px; line-height: 22px;
  text-align: center; cursor: ns-resize; pointer-events: auto;
  touch-action: none; user-select: none;
}
.pos-handle:hover { background: rgba(86, 156, 255, 0.85); }
/* 字幕の真下に置く巻き戻しボタン。.subtitle の外の別要素なので字幕が消えても残る。
   --sub-bottom は字幕の bottom（%）。36px = ボタン高さ 32px + すき間 4px で、
   字幕を一番下まで下げたときは 4px で止まり字幕に少し重なる。
   並びは [↺10][↺5][再生/一時停止][↻5][↻10]([字幕リスト開閉])[つまみ]。再生/一時停止ボタン
   （幅 44px）の中心を画面中央に置くため、バーの右端を 50% + 156px に合わせる（= 自分の幅だけ
   左へずらして 156px 戻す。156 = ボタン幅の半分 22 + (すき間 6 + 早送りボタン幅 44) × 2
   + すき間 6 + つまみ幅 28）。字幕リスト開閉ボタンがあるとき（.has-list）は 198px
   （= 156 + 開閉ボタン幅 36 + すき間 6）。
   ボタン幅・すき間・つまみ幅のどれかを変えたら 156px / 198px も合わせること。 */
.rewind-bar {
  position: fixed; left: 50%; transform: translateX(calc(-100% + 156px));
  bottom: max(4px, calc(var(--sub-bottom) - 36px));
  display: flex; gap: 6px; pointer-events: auto;
  opacity: 0.35; transition: opacity 0.2s;
}
/* display: flex が hidden 属性の UA スタイルに勝つので、hidden で消えるよう明示する。 */
.rewind-bar[hidden] { display: none; }
.subtitle:hover ~ .rewind-bar, .rewind-bar:hover { opacity: 0.9; }
.rewind-btn {
  height: 32px; min-width: 44px; padding: 0 8px; border-radius: 6px; border: none;
  background: rgba(0, 0, 0, 0.6); color: #fff; font-size: 13px; line-height: 1;
  font-family: -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
  cursor: pointer;
}
.rewind-btn:hover { background: rgba(86, 156, 255, 0.85); }
/* 巻き戻し・早送りボタン。中央合わせの計算がずれないよう、文字幅によらず固定幅にする。 */
.skip-btn { width: 44px; padding: 0; }
/* 画面中央の再生/一時停止ボタン。アイコンの切り替えで幅が変わらないよう固定幅にする。 */
.play-toggle {
  width: 44px; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
}
/* 再生/一時停止ボタンの右隣（中央より少し右）に置く字幕位置のつまみ。ボタンと高さをそろえる。 */
.rewind-bar .bar-handle { width: 28px; height: 32px; line-height: 32px; }
.rewind-bar.has-list { transform: translateX(calc(-100% + 198px)); }
/* 再生/一時停止ボタンの右隣に置く字幕リストの開閉ボタン。開いている間は青く点灯する。 */
.list-toggle {
  width: 36px; min-width: 36px; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
}
.list-toggle.open { background: rgba(86, 156, 255, 0.85); }
`;

interface WordRef {
  el: HTMLSpanElement;
  text: string;
}

export function createOverlay(callbacks: OverlayCallbacks, options: OverlayOptions): Overlay {
  const youtube = isYouTube();
  const host = document.createElement('div');
  host.id = 'useful-subtitle-overlay';
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLES;
  shadow.appendChild(style);

  const subtitle = document.createElement('div');
  subtitle.className = 'subtitle';
  subtitle.hidden = true;
  if (youtube) {
    host.style.position = 'absolute';
    subtitle.style.position = 'absolute';
    subtitle.style.maxWidth = '80%';
  }
  const original = document.createElement('div');
  original.className = 'original';
  const translation = document.createElement('div');
  translation.className = 'translation';
  subtitle.append(original, translation);
  // 字幕の真下の巻き戻しボタン。字幕の合間に .subtitle が hidden になっても押せるよう、
  // .subtitle の子にせず直後の兄弟として置く（そのため字幕ホバー一時停止の対象外）。
  // 最初の字幕（renderLine）が出るまでは隠す（Prime のホームや詳細ページで出さないため）。
  const rewindBar = document.createElement('div');
  rewindBar.className = 'rewind-bar';
  rewindBar.hidden = true;
  if (youtube) rewindBar.style.position = 'absolute';
  // 巻き戻し（↺）・早送り（↻）ボタン。direction で向きを決める。
  const makeSkipBtn = (seconds: number, direction: 'back' | 'forward'): HTMLButtonElement => {
    const back = direction === 'back';
    const btn = document.createElement('button');
    btn.className = `rewind-btn skip-btn ${back ? 'skip-back' : 'skip-forward'}`;
    btn.textContent = `${back ? '↺' : '↻'}${seconds}`;
    btn.title = `${seconds}秒${back ? '戻る' : '進む'}`;
    // クリックでフォーカスを取らない（取ると、押した後の Space で一時停止のつもりが再度押される）。
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => {
      // 開いている単語ポップアップは閉じる。再開はシーク側の再生に任せる。
      hidePopup(false);
      if (back) callbacks.onRewind?.(seconds);
      else callbacks.onForward?.(seconds);
    });
    return btn;
  };
  const makePosHandle = (): HTMLDivElement => {
    const handle = document.createElement('div');
    handle.className = 'pos-handle';
    handle.textContent = '⠿';
    handle.title = 'ドラッグで字幕を上下に移動';
    // pointerdown の処理は「字幕位置のドラッグ」の節で登録する。
    handle.addEventListener('pointerdown', (e) => startPosDrag(e));
    return handle;
  };
  // 再生/一時停止のトグルボタン。CSS でこのボタンの中心を画面中央に合わせる。
  // アイコンは setPlaying で動画の状態に合わせる（初期は再生中＝一時停止アイコン）。
  const playToggle = document.createElement('button');
  playToggle.className = 'rewind-btn play-toggle';
  let playing: boolean | null = null;
  const setPlaying = (next: boolean): void => {
    if (playing === next) return;
    playing = next;
    const label = next ? '一時停止' : '再生';
    playToggle.title = label;
    playToggle.setAttribute('aria-label', label);
    playToggle.replaceChildren(next ? createPauseIcon() : createPlayIcon());
  };
  setPlaying(true);
  // 巻き戻しボタンと同じく、クリックでフォーカスを取らない（Space で再度押されないため）。
  playToggle.addEventListener('mousedown', (e) => e.preventDefault());
  playToggle.addEventListener('click', () => {
    // 開いている単語ポップアップは閉じる（閉じるときに再生を再開しない）。
    hidePopup(false);
    callbacks.onTogglePlay?.();
  });
  // 右側のつまみと同じものをバーの右端に置く（早送り・字幕リスト開閉ボタンのさらに右）。
  // バーは --sub-bottom で字幕に付いて動くので、ドラッグ中もつまみがカーソルに追従する。
  const barHandle = makePosHandle();
  barHandle.classList.add('bar-handle');
  // 字幕リストの開閉ボタン。字幕リストが有効なとき（onToggleTranscript 指定時）だけ、
  // 早送りボタンとつまみの間に置く。点灯は setTranscriptOpen で字幕リストに合わせる。
  let listToggle: HTMLButtonElement | null = null;
  const setTranscriptOpen = (open: boolean): void => {
    if (!listToggle) return;
    const label = open ? '字幕リストを閉じる' : '字幕リストを開く';
    listToggle.classList.toggle('open', open);
    listToggle.setAttribute('aria-pressed', String(open));
    listToggle.title = label;
    listToggle.setAttribute('aria-label', label);
  };
  if (callbacks.onToggleTranscript) {
    const onToggleTranscript = callbacks.onToggleTranscript;
    listToggle = document.createElement('button');
    listToggle.className = 'rewind-btn list-toggle';
    listToggle.appendChild(createListIcon());
    // 他のボタンと同じく、クリックでフォーカスを取らない（Space で再度押されないため）。
    listToggle.addEventListener('mousedown', (e) => e.preventDefault());
    listToggle.addEventListener('click', () => {
      // 開いている単語ポップアップは閉じる（閉じるときに再生を再開しない）。
      hidePopup(false);
      onToggleTranscript();
    });
    setTranscriptOpen(false);
    rewindBar.classList.add('has-list');
  }
  // 再生/一時停止ボタンを挟んで、短い秒数ほど内側（中央寄り）に置く。
  rewindBar.append(
    makeSkipBtn(10, 'back'),
    makeSkipBtn(5, 'back'),
    playToggle,
    makeSkipBtn(5, 'forward'),
    makeSkipBtn(10, 'forward'),
    ...(listToggle ? [listToggle] : []),
    barHandle,
  );

  let bottomPercent = options.bottomPercent;
  const applyBottom = (): void => {
    subtitle.style.bottom = `${bottomPercent}%`;
    rewindBar.style.setProperty('--sub-bottom', `${bottomPercent}%`);
  };
  const STEP = 6;
  const MIN = 2;
  const MAX = 85;
  const clampBottom = (percent: number): number => Math.max(MIN, Math.min(MAX, percent));
  const move = (delta: number): void => {
    bottomPercent = clampBottom(bottomPercent + delta);
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
  // ドラッグで上下に動かすつまみ。
  const posHandle = makePosHandle();
  posControls.append(upBtn, posHandle, downBtn);
  subtitle.appendChild(posControls);
  applyBottom();

  shadow.appendChild(subtitle);
  shadow.appendChild(rewindBar);

  // ネイティブ字幕を隠す（テキストは DOM に残るので読み取りは可能）。
  const hideStyle = document.createElement('style');
  hideStyle.textContent = `${(youtube ? YOUTUBE_CAPTION_SELECTORS : CAPTION_TEXT_SELECTORS).join(', ')} { visibility: hidden !important; }`;
  if (youtube) {
    // 実画面で確認した Language Reactor 専用 UI のみを隠す。標準字幕の DOM は残す。
    // ホストがある間だけ適用するため、動画ページ離脱・destroy 時は元の表示へ戻る。
    const languageReactorUi = [
      '#lln-bottom-panel', '#lln-extension-controls', '.lln-toggle-vertical-view',
      '.lln-yt-mini-playback-bar', '.lln-vertical-view', '.lln-vv-toggle-in-sidebar',
      '#lln-vv-translations', '#lln-vv-image',
    ];
    hideStyle.textContent += `\n${languageReactorUi.map(selector =>
      `body:has(#movie_player #useful-subtitle-overlay) ${selector}`,
    ).join(',\n')} { display: none !important; }`;
  }

  let popup: HTMLDivElement | null = null;
  let popupGeneration = 0;
  let popupBody: HTMLDivElement | null = null;
  let popupIpa: HTMLSpanElement | null = null;
  let popupSenses: HTMLDivElement | null = null;
  let popupSentence: HTMLDivElement | null = null;
  let popupAnchor: DOMRect | null = null;
  let popupSelection = '';
  let popupAudioUrl: string | null = null;
  /** 開いているポップアップがこれまでに取った最大の高さ（px）。内容が縮んでもこの高さを保つ。 */
  let popupLockedHeight = 0;
  let currentSentence = '';
  // 現在表示中の字幕が現れた瞬間の動画位置（秒）。▶クリックでこの値にシークする。
  let currentLineVideoTime = 0;
  let wordRefs: WordRef[] = [];
  let dragStart = -1;
  let dragEnd = -1;
  let dragging = false;
  // 字幕枠の中にカーソルがあるか（字幕ホバーで一時停止用）。
  let inSubtitle = false;

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
    // ドラッグ中に字幕枠を出ていて、ポップアップも開かなかったらここでホバー終了を通知する。
    if (!inSubtitle && !popup) callbacks.onHoverEnd?.({ resume: true });
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
    // 外側クリックで閉じた場合は再生の再開をユーザーに委ねる（Prime は動画クリックで
    // 再生/停止が切り替わるので、こちらでも再開すると二重に切り替わる）。
    if (popup && e.target !== host) hidePopup(false);
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') hidePopup();
  };

  function renderLine(sentence: string, tokens: Token[], videoTime: number): void {
    subtitle.hidden = false;
    // 字幕の合間にも押せるよう、字幕オフまで表示を保つ。
    rewindBar.hidden = false;
    currentSentence = sentence;
    currentLineVideoTime = videoTime;
    // 次の字幕で閉じても再開はしない（ホバー停止中に字幕が描き直された場合に
    // 勝手に再生が始まらないようにするため）。
    hidePopup(false);
    original.replaceChildren();
    wordRefs = [];

    // 字幕の頭から再生する▶ボタン。.original の左外に絶対配置で並ぶ（テキスト中央を崩さない）。
    const replayBtn = document.createElement('button');
    replayBtn.className = 'replay-btn';
    replayBtn.textContent = '▶';
    replayBtn.title = '字幕の頭から再生';
    replayBtn.addEventListener('click', () => {
      // 開いている単語ポップアップは閉じる（×を押さなくても消えるように）。
      // 再開は▶側の再生に任せる。
      hidePopup(false);
      callbacks.onSeek(currentLineVideoTime);
    });
    original.appendChild(replayBtn);

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

  function clearLine(hideControls = false): void {
    subtitle.hidden = true;
    if (hideControls) rewindBar.hidden = true;
    // 隠した字幕の上にはカーソルが居られない。ただし再開はしない
    // （停止中に字幕が消えた場合に再生と停止を繰り返さないため）。
    // ポップアップが無ければここで resume:false を送り、停止の記録だけを消させる
    // （ポップアップがあれば下の hidePopup(false) が同じ通知を送る）。
    if (inSubtitle && !popup) callbacks.onHoverEnd?.({ resume: false });
    inSubtitle = false;
    // ドラッグ状態も解除する。残すと、枠外へはみ出したドラッグ中に字幕が消えた後の
    // mouseup が resume:true を送り、「clearLine では再開しない」が崩れる。
    dragging = false;
    original.replaceChildren();
    wordRefs = [];
    currentLineVideoTime = 0;
    setTranslation({ kind: 'none' });
    hidePopup(false);
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
    if (youtube) popup.style.position = 'absolute';
    shadow.appendChild(popup);
    return popup;
  };

  // 字幕を避けて置くとき、これより低くしか取れないなら避けるのをあきらめる（読めないほど小さくしない）。
  const MIN_AVOID_POPUP_HEIGHT = 120;
  const constrainPopupHeight = (maxHeight: number | null): void => {
    if (!popup) return;
    if (maxHeight === null) {
      popup.style.boxSizing = '';
      popup.style.maxHeight = '';
      popup.style.overflowY = '';
      return;
    }
    popup.style.boxSizing = 'border-box';
    popup.style.maxHeight = `${Math.max(0, maxHeight)}px`;
    popup.style.overflowY = 'auto';
  };

  /**
   * ポップアップを字幕に被らない位置へ置く。避ける範囲は、クリックした語と字幕枠全体
   * （複数行の字幕・下の和訳行を含む）。字幕の上 → 入らなければ下 → どちらにも入らなければ
   * 広い側に高さを詰めて（中はスクロール）置く。それも狭すぎるときだけ従来どおり画面内に収める。
   */
  const positionPopup = (anchor: DOMRect): void => {
    if (!popup) return;
    const margin = 8;
    const bounds = youtube ? host.getBoundingClientRect() : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    const fullHeight = bounds.height - margin * 2;
    // 内容が更新されるたびに呼ばれるので、まず本来の高さを測れる状態に戻す。
    popup.style.minHeight = '';
    constrainPopupHeight(youtube ? fullHeight : null);
    const pw = popup.offsetWidth;
    const natural = popup.offsetHeight;
    // 開いている間は背を縮めない。字幕の上に置くと下端がそろうので、背が縮むと単語・発音記号が
    // 下へずれる。読み込み中のスケルトンで見込んだ高さを保ったまま結果に差し替える。
    popupLockedHeight = Math.max(popupLockedHeight, natural);
    const locked = youtube ? Math.min(popupLockedHeight, fullHeight) : popupLockedHeight;
    if (locked > natural) popup.style.minHeight = `${locked}px`;
    let ph = Math.max(natural, locked);
    let left = anchor.left - bounds.left + anchor.width / 2 - pw / 2;
    left = Math.max(margin, Math.min(left, bounds.width - pw - margin));

    const sub = subtitle.hidden ? null : subtitle.getBoundingClientRect();
    const hasSub = sub !== null && sub.height > 0;
    const avoidTop = (hasSub ? Math.min(anchor.top, sub.top) : anchor.top) - bounds.top;
    const avoidBottom = (hasSub ? Math.max(anchor.bottom, sub.bottom) : anchor.bottom) - bounds.top;
    const spaceAbove = avoidTop - margin * 2;
    const spaceBelow = bounds.height - avoidBottom - margin * 2;

    let top: number;
    if (ph <= spaceAbove) {
      top = avoidTop - margin - ph;
    } else if (ph <= spaceBelow) {
      top = avoidBottom + margin;
    } else if (Math.max(spaceAbove, spaceBelow) >= MIN_AVOID_POPUP_HEIGHT) {
      const above = spaceAbove >= spaceBelow;
      popup.style.minHeight = ''; // min-height は max-height より優先されるので、詰めるときは外す。
      constrainPopupHeight(above ? spaceAbove : spaceBelow);
      ph = popup.offsetHeight;
      top = above ? avoidTop - margin - ph : avoidBottom + margin;
    } else {
      // 字幕の上下どちらにも十分な余白が無い（小さいプレーヤー等）。被っても画面内に収める。
      top = anchor.top - bounds.top - ph - margin;
      if (top < margin) top = anchor.bottom - bounds.top + margin;
    }
    top = Math.max(margin, Math.min(top, bounds.height - ph - margin));
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  };

  /**
   * 読み込み中のスケルトン（文字 1 行ぶんの高さのバーを count 本）。AI の結果が入る場所に、
   * 結果とほぼ同じ高さで先に置いておき、結果が届いてもポップアップの大きさ・要素の位置が変わらないようにする。
   */
  const createSkeleton = (count: number): HTMLDivElement => {
    const wrap = document.createElement('div');
    wrap.className = 'skeleton';
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-label', 'Thinking…');
    for (let i = 0; i < count; i++) {
      const line = document.createElement('div');
      line.className = 'skel-line';
      wrap.appendChild(line);
    }
    return wrap;
  };
  // 結果の典型的な行数（プロンプトの指定：品詞は 1〜3 行＋それぞれ英語の定義 1 行、説明は 2〜4 文、一文の訳は 1 文）に合わせた見込み。
  const SKELETON_SENSE_ROWS = 4;
  const SKELETON_BODY_LINES = 4;
  const SKELETON_SENTENCE_TRANS_LINES = 2;
  const SKELETON_SENTENCE_EXPL_LINES = 4;

  // ヘッダ（×・選択語・IPA・操作列）は安定して残り、AI の結果が入る場所はスケルトン→結果/エラーへ差し替える。
  function openPopup(anchor: DOMRect, selection: string): number {
    popupGeneration++;
    const p = ensurePopup();
    p.replaceChildren();
    popupLockedHeight = 0;
    popupAnchor = anchor;
    popupSelection = selection;
    popupAudioUrl = null;

    const close = document.createElement('div');
    close.className = 'close';
    close.textContent = '×';
    close.addEventListener('click', () => hidePopup());
    p.appendChild(close);

    const sel = document.createElement('div');
    sel.className = 'sel';
    const selWord = document.createElement('span');
    selWord.className = 'sel-word';
    selWord.textContent = selection;
    sel.appendChild(selWord);
    p.appendChild(sel);

    // 単語の下に「品詞ごとの訳」グリッド（AI 応答が来たら setPopupMeaning で埋める。それまではスケルトン）。
    popupSenses = document.createElement('div');
    popupSenses.className = 'senses';
    popupSenses.appendChild(createSkeleton(SKELETON_SENSE_ROWS));
    p.appendChild(popupSenses);

    // 🔊 と IPA を 1 行に並べる（🔊 は常時、IPA は取得後のみ表示）。
    const pronounce = document.createElement('div');
    pronounce.className = 'pronounce';

    const audioBtn = createSpeakerButton('audio-btn');
    audioBtn.addEventListener('click', () => callbacks.onPlayAudio(popupSelection, popupAudioUrl));
    pronounce.appendChild(audioBtn);

    popupIpa = document.createElement('span');
    popupIpa.className = 'ipa';
    popupIpa.style.display = 'none';
    pronounce.appendChild(popupIpa);

    p.appendChild(pronounce);

    const actions = document.createElement('div');
    actions.className = 'actions';

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
    popupBody.appendChild(createSkeleton(SKELETON_BODY_LINES));
    p.appendChild(popupBody);

    // 下段＝いま表示中の字幕一文の和訳＋解説。setPopupSentence が呼ばれるまで隠す。
    popupSentence = document.createElement('div');
    popupSentence.className = 'sentence';
    popupSentence.hidden = true;
    p.appendChild(popupSentence);

    positionPopup(anchor);
    return popupGeneration;
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
          if (s.definition) {
            const def = document.createElement('span');
            def.className = 'sense-def';
            def.lang = 'en';
            def.textContent = s.definition;
            popupSenses.appendChild(def);
          }
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
    // 品詞の訳は届かないので、読み込み中のスケルトンを消す（高さは popupLockedHeight で保たれる）。
    if (popupSenses) {
      popupSenses.replaceChildren();
      popupSenses.style.display = 'none';
    }
    if (popupAnchor) positionPopup(popupAnchor);
  }

  function setPopupWordInfo(ipa: string | null, audioUrl: string | null): void {
    popupAudioUrl = audioUrl;
    if (!popupIpa) return;
    const display = ipa ? formatIpaForDisplay(ipa) : '';
    if (display) {
      popupIpa.textContent = display;
      popupIpa.style.display = '';
    } else {
      popupIpa.textContent = '';
      popupIpa.style.display = 'none';
    }
    if (popupAnchor) positionPopup(popupAnchor);
  }

  function setPopupSentence(meaning: PopupSentenceMeaning): void {
    if (!popupSentence) return;
    const sec = popupSentence;
    sec.replaceChildren();
    sec.hidden = false;
    if (meaning === null) {
      // 結果と同じ並び（ラベル「和訳」→訳→解説）でスケルトンを置き、届いても高さが変わらないようにする。
      const label = document.createElement('div');
      label.className = 's-label';
      label.textContent = '和訳';
      const trans = document.createElement('div');
      trans.className = 's-trans';
      trans.appendChild(createSkeleton(SKELETON_SENTENCE_TRANS_LINES));
      const expl = document.createElement('div');
      expl.className = 's-expl';
      expl.appendChild(createSkeleton(SKELETON_SENTENCE_EXPL_LINES));
      sec.append(label, trans, expl);
    } else if (!meaning.ok) {
      const err = document.createElement('div');
      err.className = 'body err';
      err.textContent = meaning.error;
      sec.appendChild(err);
    } else {
      if (meaning.translation) {
        const label = document.createElement('div');
        label.className = 's-label';
        label.textContent = '和訳';
        const trans = document.createElement('div');
        trans.className = 's-trans';
        trans.textContent = meaning.translation;
        sec.append(label, trans);
      }
      if (meaning.explanation) {
        const expl = document.createElement('div');
        expl.className = 's-expl';
        expl.textContent = meaning.explanation;
        sec.appendChild(expl);
      }
      if (!sec.hasChildNodes()) sec.hidden = true;
    }
    if (popupAnchor) positionPopup(popupAnchor);
  }

  /**
   * ポップアップを閉じる。実際に閉じた場合、カーソルが字幕枠の外ならホバー終了を通知する
   * （ポップアップが開いている間はホバー継続とみなしているため）。
   */
  function hidePopup(resume = true): void {
    popupGeneration++;
    const wasOpen = popup !== null;
    if (popup) {
      popup.remove();
      popup = null;
    }
    popupBody = null;
    popupIpa = null;
    popupSenses = null;
    popupSentence = null;
    popupAnchor = null;
    popupAudioUrl = null;
    popupLockedHeight = 0;
    clearHighlight();
    if (wasOpen && !inSubtitle) callbacks.onHoverEnd?.({ resume });
  }

  // --- 字幕ホバー（一時停止用）---
  // ポップアップは字幕枠の外に出るので、開いている間はホバー継続とみなす。
  subtitle.addEventListener('mouseenter', () => {
    inSubtitle = true;
    callbacks.onHoverStart?.();
  });
  subtitle.addEventListener('mouseleave', () => {
    // clearLine で隠した後にも Chrome は遅れて mouseleave を送ってくる。既に枠外扱いなら無視する。
    if (!inSubtitle) return;
    inSubtitle = false;
    // フレーズのドラッグ中・つまみのドラッグ中に枠外へ出ても通知しない
    // （ドラッグを終えた onMouseUp / onPosDragEnd で判断する）。
    if (dragging || posDrag) return;
    if (!popup) callbacks.onHoverEnd?.({ resume: true });
  });

  // --- 字幕位置のドラッグ（つまみ）---
  // move/up/cancel はドラッグ中だけ document で受ける。要素の pointer capture を使うと、
  // 再生中のセリフの合間に clearLine で字幕が隠れたときにキャプチャが外れてドラッグが途切れる。
  // 単語のフレーズ選択（dragging）とは別の状態として持つ。
  let posDrag: { pointerId: number; startY: number; startBottom: number } | null = null;

  const onPosDragMove = (e: PointerEvent): void => {
    if (!posDrag || e.pointerId !== posDrag.pointerId) return;
    // ボタンが離されているのに move が来た＝pointerup を取りこぼした。ここでドラッグを終える。
    if (e.buttons === 0) {
      onPosDragEnd(e);
      return;
    }
    const height = host.getBoundingClientRect().height;
    if (height <= 0) return;
    const dy = e.clientY - posDrag.startY;
    bottomPercent = clampBottom(posDrag.startBottom - (dy / height) * 100);
    applyBottom();
  };

  const stopPosDrag = (): void => {
    document.removeEventListener('pointermove', onPosDragMove, true);
    document.removeEventListener('pointerup', onPosDragEnd, true);
    document.removeEventListener('pointercancel', onPosDragEnd, true);
    posDrag = null;
  };

  // pointercancel でも「見えている位置」をそのまま保存する。
  const onPosDragEnd = (e: PointerEvent): void => {
    if (!posDrag || e.pointerId !== posDrag.pointerId) return;
    const changed = bottomPercent !== posDrag.startBottom;
    stopPosDrag();
    if (changed) options.onBottomChange(bottomPercent);
    // 単語のドラッグと違い、つまみのドラッグは clearLine 後も続くので、離した時点で字幕が
    // カーソルの外にあることがある。そのときはここでホバー終了を 1 回通知する。
    // ドラッグ中に clearLine があった場合は、clearLine が既に一時停止の記録を消している
    // （resume:false）ので、この通知は hoverPause 側では何もしない。
    if (!inSubtitle && !popup) callbacks.onHoverEnd?.({ resume: true });
  };

  // 右側のつまみ・巻き戻しバー中央のつまみの両方から呼ばれる。
  function startPosDrag(e: PointerEvent): void {
    if (e.button !== 0 || posDrag) return;
    // pointerdown 由来の再生/停止の切り替えや文字選択を起こさない。
    e.preventDefault();
    e.stopPropagation();
    // 字幕だけ動いてポップアップが取り残されないよう閉じる。右側のつまみは字幕枠の中なので
    // inSubtitle は true のままで、ホバー終了は通知されない。バー中央のつまみは枠外なので
    // ここと onPosDragEnd でホバー終了が通知されうるが、ホバー停止中でなければ hoverPause 側は何もしない。
    hidePopup(false);
    posDrag = { pointerId: e.pointerId, startY: e.clientY, startBottom: bottomPercent };
    document.addEventListener('pointermove', onPosDragMove, true);
    document.addEventListener('pointerup', onPosDragEnd, true);
    document.addEventListener('pointercancel', onPosDragEnd, true);
  }

  // --- マウント & 全画面追従 ---
  const attach = (): void => {
    const target = youtube ? youtubePlayer() : document.fullscreenElement ?? document.body;
    if (!target) {
      hidePopup(false);
      host.remove();
      hideStyle.remove();
      return;
    }
    if (host.parentElement !== target) {
      target.appendChild(host);
      hidePopup(false);
    }
    if (!hideStyle.isConnected) document.head.appendChild(hideStyle);
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
    hidePopup(false);
    stopPosDrag();
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
    isPopupCurrent: (token) => popup !== null && token === popupGeneration,
    setPopupMeaning,
    setPopupError,
    setPopupWordInfo,
    setPopupSentence,
    hidePopup: () => hidePopup(),
    setPlaying,
    setTranscriptOpen,
    syncMount: attach,
    destroy,
  };
}
