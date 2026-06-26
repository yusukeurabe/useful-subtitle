import { tokenizeLine } from '../shared/tokenize';
import type { WordSense } from '../shared/explanation';

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

/** ホバーで取得する単語の意味（成功＝品詞別訳＋解説／失敗＝メッセージ）。 */
export type TranscriptWordMeaning =
  | { ok: true; senses: WordSense[]; explanation: string }
  | { ok: false; error: string };

export interface TranscriptPanelCallbacks {
  /** 行クリックでその場面へシークする。 */
  onSeek: (videoTime: number) => void;
  /** 単語にホバーしたとき、その単語の意味（品詞別訳＋解説）を取得する。ポップアップ上段に出す。 */
  onExplainWord?: (word: string, sentence: string) => Promise<TranscriptWordMeaning>;
  /** 単語にホバーしたとき、その単語を含む字幕一文の意味（和訳＋解説）を取得する。ポップアップ下段に出す。 */
  onExplain?: (sentence: string) => Promise<TranscriptMeaning>;
  /** ヘッダーの消去ボタンクリックで履歴を全消去する（未指定ならボタンを出さない）。 */
  onClearHistory?: () => void;
}

export interface TranscriptPanel {
  append(entry: TranscriptEntry): void;
  setTranslation(id: number, japanese: string): void;
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

const STYLES = `
.host {
  position: fixed; top: 0; right: 0; width: 320px; height: 100%;
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
.header .x { cursor: pointer; color: #aaa; font-size: 16px; line-height: 1; }
.header .actions { display: flex; align-items: center; gap: 10px; }
.header .clear { cursor: pointer; color: #aaa; font-size: 15px; line-height: 1; }
.header .clear:hover { color: #fff; }
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
.reopen {
  position: fixed; top: 8px; right: 8px; z-index: 2147483000;
  background: rgba(20,20,20,0.82); color: #fff; border: 1px solid #555;
  border-radius: 6px; padding: 4px 8px; font-size: 12px; cursor: pointer;
  pointer-events: auto;
  font-family: -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
}
.hover-popup {
  position: fixed; max-width: 320px; min-width: 200px;
  background: #1e1e1e; color: #f3f3f3; border: 1px solid #444; border-radius: 10px;
  padding: 10px 12px; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
  font-size: 13px; line-height: 1.6; pointer-events: auto; z-index: 2147483001;
}
.hover-popup .hp-section { display: flex; flex-direction: column; }
.hover-popup .hp-section + .hp-section { margin-top: 8px; padding-top: 8px; border-top: 1px solid #3a3a3a; }
.hover-popup .hp-word-head { font-size: 15px; font-weight: 700; color: #8ab4ff; margin-bottom: 4px; }
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
.hover-popup .hp-trans { color: #ffe08a; white-space: pre-wrap; margin-bottom: 4px; }
.hover-popup .hp-expl { white-space: pre-wrap; color: #cfcfcf; font-size: 12px; }
.hover-popup .hp-body { white-space: pre-wrap; }
.hover-popup .hp-body.loading { opacity: 0.7; }
.hover-popup .hp-body.err { color: #ff8a8a; }
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
  const header = document.createElement('div');
  header.className = 'header';
  const title = document.createElement('span');
  title.textContent = 'Transcript History';
  const closeX = document.createElement('span');
  closeX.className = 'x';
  closeX.textContent = '×';
  closeX.title = 'Close panel';
  // 右側のボタン群。space-between で散らばらないよう1つにまとめる（🗑 を × の左隣に置く）。
  const actions = document.createElement('span');
  actions.className = 'actions';
  if (cb.onClearHistory) {
    const clearBtn = document.createElement('span');
    clearBtn.className = 'clear';
    clearBtn.textContent = '🗑';
    clearBtn.title = 'Clear all history';
    clearBtn.addEventListener('click', () => cb.onClearHistory?.());
    actions.append(clearBtn);
  }
  actions.append(closeX);
  header.append(title, actions);
  const list = document.createElement('div');
  list.className = 'list';
  panel.append(header, list);
  panelHost.appendChild(panel);
  shadow.appendChild(panelHost);

  const reopen = document.createElement('button');
  reopen.className = 'reopen';
  reopen.textContent = '☰ Transcript';
  reopen.style.display = 'none';
  shadow.appendChild(reopen);

  const setVisible = (visible: boolean): void => {
    panelHost.style.display = visible ? '' : 'none';
    reopen.style.display = visible ? 'none' : '';
  };
  closeX.addEventListener('click', () => setVisible(false));
  reopen.addEventListener('click', () => setVisible(true));

  const jaById = new Map<number, HTMLDivElement>();
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
  const DWELL_MS = 500; // 何ms乗せ続けたら出すか（初回のみ。ポップアップ表示中は即時切替）
  const CLOSE_GRACE_MS = 200; // 離れてから閉じるまでの猶予
  let hoverPopup: HTMLDivElement | null = null;
  let dwellTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  // 応答の競合ガード。開く/閉じる/別単語へ移るたびに増やし、古い応答を破棄する。
  let hoverSeq = 0;

  const clearDwell = (): void => {
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
  const hideHoverPopup = (): void => {
    clearDwell();
    clearClose();
    hoverSeq++; // 進行中の応答を無効化
    if (hoverPopup) {
      hoverPopup.remove();
      hoverPopup = null;
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
  ): void => {
    if (!hoverPopup) return;
    hoverPopup.replaceChildren();

    if (cb.onExplainWord) {
      const sec = document.createElement('div');
      sec.className = 'hp-section';
      const head = document.createElement('div');
      head.className = 'hp-word-head';
      head.textContent = word;
      sec.appendChild(head);
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

  /**
   * ホバーポップアップを開く（または現在のポップアップを別単語に差し替える）。
   * 単語の意味と文の意味を並行取得し、それぞれの応答が来た順に該当セクションを更新する。
   * 行を跨いで単語移動した場合は hoverSeq で旧応答を破棄する。
   */
  const openHoverPopup = (row: HTMLElement, word: string, sentence: string): void => {
    if (!cb.onExplainWord && !cb.onExplain) return;
    clearClose();
    const seq = ++hoverSeq;
    if (!hoverPopup) {
      hoverPopup = document.createElement('div');
      hoverPopup.className = 'hover-popup';
      hoverPopup.addEventListener('mouseenter', clearClose);
      hoverPopup.addEventListener('mouseleave', scheduleClose);
      shadow.appendChild(hoverPopup);
    }

    let wordRes: TranscriptWordMeaning | null = null;
    let sentRes: TranscriptMeaning | null = null;
    renderHoverPopup(word, wordRes, sentRes);
    positionHoverPopup(row);

    if (cb.onExplainWord) {
      void cb.onExplainWord(word, sentence).then((res) => {
        if (seq !== hoverSeq || !hoverPopup) return; // 別単語へ移った／閉じた
        wordRes = res;
        renderHoverPopup(word, wordRes, sentRes);
        positionHoverPopup(row);
      });
    }
    if (cb.onExplain) {
      void cb.onExplain(sentence).then((res) => {
        if (seq !== hoverSeq || !hoverPopup) return;
        sentRes = res;
        renderHoverPopup(word, wordRes, sentRes);
        positionHoverPopup(row);
      });
    }
  };

  const onHoverKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') hideHoverPopup();
  };

  function append(entry: TranscriptEntry): void {
    const row = document.createElement('div');
    row.className = 'row';
    row.addEventListener('click', () => cb.onSeek(entry.videoTime));
    // 行から完全に出たらドウェルをキャンセルしてポップアップを閉じる。隣の行の単語に
    // 移ったときは、その単語の mouseenter が先に clearClose して即時で差し替わる。
    row.addEventListener('mouseleave', () => {
      clearDwell();
      scheduleClose();
    });
    const en = document.createElement('div');
    en.className = 'en';

    // 単語ごとに span を起こし、その単語のホバーで意味取得を発火する（Language Reactor 風）。
    // 単語間移動はポップアップ表示中なら即時で切り替わる（初回のみドウェル待ち）。
    for (const tok of tokenizeLine(entry.english)) {
      if (!tok.isWord) {
        en.appendChild(document.createTextNode(tok.text));
        continue;
      }
      const wspan = document.createElement('span');
      wspan.className = 'word';
      wspan.textContent = tok.text;
      wspan.addEventListener('mouseenter', () => {
        clearClose();
        clearDwell();
        if (hoverPopup) {
          // すでに表示中（または猶予中）なら、ドウェルなしで即時切替。
          openHoverPopup(row, tok.text, entry.english);
        } else {
          dwellTimer = setTimeout(
            () => openHoverPopup(row, tok.text, entry.english),
            DWELL_MS,
          );
        }
      });
      en.appendChild(wspan);
    }

    const ja = document.createElement('div');
    ja.className = 'ja';
    row.append(en, ja);
    list.appendChild(row);
    jaById.set(entry.id, ja);
    rows.push({ videoTime: entry.videoTime, el: row });
    // 追従中のときだけ最下部へ送る（履歴を遡って読んでいる間は勝手に飛ばさない）。
    if (following) {
      list.scrollTop = list.scrollHeight;
      lastAutoScrollTop = list.scrollTop;
    }
  }

  function setTranslation(id: number, japanese: string): void {
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
    hideHoverPopup(); // 消える行を指したままのカードを残さない
    list.replaceChildren();
    rows.length = 0;
    jaById.clear();
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
  };
  const onFullscreenChange = (): void => attach();

  function destroy(): void {
    document.removeEventListener('fullscreenchange', onFullscreenChange, true);
    document.removeEventListener('keydown', onHoverKeyDown, true);
    hideHoverPopup();
    host.remove();
    jaById.clear();
  }

  document.addEventListener('fullscreenchange', onFullscreenChange, true);
  document.addEventListener('keydown', onHoverKeyDown, true);
  attach();
  return { append, setTranslation, updateActiveByTime, clear, destroy };
}
