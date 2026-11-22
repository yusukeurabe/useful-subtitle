import { tokenizeLine } from '../shared/tokenize';
import type { WordSense } from '../shared/explanation';
import { formatIpaForDisplay } from '../shared/dictionary';
import { createCloseIcon, createSpeakerButton, createTrashIcon } from './icons';
import { isYouTube } from './site';

export interface TranscriptEntry {
  /** 行を一意に識別する連番（翻訳の後追い更新に使う）。 */
  id: number;
  /** 整形済み（truecase 適用後）の英文。 */
  english: string;
  /** この字幕が出た瞬間の動画再生位置（秒）。クリックで巻き戻す先。 */
  videoTime: number;
}

/** ホバーで取得する文の意味（成功＝和訳＋解説／失敗＝メッセージ）。 */
export type TranscriptMeaning =
  | { ok: true; translation: string; explanation: string }
  | { ok: false; error: string };

/** ホバーで取得する単語の発音情報（IPA＋音源URL。どちらも無ければ null）。 */
export interface TranscriptWordInfo {
  ipa: string | null;
  audioUrl: string | null;
}

/** ホバーで取得する単語の意味（成功＝品詞別訳＋解説／失敗＝メッセージ）。 */
export type TranscriptWordMeaning =
  | { ok: true; senses: WordSense[]; explanation: string }
  | { ok: false; error: string };

export interface TranscriptPanelCallbacks {
  /** 行クリックでその場面へシークする。 */
  onSeek: (videoTime: number) => void;
  /** 単語クリック時の処理。指定時は行のシークより優先する（未指定なら行クリックと同じくシーク）。 */
  onWordClick?: () => void;
  /** 単語にホバーしたとき、その単語の意味（品詞別訳＋解説）を取得する。ポップアップ上段に出す。 */
  onExplainWord?: (word: string, sentence: string) => Promise<TranscriptWordMeaning>;
  /** 単語にホバーしたとき、その単語を含む字幕一文の意味（和訳＋解説）を取得する。ポップアップ下段に出す。 */
  onExplain?: (sentence: string) => Promise<TranscriptMeaning>;
  /** 単語にホバーしたとき、その単語の発音情報（IPA＋音源URL）を取得する。単語の横に IPA を出す。 */
  onLookupWordInfo?: (word: string) => Promise<TranscriptWordInfo>;
  /** 指定時は単語の横に 🔊 を出し、押すと発音を再生する。audioUrl は取得済みの音源（未取得なら null）。 */
  onPlayAudio?: (word: string, audioUrl: string | null) => void;
  /** ヘッダーの消去ボタンクリックで履歴を全消去する（未指定ならボタンを出さない）。 */
  onClearHistory?: () => void;
  /** 履歴パネルにカーソルが入った（一時停止用。字幕ホバーと同じ通知）。 */
  onHoverStart?: () => void;
  /**
   * 履歴パネルのホバーが終わった（パネルからも単語ポップアップからも外れた）。
   * resume=false は履歴の全消去でポップアップを閉じたときで、再開はしない。
   */
  onHoverEnd?: (opts: { resume: boolean }) => void;
  /** パネルが開いた／閉じたとき（Close・☰・toggleOpen のどれでも）。字幕下の開閉ボタンの点灯用。 */
  onOpenChange?: (open: boolean) => void;
}

export interface TranscriptPanel {
  setVisible(visible: boolean): void;
  /** パネルを開閉する（開いていれば閉じ、閉じていれば開く）。setVisible（ページ単位の出し入れ）とは別。 */
  toggleOpen(): void;
  /** 同じ ID は英文を更新し、行の位置と開始時刻を維持する。 */
  append(entry: TranscriptEntry): void;
  setTranslation(id: number, japanese: string, expectedEnglish?: string): void;
  /** 動画の現在再生位置（秒）から、いま再生中の行を判定して .active を付け替える。 */
  updateActiveByTime(currentTime: number): void;
  /** 履歴を全消去する（別作品・別エピソードへ切り替えたときに呼ぶ）。 */
  clear(): void;
  destroy(): void;
}

/**
 * 追従スクロールを続けるかどうかを決める純粋関数。
 * - プログラム由来のスクロール（こちらが scrollIntoView した結果）は無視し、状態を保つ。
 * - 手動スクロール時は、アクティブ行が可視範囲にある／最下部付近にあるときだけ追従を再開する。
 */
export function nextFollowState(opts: {
  wasFollowing: boolean;
  isProgrammatic: boolean;
  activeRowVisible: boolean;
  nearBottom: boolean;
}): boolean {
  if (opts.isProgrammatic) return opts.wasFollowing;
  return opts.activeRowVisible || opts.nearBottom;
}

export interface ReopenPosition {
  left: number;
  top: number;
}

const REOPEN_SIZE = 28;
const REOPEN_MARGIN = 4;
const DRAG_THRESHOLD_PX = 4;
const REOPEN_POSITION_KEY = 'transcriptReopenPosition';

/** 再表示ボタンの左上座標を、ボタン全体が画面内（余白つき）に収まるよう丸める純粋関数。 */
export function clampReopenPosition(
  pos: ReopenPosition,
  box: { width: number; height: number; viewportWidth: number; viewportHeight: number },
): ReopenPosition {
  const maxLeft = Math.max(REOPEN_MARGIN, box.viewportWidth - box.width - REOPEN_MARGIN);
  const maxTop = Math.max(REOPEN_MARGIN, box.viewportHeight - box.height - REOPEN_MARGIN);
  return {
    left: Math.round(Math.min(Math.max(pos.left, REOPEN_MARGIN), maxLeft)),
    top: Math.round(Math.min(Math.max(pos.top, REOPEN_MARGIN), maxTop)),
  };
}

async function loadReopenPosition(): Promise<ReopenPosition | null> {
  try {
    const stored = await chrome.storage.local.get(REOPEN_POSITION_KEY);
    const pos = stored[REOPEN_POSITION_KEY] as Partial<ReopenPosition> | undefined;
    if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
      return { left: pos.left as number, top: pos.top as number };
    }
  } catch {
    // 拡張の再読み込み直後などで storage が使えなくても、既定位置で動かす。
  }
  return null;
}

function saveReopenPosition(pos: ReopenPosition): void {
  try {
    void chrome.storage.local.set({ [REOPEN_POSITION_KEY]: pos }).catch(() => {});
  } catch {
    // 保存できなくてもこのページ内では動かした位置のまま使える。
  }
}

const STYLES = `
.host {
  position: fixed; top: var(--us-top-offset, 0px); right: 0; width: 320px;
  height: calc(100% - var(--us-top-offset, 0px));
  z-index: 2147483000; pointer-events: auto;
  font-family: -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
}
.panel {
  display: flex; flex-direction: column; height: 100%;
  background: rgba(20, 20, 20, 0.82); color: #f3f3f3;
  backdrop-filter: blur(2px);
}
.header {
  flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; font-size: 13px; font-weight: 700; border-bottom: 1px solid #444;
}
.header .actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.header .actions button {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 5px 8px; border: 1px solid #555; border-radius: 5px;
  background: #292929; color: #eee; cursor: pointer;
  font: inherit; font-size: 12px; font-weight: 500; line-height: 1.2;
}
.header .actions button:hover { background: #3a3a3a; color: #fff; }
.header .actions button:focus-visible { outline: 2px solid #8ab4ff; outline-offset: 2px; }
.list { flex: 1 1 auto; overflow-y: auto; padding: 6px 0; }
.row {
  padding: 8px 12px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.06);
}
.row:hover { background: rgba(86, 156, 255, 0.18); }
.row.active {
  background: rgba(86, 156, 255, 0.14);
  box-shadow: inset 4px 0 0 #569cff;
}
.row .en { font-size: 13px; line-height: 1.4; }
.row .ja { font-size: 12px; line-height: 1.4; color: #ffe08a; margin-top: 2px; }
.row .en .word { border-radius: 3px; padding: 0 1px; transition: background 0.1s; }
.row .en .word:hover { background: rgba(255, 255, 255, 0.22); }
/* ポップアップがいま説明している単語。カーソルを外しても、どの単語の解説かが分かるよう残す。 */
.row .en .word.popup-target,
.row .en .word.popup-target:hover {
  background: rgba(255, 224, 138, 0.32); color: #fff;
  box-shadow: inset 0 -2px 0 #ffe08a;
}
.reopen {
  position: fixed; top: calc(var(--us-top-offset, 0px) + 8px); right: 8px; z-index: 2147483000;
  width: 28px; height: 28px; padding: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(20,20,20,0.82); color: #fff; border: 1px solid #555;
  border-radius: 6px; font-size: 14px; line-height: 1; cursor: grab;
  pointer-events: auto; touch-action: none; user-select: none;
  font-family: -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
}
.reopen.dragging { cursor: grabbing; }
.hover-popup {
  position: fixed; max-width: 320px; min-width: 200px;
  background: #1e1e1e; color: #f3f3f3; border: 1px solid #444; border-radius: 10px;
  padding: 10px 12px; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
  font-size: 13px; line-height: 1.6; pointer-events: auto; z-index: 2147483001;
}
.hover-popup .hp-section { display: flex; flex-direction: column; }
.hover-popup .hp-section + .hp-section { margin-top: 8px; padding-top: 8px; border-top: 1px solid #3a3a3a; }
.hover-popup .hp-word-line { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap; }
.hover-popup .hp-word-head { font-size: 15px; font-weight: 700; color: #8ab4ff; }
.hover-popup .hp-audio-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; padding: 0; flex: none;
  border: 1px solid #2f3b52; border-radius: 50%; background: transparent;
  color: #8ab4ff; cursor: pointer; transition: background 0.15s, color 0.15s;
}
.hover-popup .hp-audio-btn:hover { background: rgba(86, 156, 255, 0.15); color: #b3cdff; }
.hover-popup .hp-audio-btn:active { background: rgba(86, 156, 255, 0.28); }
.hover-popup .hp-ipa { color: #b9c4d6; font-size: 13px; font-family: "SF Mono", Menlo, Consolas, monospace; }
.hover-popup .hp-label { font-size: 11px; color: #8ab4ff; font-weight: 700; margin-bottom: 2px; }
.hover-popup .hp-senses {
  display: grid; grid-template-columns: auto 1fr; column-gap: 10px; row-gap: 2px;
  margin: 0 0 4px;
}
.hover-popup .hp-pos {
  color: #b9c4d6; font-size: 12px; white-space: nowrap;
  font-family: "SF Mono", Menlo, Consolas, monospace;
}
.hover-popup .hp-gloss { color: #d8d8d8; font-size: 12px; }
.hover-popup .hp-def { grid-column: 2; color: #a9a9a9; font-size: 11px; line-height: 1.45; margin: -1px 0 3px; }
.hover-popup .hp-trans { color: #ffe08a; white-space: pre-wrap; margin-bottom: 4px; }
.hover-popup .hp-expl { white-space: pre-wrap; color: #cfcfcf; font-size: 12px; }
.hover-popup .hp-body { white-space: pre-wrap; }
.hover-popup .hp-body.loading { opacity: 0.7; }
.hover-popup .hp-body.err { color: #ff8a8a; }
/* 行の単語以外ホバーで英文の下に差し込む和訳＋解説（出したまま残す）。 */
.row .row-meaning { margin-top: 4px; }
.row .row-meaning .rm-trans { font-size: 12px; line-height: 1.4; color: #ffe08a; white-space: pre-wrap; }
/* 応答の後にデュアル字幕の和訳（.ja）が届いた行では、差し込んだ和訳を隠して重複させない。 */
.row .ja:not(:empty) ~ .row-meaning .rm-trans { display: none; }
.row .row-meaning .rm-expl { font-size: 11.5px; line-height: 1.45; color: #c8c8c8; white-space: pre-wrap; margin-top: 2px; }
.row .row-meaning .rm-body { font-size: 12px; line-height: 1.4; white-space: pre-wrap; }
.row .row-meaning .rm-body.loading { opacity: 0.7; }
.row .row-meaning .rm-body.err { color: #ff8a8a; }
`;

export function createTranscriptPanel(cb: TranscriptPanelCallbacks): TranscriptPanel {
  const host = document.createElement('div');
  host.id = 'useful-subtitle-transcript';
  // 外側ホストにも最前面の z-index を置く。これが無いと再生本編で Prime Video の
  // プレイヤー（全面・高 z-index）に重なられ、履歴パネルが裏へ隠れてしまう。
  host.style.cssText = 'position:fixed;inset:0 0 0 auto;pointer-events:none;z-index:2147483000;';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLES;
  shadow.appendChild(style);

  const panelHost = document.createElement('div');
  panelHost.className = 'host';
  const panel = document.createElement('div');
  panel.className = 'panel';
  // --- 履歴パネルのホバーで一時停止（字幕ホバーと同じ通知）---
  // 再生中は履歴が自動で流れて読みにくく、止まったカーソルの下を行が通り過ぎもするので、
  // パネルに乗せている間は止める。単語ポップアップはパネルの外（左側）に開くため、
  // 開いている間はパネルを出てもホバー継続とし、ポップアップが閉じた時点で終了を通知する。
  let inPanel = false;
  panel.addEventListener('mouseenter', () => {
    inPanel = true;
    cb.onHoverStart?.();
  });
  // パネルから外れた扱いにする。✕ や非表示でカーソルの下から消えたときは mouseleave が
  // 来ないことがあるので、隠す側からも呼んで一時停止が残らないようにする。
  const leavePanel = (): void => {
    if (!inPanel) return;
    inPanel = false;
    if (!hoverPopup) cb.onHoverEnd?.({ resume: true });
  };
  panel.addEventListener('mouseleave', leavePanel);
  const header = document.createElement('div');
  header.className = 'header';
  const title = document.createElement('span');
  title.textContent = 'Transcript History';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'x';
  closeButton.append(createCloseIcon(), document.createTextNode('Close'));
  closeButton.title = 'Close panel';
  // 履歴の削除とパネルを閉じる操作を、アイコン（ゴミ箱／バツ印）＋文字のボタンで区別する。
  const actions = document.createElement('span');
  actions.className = 'actions';
  if (cb.onClearHistory) {
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'clear';
    clearBtn.append(createTrashIcon(), document.createTextNode('Delete'));
    clearBtn.title = 'Delete all subtitle history';
    clearBtn.addEventListener('click', () => cb.onClearHistory?.());
    actions.append(clearBtn);
  }
  actions.append(closeButton);
  header.append(title, actions);
  const list = document.createElement('div');
  list.className = 'list';
  panel.append(header, list);
  panelHost.appendChild(panel);
  shadow.appendChild(panelHost);

  // 閉じている間の再表示ボタン。裏の要素を塞がないよう小さな正方形にし、
  // ドラッグで好きな位置へ動かせる（位置は chrome.storage に記憶する）。
  const reopen = document.createElement('button');
  reopen.type = 'button';
  reopen.className = 'reopen';
  reopen.textContent = '☰';
  reopen.title = 'Transcript を開く（ドラッグで移動）';
  reopen.setAttribute('aria-label', 'Open transcript');
  shadow.appendChild(reopen);
  // 動画を開いただけでは自動で開かず、再表示ボタン（☰）を押したときだけパネルを開く。
  panelHost.style.display = 'none';

  let open = false;
  const setVisible = (visible: boolean): void => {
    panelHost.style.display = visible ? '' : 'none';
    reopen.style.display = visible ? 'none' : '';
    if (!visible) leavePanel();
    syncTopOffset();
    if (!visible) clampReopen();
    if (open !== visible) {
      open = visible;
      cb.onOpenChange?.(visible);
    }
  };
  closeButton.addEventListener('click', () => setVisible(false));

  // 動かした位置（左上座標）。null なら既定の右上。
  let reopenPos: ReopenPosition | null = null;
  const applyReopenPos = (pos: ReopenPosition): void => {
    const size = reopen.getBoundingClientRect();
    const clamped = clampReopenPosition(pos, {
      width: size.width || REOPEN_SIZE,
      height: size.height || REOPEN_SIZE,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    reopenPos = clamped;
    reopen.style.left = `${clamped.left}px`;
    reopen.style.top = `${clamped.top}px`;
    reopen.style.right = 'auto';
  };
  // ウィンドウ縮小などで画面外へはみ出さないよう収め直す。
  const clampReopen = (): void => {
    if (reopenPos) applyReopenPos(reopenPos);
  };
  window.addEventListener('resize', clampReopen);
  void loadReopenPosition().then((pos) => {
    if (pos && !reopenPos) applyReopenPos(pos);
  });

  // 一定距離動いたらドラッグとみなし、離した直後のクリック（パネルを開く）は抑止する。
  let drag: { pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number; moved: boolean } | null = null;
  let suppressClick = false;
  reopen.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const rect = reopen.getBoundingClientRect();
    drag = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      moved: false,
    };
    reopen.setPointerCapture?.(e.pointerId);
  });
  reopen.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    reopen.classList.add('dragging');
    applyReopenPos({ left: e.clientX - drag.offsetX, top: e.clientY - drag.offsetY });
  });
  // pointercancel の後はクリックが来ないので、抑止フラグは pointerup のときだけ立てる。
  const endDrag = (e: PointerEvent, isClickNext: boolean): void => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.moved) {
      suppressClick = isClickNext;
      reopen.classList.remove('dragging');
      if (reopenPos) saveReopenPosition(reopenPos);
    }
    reopen.releasePointerCapture?.(e.pointerId);
    drag = null;
  };
  reopen.addEventListener('pointerup', (e) => endDrag(e, true));
  reopen.addEventListener('pointercancel', (e) => endDrag(e, false));
  reopen.addEventListener('click', () => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    setVisible(true);
  });

  const jaById = new Map<number, HTMLDivElement>();
  /**
   * 行の単語以外ホバーで差し込む和訳＋解説の状態。seq は古い応答を捨てるための世代番号。
   * retryArmed はエラー後の再要求の許可。行を一度出る（mouseleave）まで再要求しない。
   */
  interface RowMeaning {
    el: HTMLDivElement | null;
    state: 'loading' | 'done' | 'error' | null;
    seq: number;
    retryArmed: boolean;
  }
  type RowItem = { entry: TranscriptEntry; row: HTMLDivElement; en: HTMLDivElement; ja: HTMLDivElement; rm: RowMeaning };
  const entriesById = new Map<number, RowItem>();
  // 行と videoTime の対応を追加順に保持する（現在行判定に使う）。
  const rows: { videoTime: number; el: HTMLDivElement }[] = [];
  // いま .active が付いている行（無ければ null）。
  let activeRow: HTMLDivElement | null = null;
  // 再生時刻の読み取りと記録時刻のわずかなずれを吸収する許容誤差（秒）。
  const ACTIVE_EPSILON = 0.25;
  // 追従スクロールの状態。初期は追従ON。
  let following = true;
  // 直近で自前スクロールした後の scrollTop。scroll イベントがこの値なら自前由来とみなす。
  let lastAutoScrollTop = -1;

  // リスト最下部付近にいるか（8px の遊びを持たせる）。
  const isNearBottom = (): boolean =>
    list.scrollTop + list.clientHeight >= list.scrollHeight - 8;

  // アクティブ行がリストの可視範囲に重なっているか。
  const isActiveVisible = (): boolean => {
    if (!activeRow) return false;
    const r = activeRow.getBoundingClientRect();
    const c = list.getBoundingClientRect();
    return r.bottom > c.top && r.top < c.bottom;
  };

  // アクティブ行を可視範囲へスクロールし、自前スクロールとして記録する。
  const scrollActiveIntoView = (): void => {
    if (!activeRow) return;
    activeRow.scrollIntoView({ block: 'nearest' });
    lastAutoScrollTop = list.scrollTop;
  };

  // 手動スクロールを検知して追従可否を更新する。自前スクロールの「こだま」は無視する。
  list.addEventListener('scroll', () => {
    following = nextFollowState({
      wasFollowing: following,
      isProgrammatic: list.scrollTop === lastAutoScrollTop,
      activeRowVisible: isActiveVisible(),
      nearBottom: isNearBottom(),
    });
  });

  // --- ホバーで単語＋文の意味を 2 段で表示するポップアップ ---
  // 上段＝単語の意味（onExplainWord）、下段＝その単語を含む字幕一文の意味（onExplain）。
  const DWELL_MS = 500; // 何ms乗せ続けたら出すか（初回）
  // ポップアップ表示中に別単語へ切り替えるまでの待ち。ポップアップへカーソルを運ぶ途中で
  // 単語を「通過しただけ」で切り替わらないよう、この間その単語に留まったときだけ切り替える。
  const SWITCH_MS = 300;
  const CLOSE_GRACE_MS = 200; // 離れてから閉じるまでの猶予
  let hoverPopup: HTMLDivElement | null = null;
  let hoverRow: HTMLElement | null = null;
  // ポップアップが説明している単語の span（.popup-target でハイライトする）。
  let targetWord: HTMLElement | null = null;
  let dwellRow: HTMLDivElement | null = null;
  let dwellTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  // 応答の競合ガード。開く/閉じる/別単語へ移るたびに増やし、古い応答を破棄する。
  let hoverSeq = 0;

  const clearDwell = (): void => {
    dwellRow = null;
    if (dwellTimer) {
      clearTimeout(dwellTimer);
      dwellTimer = undefined;
    }
  };
  const clearClose = (): void => {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = undefined;
    }
  };
  const setTargetWord = (el: HTMLElement | null): void => {
    if (targetWord === el) return;
    targetWord?.classList.remove('popup-target');
    el?.classList.add('popup-target');
    targetWord = el;
  };
  const hideHoverPopup = (resume = true): void => {
    hoverRow = null;
    setTargetWord(null);
    clearDwell();
    clearClose();
    hoverSeq++; // 進行中の応答を無効化
    if (hoverPopup) {
      hoverPopup.remove();
      hoverPopup = null;
      // パネルの外で開いていたポップアップが閉じたら、そこでホバー終了（一時停止の解除）。
      if (!inPanel) cb.onHoverEnd?.({ resume });
    }
  };
  const scheduleClose = (): void => {
    clearClose();
    closeTimer = setTimeout(hideHoverPopup, CLOSE_GRACE_MS);
  };

  const positionHoverPopup = (anchor: HTMLElement): void => {
    if (!hoverPopup) return;
    const r = anchor.getBoundingClientRect();
    const margin = 8;
    const pw = hoverPopup.offsetWidth || 280;
    const ph = hoverPopup.offsetHeight || 0;
    // パネルは右端なのでカードは行の左側へ開く。入らなければ左端にクランプ。
    let left = r.left - pw - margin;
    if (left < margin) left = margin;
    const top = Math.max(margin, Math.min(r.top, window.innerHeight - ph - margin));
    hoverPopup.style.left = `${left}px`;
    hoverPopup.style.top = `${top}px`;
  };

  // 単語セクションの中身（senses + 解説）を描画。loading=null、エラー=string、成功=オブジェクト。
  const renderWordBody = (host: HTMLDivElement, res: TranscriptWordMeaning | null): void => {
    if (res === null) {
      const loading = document.createElement('div');
      loading.className = 'hp-body loading';
      loading.textContent = 'Thinking…';
      host.appendChild(loading);
      return;
    }
    if (!res.ok) {
      const err = document.createElement('div');
      err.className = 'hp-body err';
      err.textContent = res.error;
      host.appendChild(err);
      return;
    }
    if (res.senses.length > 0) {
      const senses = document.createElement('div');
      senses.className = 'hp-senses';
      for (const s of res.senses) {
        const pos = document.createElement('span');
        pos.className = 'hp-pos';
        pos.textContent = s.pos ?? '';
        const gloss = document.createElement('span');
        gloss.className = 'hp-gloss';
        gloss.textContent = s.gloss;
        senses.append(pos, gloss);
        if (s.definition) {
          const def = document.createElement('span');
          def.className = 'hp-def';
          def.lang = 'en';
          def.textContent = s.definition;
          senses.appendChild(def);
        }
      }
      host.appendChild(senses);
    }
    if (res.explanation) {
      const expl = document.createElement('div');
      expl.className = 'hp-expl';
      expl.textContent = res.explanation;
      host.appendChild(expl);
    }
  };

  // 文セクションの中身（和訳 + 解説）を描画。
  const renderSentenceBody = (host: HTMLDivElement, res: TranscriptMeaning | null): void => {
    if (res === null) {
      const loading = document.createElement('div');
      loading.className = 'hp-body loading';
      loading.textContent = 'Thinking…';
      host.appendChild(loading);
      return;
    }
    if (!res.ok) {
      const err = document.createElement('div');
      err.className = 'hp-body err';
      err.textContent = res.error;
      host.appendChild(err);
      return;
    }
    if (res.translation) {
      const label = document.createElement('div');
      label.className = 'hp-label';
      label.textContent = '和訳';
      const val = document.createElement('div');
      val.className = 'hp-trans';
      val.textContent = res.translation;
      host.append(label, val);
    }
    if (res.explanation) {
      const expl = document.createElement('div');
      expl.className = 'hp-expl';
      expl.textContent = res.explanation;
      host.appendChild(expl);
    }
  };

  /**
   * ホバー中の (word, sentence) ペアに対する 2 段ポップアップを描画する。
   * - 上段＝単語、下段＝文。どちらも null=ローディング、Object=結果。
   * - onExplainWord/onExplain が無いセクションは丸ごと省略する。
   */
  const renderHoverPopup = (
    word: string,
    wordRes: TranscriptWordMeaning | null,
    sentRes: TranscriptMeaning | null,
    info: TranscriptWordInfo | null,
  ): void => {
    if (!hoverPopup) return;
    hoverPopup.replaceChildren();

    if (cb.onExplainWord) {
      const sec = document.createElement('div');
      sec.className = 'hp-section';
      // 単語・🔊・IPA を 1 行に並べる（🔊 は常時、IPA は取得後のみ）。
      const line = document.createElement('div');
      line.className = 'hp-word-line';
      const head = document.createElement('div');
      head.className = 'hp-word-head';
      head.textContent = word;
      line.appendChild(head);
      if (cb.onPlayAudio) {
        const play = cb.onPlayAudio;
        const btn = createSpeakerButton('hp-audio-btn');
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          play(word, info?.audioUrl ?? null);
        });
        line.appendChild(btn);
      }
      const ipa = info?.ipa ? formatIpaForDisplay(info.ipa) : '';
      if (ipa) {
        const ipaEl = document.createElement('span');
        ipaEl.className = 'hp-ipa';
        ipaEl.textContent = ipa;
        line.appendChild(ipaEl);
      }
      sec.appendChild(line);
      renderWordBody(sec, wordRes);
      hoverPopup.appendChild(sec);
    }
    if (cb.onExplain) {
      const sec = document.createElement('div');
      sec.className = 'hp-section';
      renderSentenceBody(sec, sentRes);
      hoverPopup.appendChild(sec);
    }
  };

  // 同じ文の意味の取得中の要求。単語ポップアップと行の差し込み表示が同じ文を同時に
  // 求めても API へは1回だけ送る（background のキャッシュは完了後にしか効かないため）。
  // 決着（成功・失敗とも）したら外すので、以降の要求はキャッシュ側に任せる。
  const explainInFlight = new Map<string, Promise<TranscriptMeaning>>();
  const explainOnce = (sentence: string): Promise<TranscriptMeaning> => {
    let p = explainInFlight.get(sentence);
    if (!p) {
      p = cb.onExplain!(sentence);
      explainInFlight.set(sentence, p);
      // 片付け用の then は失敗も受けるので、共有の promise から未処理の reject は出ない。
      const forget = (): void => {
        explainInFlight.delete(sentence);
      };
      p.then(forget, forget);
    }
    return p;
  };

  /**
   * ホバーポップアップを開く（または現在のポップアップを別単語に差し替える）。
   * 単語の意味と文の意味を並行取得し、それぞれの応答が来た順に該当セクションを更新する。
   * 行を跨いで単語移動した場合は hoverSeq で旧応答を破棄する。
   */
  const openHoverPopup = (row: HTMLElement, wordEl: HTMLElement, word: string, sentence: string): void => {
    if (!cb.onExplainWord && !cb.onExplain) return;
    clearClose();
    hoverRow = row;
    setTargetWord(wordEl);
    const seq = ++hoverSeq;
    if (!hoverPopup) {
      hoverPopup = document.createElement('div');
      hoverPopup.className = 'hover-popup';
      // ポップアップに入れたら、閉じる予約も途中で通過した単語への切替予約も取り消す。
      hoverPopup.addEventListener('mouseenter', () => {
        clearClose();
        clearDwell();
      });
      hoverPopup.addEventListener('mouseleave', scheduleClose);
      shadow.appendChild(hoverPopup);
    }

    let wordRes: TranscriptWordMeaning | null = null;
    let sentRes: TranscriptMeaning | null = null;
    let info: TranscriptWordInfo | null = null;
    const rerender = (): void => {
      renderHoverPopup(word, wordRes, sentRes, info);
      positionHoverPopup(row);
    };
    rerender();

    if (cb.onLookupWordInfo) {
      void cb.onLookupWordInfo(word).then(
        (res) => {
          if (seq !== hoverSeq || !hoverPopup) return;
          info = res;
          rerender();
        },
        () => {},
      );
    }

    if (cb.onExplainWord) {
      void cb.onExplainWord(word, sentence).then((res) => {
        if (seq !== hoverSeq || !hoverPopup) return; // 別単語へ移った／閉じた
        wordRes = res;
        rerender();
      });
    }
    if (cb.onExplain) {
      void explainOnce(sentence).then((res) => {
        if (seq !== hoverSeq || !hoverPopup) return;
        sentRes = res;
        rerender();
      });
    }
  };

  const onHoverKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') hideHoverPopup();
  };

  // --- 行の「単語以外の場所」へのホバーで、和訳＋解説を英文の下に差し込む ---
  // 単語の上は従来どおり単語ポップアップ。ここでは行の余白・語間・短い行の右側の空きなど
  // 単語以外に ROW_DWELL_MS 留まったときだけ発火し、出した表示は行から離れても残す。
  const ROW_DWELL_MS = 1000; // 単語ポップアップ（500ms）より長く待ち、通りがかりで出ないようにする
  let rowDwellRow: HTMLDivElement | null = null;
  let rowDwellTimer: ReturnType<typeof setTimeout> | undefined;

  const clearRowDwell = (): void => {
    rowDwellRow = null;
    if (rowDwellTimer) {
      clearTimeout(rowDwellTimer);
      rowDwellTimer = undefined;
    }
  };

  /** 差し込み表示を取り除き、進行中の応答を無効化する（英文更新・全消去時）。 */
  const resetRowMeaning = (rm: RowMeaning): void => {
    rm.seq++;
    rm.el?.remove();
    rm.el = null;
    rm.state = null;
  };

  /** 差し込み表示の中身を描く。null=取得中、ok=false=エラー、ok=true=和訳＋解説。 */
  const renderRowMeaning = (item: RowItem, res: TranscriptMeaning | null): void => {
    const el = item.rm.el;
    if (!el) return;
    el.replaceChildren();
    if (res === null || !res.ok) {
      const body = document.createElement('div');
      body.className = res === null ? 'rm-body loading' : 'rm-body err';
      body.textContent = res === null ? 'Thinking…' : res.error;
      el.appendChild(body);
      return;
    }
    // デュアル字幕の和訳が既に行に出ていれば、和訳は重ねず解説だけを足す。
    if (res.translation && !item.ja.textContent) {
      const trans = document.createElement('div');
      trans.className = 'rm-trans';
      trans.textContent = res.translation;
      el.appendChild(trans);
    }
    if (res.explanation) {
      const expl = document.createElement('div');
      expl.className = 'rm-expl';
      expl.textContent = res.explanation;
      el.appendChild(expl);
    }
    // 描くものが無ければ空の枠を残さない（state は done のままなので再要求もしない）。
    if (!el.firstChild) {
      el.remove();
      item.rm.el = null;
    }
  };

  /** 行の英文の和訳＋解説を取得して差し込む。取得中・取得済みの行では何もしない。 */
  const openRowMeaning = (item: RowItem): void => {
    if (!cb.onExplain) return;
    const { rm } = item;
    if (rm.state === 'loading' || rm.state === 'done') return;
    rm.el?.remove(); // 前回のエラー表示を作り直す
    const el = document.createElement('div');
    el.className = 'row-meaning';
    item.row.appendChild(el);
    rm.el = el;
    rm.state = 'loading';
    // ドウェル発火時はカーソルが行の中にいる。エラーになっても、行を一度出るまでは
    // 再要求しない（エラーを読む間の小さな動きで AI 呼び出しが連発しないように）。
    rm.retryArmed = false;
    const seq = ++rm.seq;
    // 追従中の最下行が伸びたら、伸びた分も見えるよう最下部へ送る。
    const settle = (res: TranscriptMeaning | null): void => {
      renderRowMeaning(item, res);
      if (rows[rows.length - 1]?.el === item.row) followBottom();
    };
    settle(null);
    void explainOnce(item.entry.english).then(
      (res) => {
        if (seq !== rm.seq) return; // 英文更新・全消去で無効化済み
        rm.state = res.ok ? 'done' : 'error';
        settle(res);
      },
      () => {
        if (seq !== rm.seq) return;
        rm.state = 'error';
        settle({ ok: false, error: '和訳を取得できませんでした。' });
      },
    );
  };

  function append(entry: TranscriptEntry): void {
    const existing = entriesById.get(entry.id);
    if (existing) {
      if (existing.entry.english === entry.english) return;
      if (hoverRow === existing.row || dwellRow === existing.row) hideHoverPopup();
      // 英文が変わったので、差し込み済みの和訳＋解説と待機中の行ドウェルは古くなる。
      resetRowMeaning(existing.rm);
      if (rowDwellRow === existing.row) clearRowDwell();
      existing.entry.english = entry.english;
      renderWords(existing.entry, existing.row, existing.en);
      jaById.get(entry.id)!.textContent = '';
      followBottom();
      return;
    }
    entry = { ...entry };
    const row = document.createElement('div');
    row.className = 'row';
    row.addEventListener('click', () => cb.onSeek(entry.videoTime));
    // 行から完全に出たらドウェルをキャンセルしてポップアップを閉じる。隣の行の単語に
    // 移ったときは、その単語の mouseenter が先に clearClose して即時で差し替わる。
    // 行を出たらエラー後の再要求を許可する（戻ってきてマウスを動かせば取り直す）。
    row.addEventListener('mouseleave', () => {
      clearDwell();
      clearRowDwell();
      scheduleClose();
      const item = entriesById.get(entry.id);
      if (item) item.rm.retryArmed = true;
    });
    // 単語以外（語間・余白・行末の空き・和訳欄）でマウスを動かしたら行のドウェルを始める。
    // 単語に入ったら取り消す（単語の上は単語ポップアップの担当）。
    // mouseover ではなく mousemove を使うのは、再生中の自動スクロールで止まったカーソルの
    // 下を行が流れると、ブラウザがマウスを動かさなくても mouseover を出し、流れてきた行ごとに
    // ドウェルが始まって AI 呼び出しが連発するため。実際にマウスを動かしたときだけ発火させる。
    row.addEventListener('mousemove', (e) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('.word')) {
        if (rowDwellRow === row) clearRowDwell();
        return;
      }
      if (!cb.onExplain || rowDwellRow === row) return;
      // 取得中・取得済みの行、行を出ていないエラー行ではドウェル自体を始めない。
      const rm = entriesById.get(entry.id)?.rm;
      if (rm && (rm.state === 'loading' || rm.state === 'done' || (rm.state === 'error' && !rm.retryArmed))) return;
      clearRowDwell();
      rowDwellRow = row;
      rowDwellTimer = setTimeout(() => {
        rowDwellRow = null;
        rowDwellTimer = undefined;
        const item = entriesById.get(entry.id);
        if (item) openRowMeaning(item);
      }, ROW_DWELL_MS);
    });
    const en = document.createElement('div');
    en.className = 'en';
    const ja = document.createElement('div');
    ja.className = 'ja';

    entriesById.set(entry.id, { entry, row, en, ja, rm: { el: null, state: null, seq: 0, retryArmed: false } });
    renderWords(entry, row, en);

    row.append(en, ja);
    jaById.set(entry.id, ja);
    // 行は動画の時刻順に並べる。先へ飛ばした後に戻って見た字幕は、後から記録されても
    // 時刻どおりの位置（途中）へ入る。同じ時刻なら後から来た行を後ろに置く。
    const index = rows.findIndex((r) => r.videoTime > entry.videoTime);
    if (index === -1) {
      list.appendChild(row);
      rows.push({ videoTime: entry.videoTime, el: row });
      followBottom();
    } else {
      // 途中への挿入は最下部へ送らない（アクティブ行への追従は updateActiveByTime が行う）。
      list.insertBefore(row, rows[index].el);
      rows.splice(index, 0, { videoTime: entry.videoTime, el: row });
    }
  }

  function renderWords(entry: TranscriptEntry, row: HTMLDivElement, en: HTMLDivElement): void {
    en.replaceChildren();
    // 単語ごとに span を起こし、その単語のホバーで意味取得を発火する（Language Reactor 風）。
    // 初回は DWELL_MS、ポップアップ表示中の別単語への切替は SWITCH_MS だけ留まったら発火する。
    // 単語から出たら予約を取り消すので、カーソルが通過しただけの単語では切り替わらない。
    for (const tok of tokenizeLine(entry.english)) {
      if (!tok.isWord) {
        en.appendChild(document.createTextNode(tok.text));
        continue;
      }
      const wspan = document.createElement('span');
      wspan.className = 'word';
      wspan.textContent = tok.text;
      wspan.addEventListener('mouseenter', () => {
        // 表示中のポップアップは、切替先が決まるまで（または離れるまで）開いたままにする。
        clearClose();
        clearDwell();
        dwellRow = row;
        dwellTimer = setTimeout(
          () => openHoverPopup(row, wspan, tok.text, entry.english),
          hoverPopup ? SWITCH_MS : DWELL_MS,
        );
      });
      wspan.addEventListener('mouseleave', clearDwell);
      wspan.addEventListener('click', (e) => {
        if (!cb.onWordClick) return;
        // 行へ伝えると seekVideo が再生を再開してしまう。
        e.stopPropagation();
        cb.onWordClick();
      });
      en.appendChild(wspan);
    }
  }

  function followBottom(): void {
    // 追従中のときだけ最下部へ送る（履歴を遡って読んでいる間は勝手に飛ばさない）。
    if (following) {
      list.scrollTop = list.scrollHeight;
      lastAutoScrollTop = list.scrollTop;
    }
  }

  function setTranslation(id: number, japanese: string, expectedEnglish?: string): void {
    if (expectedEnglish !== undefined && entriesById.get(id)?.entry.english !== expectedEnglish) return;
    const ja = jaById.get(id);
    if (ja) ja.textContent = japanese;
  }

  function updateActiveByTime(currentTime: number): void {
    // 「videoTime <= currentTime（+許容誤差）を満たす行のうち videoTime 最大の行」を現在行とする。
    // タイが出たら後から追加された行（id が後）を優先する（>= で上書き）。
    let next: HTMLDivElement | null = null;
    let bestTime = -Infinity;
    for (const r of rows) {
      if (r.videoTime <= currentTime + ACTIVE_EPSILON && r.videoTime >= bestTime) {
        bestTime = r.videoTime;
        next = r.el;
      }
    }
    if (next === activeRow) return;
    activeRow?.classList.remove('active');
    next?.classList.add('active');
    activeRow = next;
    if (following) scrollActiveIntoView();
  }

  // 履歴を全消去する（別作品・別エピソードへの切り替え時に呼ぶ）。行・対応表・
  // アクティブ行・追従状態を初期化し、開いていればホバーカードも閉じる。
  function clear(): void {
    // 消える行を指したままのカードを残さない。作品の切り替え時なので一時停止は再開しない。
    hideHoverPopup(false);
    list.replaceChildren();
    rows.length = 0;
    jaById.clear();
    clearRowDwell();
    for (const item of entriesById.values()) resetRowMeaning(item.rm); // 遅れた応答を無効化
    entriesById.clear();
    activeRow = null;
    following = true; // 新しい作品は最下部へ追従させる
    lastAutoScrollTop = -1;
  }

  // --- マウント & 全画面追従 ---
  // Prime Video は全画面時に「全画面要素とその子孫」しか描画しないため、
  // body 直下のままだと履歴パネルが見えなくなる。overlay と同じく全画面要素の
  // 中へ入れ直し、全画面の出入りに追従する。
  const attach = (): void => {
    const target = document.fullscreenElement ?? document.body;
    if (host.parentElement !== target) target.appendChild(host);
    syncTopOffset();
  };
  // YouTube は画面上部に固定ヘッダー（検索・通知ボタン等）があるため、
  // パネルと☰ボタンをその下から始めて、ヘッダーのボタンを塞がないようにする。
  // 全画面ではヘッダーが消えるので上端から使う。
  const syncTopOffset = (): void => {
    const masthead = isYouTube() && !document.fullscreenElement
      ? document.querySelector('#masthead-container')
      : null;
    const bottom = masthead ? Math.round(masthead.getBoundingClientRect().bottom) : 0;
    host.style.setProperty('--us-top-offset', `${Math.max(0, bottom)}px`);
  };
  const onFullscreenChange = (): void => attach();

  function destroy(): void {
    document.removeEventListener('fullscreenchange', onFullscreenChange, true);
    document.removeEventListener('keydown', onHoverKeyDown, true);
    window.removeEventListener('resize', clampReopen);
    window.removeEventListener('resize', syncTopOffset);
    hideHoverPopup(false);
    host.remove();
    jaById.clear();
    clearRowDwell();
    for (const item of entriesById.values()) resetRowMeaning(item.rm); // 遅れた応答を無効化
    entriesById.clear();
  }

  document.addEventListener('fullscreenchange', onFullscreenChange, true);
  document.addEventListener('keydown', onHoverKeyDown, true);
  window.addEventListener('resize', syncTopOffset);
  attach();
  const setPageVisible = (visible: boolean): void => {
    host.style.display = visible ? '' : 'none';
  };
  return {
    append,
    setTranslation,
    updateActiveByTime,
    clear,
    setVisible: setPageVisible,
    toggleOpen: () => setVisible(!open),
    destroy,
  };
}
