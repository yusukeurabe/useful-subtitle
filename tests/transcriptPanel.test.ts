// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createTranscriptPanel,
  nextFollowState,
  type TranscriptPanel,
  type TranscriptMeaning,
  type TranscriptWordMeaning,
} from '../src/content/transcriptPanel';

const HOST_ID = 'useful-subtitle-transcript';

/** 行内の単語 span を取得する（ホバー対象）。 */
function wordsOf(row: HTMLDivElement): HTMLSpanElement[] {
  return Array.from(row.querySelectorAll<HTMLSpanElement>('.en .word'));
}

/** jsdom には Fullscreen API が無いので fullscreenElement を差し替えてイベントを発火する。 */
function setFullscreen(el: Element | null): void {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: el });
  document.dispatchEvent(new Event('fullscreenchange'));
}

describe('createTranscriptPanel — 全画面への追従', () => {
  let panel: TranscriptPanel | null = null;

  beforeEach(() => {
    document.body.replaceChildren();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  });

  afterEach(() => {
    panel?.destroy();
    panel = null;
  });

  it('非全画面では document.body 直下にマウントされる', () => {
    panel = createTranscriptPanel({ onSeek: () => {} });
    const host = document.getElementById(HOST_ID);
    expect(host?.parentElement).toBe(document.body);
  });

  it('全画面に入ると fullscreenElement の中へ移動する', () => {
    const player = document.createElement('div');
    player.id = 'player';
    document.body.appendChild(player);

    panel = createTranscriptPanel({ onSeek: () => {} });
    const host = document.getElementById(HOST_ID);
    expect(host?.parentElement).toBe(document.body);

    setFullscreen(player);
    expect(host?.parentElement).toBe(player);
  });

  it('全画面を抜けると document.body 直下へ戻る', () => {
    const player = document.createElement('div');
    document.body.appendChild(player);

    panel = createTranscriptPanel({ onSeek: () => {} });
    const host = document.getElementById(HOST_ID);

    setFullscreen(player);
    expect(host?.parentElement).toBe(player);

    setFullscreen(null);
    expect(host?.parentElement).toBe(document.body);
  });
});

describe('createTranscriptPanel — 重なり順（z-index）', () => {
  let panel: TranscriptPanel | null = null;

  beforeEach(() => {
    document.body.replaceChildren();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  });

  afterEach(() => {
    panel?.destroy();
    panel = null;
  });

  // body に挿す外側ホスト自体に最前面の z-index が無いと、再生本編で
  // Prime Video のプレイヤーが全面に重なった際にパネルが裏へ隠れる。
  // overlay と同じ最前面値を外側ホストに持たせて、隠れないことを保証する。
  it('外側ホスト自体が最前面の z-index を持つ（再生プレイヤーに隠れない）', () => {
    panel = createTranscriptPanel({ onSeek: () => {} });
    const host = document.getElementById(HOST_ID);
    expect(host?.style.zIndex).toBe('2147483000');
  });
});

describe('createTranscriptPanel — 現在再生行のハイライト', () => {
  let panel: TranscriptPanel | null = null;

  beforeEach(() => {
    document.body.replaceChildren();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  });

  afterEach(() => {
    panel?.destroy();
    panel = null;
  });

  /** shadow DOM 内の行要素を取得する。 */
  function rowsOf(): HTMLDivElement[] {
    const host = document.getElementById(HOST_ID);
    return Array.from(host!.shadowRoot!.querySelectorAll<HTMLDivElement>('.row'));
  }

  /** videoTime の配列から行をまとめて追加する。 */
  function appendRows(p: TranscriptPanel, times: number[]): void {
    times.forEach((t, i) => p.append({ id: i + 1, english: `line ${i + 1}`, videoTime: t }));
  }

  /** active が付いている行のインデックス（無ければ -1）。 */
  function activeIndex(): number {
    return rowsOf().findIndex((r) => r.classList.contains('active'));
  }

  it('最初の行の videoTime より前の時刻ではどの行も active にならない', () => {
    panel = createTranscriptPanel({ onSeek: () => {} });
    appendRows(panel, [10, 20, 30]);
    panel.updateActiveByTime(5);
    expect(activeIndex()).toBe(-1);
  });

  it('行と行の間の時刻では「videoTime が現在時刻以下で最大の行」が active になる', () => {
    panel = createTranscriptPanel({ onSeek: () => {} });
    appendRows(panel, [10, 20, 30]);
    panel.updateActiveByTime(25);
    expect(activeIndex()).toBe(1);
  });

  it('ちょうど境界の時刻ではその行が active になる', () => {
    panel = createTranscriptPanel({ onSeek: () => {} });
    appendRows(panel, [10, 20, 30]);
    panel.updateActiveByTime(20);
    expect(activeIndex()).toBe(1);
  });

  it('最後の行以降の時刻では最後の行が active になる', () => {
    panel = createTranscriptPanel({ onSeek: () => {} });
    appendRows(panel, [10, 20, 30]);
    panel.updateActiveByTime(100);
    expect(activeIndex()).toBe(2);
  });

  it('巻き戻すと active が前の行へ戻り、active は常に1行だけ', () => {
    panel = createTranscriptPanel({ onSeek: () => {} });
    appendRows(panel, [10, 20, 30]);
    panel.updateActiveByTime(100);
    expect(activeIndex()).toBe(2);

    panel.updateActiveByTime(15);
    expect(activeIndex()).toBe(0);
    expect(rowsOf().filter((r) => r.classList.contains('active'))).toHaveLength(1);
  });

  it('履歴が空でも updateActiveByTime は何もせず例外を出さない', () => {
    panel = createTranscriptPanel({ onSeek: () => {} });
    expect(() => panel!.updateActiveByTime(50)).not.toThrow();
    expect(activeIndex()).toBe(-1);
  });
});

describe('nextFollowState — 追従可否の判定', () => {
  it('プログラム由来のスクロールは無視し、直前の追従状態を保つ', () => {
    expect(
      nextFollowState({ wasFollowing: true, isProgrammatic: true, activeRowVisible: false, nearBottom: false }),
    ).toBe(true);
    expect(
      nextFollowState({ wasFollowing: false, isProgrammatic: true, activeRowVisible: true, nearBottom: true }),
    ).toBe(false);
  });

  it('手動スクロール時はアクティブ行が見えていれば追従を再開する', () => {
    expect(
      nextFollowState({ wasFollowing: false, isProgrammatic: false, activeRowVisible: true, nearBottom: false }),
    ).toBe(true);
  });

  it('手動スクロール時は最下部付近なら追従を再開する', () => {
    expect(
      nextFollowState({ wasFollowing: false, isProgrammatic: false, activeRowVisible: false, nearBottom: true }),
    ).toBe(true);
  });

  it('手動スクロールでアクティブ行が見えず最下部でもなければ追従を止める', () => {
    expect(
      nextFollowState({ wasFollowing: true, isProgrammatic: false, activeRowVisible: false, nearBottom: false }),
    ).toBe(false);
  });
});

describe('createTranscriptPanel — クリックでシーク', () => {
  let panel: TranscriptPanel | null = null;

  beforeEach(() => {
    document.body.replaceChildren();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  });

  afterEach(() => {
    vi.useRealTimers();
    panel?.destroy();
    panel = null;
  });

  function rowsOf(): HTMLDivElement[] {
    const host = document.getElementById(HOST_ID);
    return Array.from(host!.shadowRoot!.querySelectorAll<HTMLDivElement>('.row'));
  }
  function popup(): HTMLDivElement | null {
    const host = document.getElementById(HOST_ID);
    return host!.shadowRoot!.querySelector<HTMLDivElement>('.hover-popup');
  }

  it('行をクリックするとその行の videoTime で onSeek が呼ばれる', () => {
    const seeks: number[] = [];
    panel = createTranscriptPanel({ onSeek: (t) => seeks.push(t) });
    panel.append({ id: 1, english: 'Hello there', videoTime: 42 });
    rowsOf()[0].click();
    expect(seeks).toEqual([42]);
  });

  it('onExplain 未指定（ホバー機能オフ相当）でもクリックでシークできる', () => {
    const seeks: number[] = [];
    panel = createTranscriptPanel({ onSeek: (t) => seeks.push(t) });
    panel.append({ id: 1, english: 'A', videoTime: 1 });
    panel.append({ id: 2, english: 'B', videoTime: 2 });
    rowsOf()[1].click();
    expect(seeks).toEqual([2]);
  });

  it('ホバーでポップアップが出た後でもクリックでシークできる（回帰）', async () => {
    vi.useFakeTimers();
    const seeks: number[] = [];
    panel = createTranscriptPanel({
      onSeek: (t) => seeks.push(t),
      onExplain: async () => ({ ok: true, translation: 'x', explanation: 'y' }),
    });
    panel.append({ id: 1, english: 'Hello', videoTime: 7 });
    const row = rowsOf()[0];

    wordsOf(row)[0].dispatchEvent(new Event('mouseenter'));
    await vi.advanceTimersByTimeAsync(500);
    expect(popup()).not.toBeNull(); // ポップアップが出ている状態でも…

    row.click(); // …クリックはちゃんとシークする
    expect(seeks).toEqual([7]);
  });
});

describe('createTranscriptPanel — 単語ホバーで2段ポップアップ（上=単語 / 下=文）', () => {
  let panel: TranscriptPanel | null = null;

  beforeEach(() => {
    document.body.replaceChildren();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    panel?.destroy();
    panel = null;
  });

  function rowsOf(): HTMLDivElement[] {
    const host = document.getElementById(HOST_ID);
    return Array.from(host!.shadowRoot!.querySelectorAll<HTMLDivElement>('.row'));
  }
  function popup(): HTMLDivElement | null {
    const host = document.getElementById(HOST_ID);
    return host!.shadowRoot!.querySelector<HTMLDivElement>('.hover-popup');
  }

  it('英文は単語ごとの .word span に分解される（記号は分解しない）', () => {
    panel = createTranscriptPanel({ onSeek: () => {} });
    panel.append({ id: 1, english: "Break a leg, friend!", videoTime: 1 });
    const ws = wordsOf(rowsOf()[0]).map((s) => s.textContent);
    expect(ws).toEqual(['Break', 'a', 'leg', 'friend']);
  });

  it('単語にホバーするとドウェル後に onExplainWord と onExplain が両方呼ばれる', async () => {
    const wordCalls: Array<[string, string]> = [];
    const sentCalls: string[] = [];
    panel = createTranscriptPanel({
      onSeek: () => {},
      onExplainWord: async (w, s) => {
        wordCalls.push([w, s]);
        return { ok: true, senses: [{ pos: 'V[I/T]', gloss: '壊す・破る' }], explanation: '単語の解説' };
      },
      onExplain: async (s) => {
        sentCalls.push(s);
        return { ok: true, translation: '頑張って！', explanation: '舞台前のイディオム。' };
      },
    });
    panel.append({ id: 1, english: 'Break a leg!', videoTime: 1 });
    const [breakSpan] = wordsOf(rowsOf()[0]);

    breakSpan.dispatchEvent(new Event('mouseenter'));
    expect(popup()).toBeNull(); // ドウェル前は出ない
    await vi.advanceTimersByTimeAsync(500);

    expect(wordCalls).toEqual([['Break', 'Break a leg!']]);
    expect(sentCalls).toEqual(['Break a leg!']);
  });

  it('上段に単語＋品詞別訳、下段に和訳と解説が出る', async () => {
    panel = createTranscriptPanel({
      onSeek: () => {},
      onExplainWord: async () => ({
        ok: true,
        senses: [{ pos: 'V[I/T]', gloss: '壊す・破る' }],
        explanation: '単語ノート',
      }),
      onExplain: async () => ({ ok: true, translation: '頑張って！', explanation: '舞台前のイディオム。' }),
    });
    panel.append({ id: 1, english: 'Break a leg!', videoTime: 1 });
    wordsOf(rowsOf()[0])[0].dispatchEvent(new Event('mouseenter'));
    await vi.advanceTimersByTimeAsync(500);

    const p = popup();
    expect(p).not.toBeNull();
    const sections = p!.querySelectorAll('.hp-section');
    expect(sections).toHaveLength(2);
    // 上段＝単語セクション
    expect(sections[0].querySelector('.hp-word-head')?.textContent).toBe('Break');
    expect(sections[0].textContent).toContain('V[I/T]');
    expect(sections[0].textContent).toContain('壊す・破る');
    expect(sections[0].textContent).toContain('単語ノート');
    // 下段＝文セクション
    expect(sections[1].textContent).toContain('頑張って！');
    expect(sections[1].textContent).toContain('舞台前のイディオム。');
  });

  it('単語の応答だけ先に来てもポップアップは出る（文側はローディング表示が残る）', async () => {
    let resolveSent: (v: TranscriptMeaning) => void = () => {};
    panel = createTranscriptPanel({
      onSeek: () => {},
      onExplainWord: async () => ({ ok: true, senses: [], explanation: '単語だけ' }),
      onExplain: () => new Promise<TranscriptMeaning>((r) => { resolveSent = r; }),
    });
    panel.append({ id: 1, english: 'Hello', videoTime: 1 });
    wordsOf(rowsOf()[0])[0].dispatchEvent(new Event('mouseenter'));
    await vi.advanceTimersByTimeAsync(500);

    const p = popup();
    expect(p!.textContent).toContain('単語だけ');
    expect(p!.querySelector('.loading')).not.toBeNull(); // 文側は thinking…

    resolveSent({ ok: true, translation: '後から来た和訳', explanation: '' });
    await vi.advanceTimersByTimeAsync(0);
    expect(popup()!.textContent).toContain('後から来た和訳');
  });

  it('ドウェル前に行を離れると onExplain も onExplainWord も呼ばれない', async () => {
    let wordCalls = 0;
    let sentCalls = 0;
    panel = createTranscriptPanel({
      onSeek: () => {},
      onExplainWord: async () => { wordCalls++; return { ok: true, senses: [], explanation: '' }; },
      onExplain: async () => { sentCalls++; return { ok: true, translation: 'x', explanation: 'y' }; },
    });
    panel.append({ id: 1, english: 'Hello there', videoTime: 1 });
    const row = rowsOf()[0];

    wordsOf(row)[0].dispatchEvent(new Event('mouseenter'));
    await vi.advanceTimersByTimeAsync(200);
    row.dispatchEvent(new Event('mouseleave'));
    await vi.advanceTimersByTimeAsync(500);

    expect(wordCalls).toBe(0);
    expect(sentCalls).toBe(0);
    expect(popup()).toBeNull();
  });

  it('エラー応答は赤字(.err)で表示する（単語側）', async () => {
    panel = createTranscriptPanel({
      onSeek: () => {},
      onExplainWord: async () => ({ ok: false, error: 'APIキーが未設定です。' }),
      onExplain: async () => ({ ok: true, translation: 'x', explanation: '' }),
    });
    panel.append({ id: 1, english: 'X', videoTime: 1 });
    wordsOf(rowsOf()[0])[0].dispatchEvent(new Event('mouseenter'));
    await vi.advanceTimersByTimeAsync(500);

    const p = popup();
    expect(p!.textContent).toContain('APIキーが未設定です。');
    expect(p!.querySelector('.err')).not.toBeNull();
  });

  it('別の単語へ移ると古い応答は無視され、最後にホバーした単語の意味だけが残る', async () => {
    let resolveFirstWord: (v: TranscriptWordMeaning) => void = () => {};
    panel = createTranscriptPanel({
      onSeek: () => {},
      onExplainWord: (w) => {
        if (w === 'first') return new Promise<TranscriptWordMeaning>((r) => { resolveFirstWord = r; });
        return Promise.resolve({ ok: true, senses: [{ pos: 'N[C]', gloss: 'SECOND-訳' }], explanation: 'SECOND-解説' });
      },
      onExplain: async () => ({ ok: true, translation: 'sent', explanation: '' }),
    });
    panel.append({ id: 1, english: 'first second', videoTime: 1 });
    const [firstSpan, secondSpan] = wordsOf(rowsOf()[0]);

    firstSpan.dispatchEvent(new Event('mouseenter'));
    await vi.advanceTimersByTimeAsync(500); // first 要求中（未解決）
    secondSpan.dispatchEvent(new Event('mouseenter')); // 表示中なので即時切替
    await vi.advanceTimersByTimeAsync(0); // second 解決→描画

    resolveFirstWord({ ok: true, senses: [{ pos: 'V[I]', gloss: 'FIRST-訳' }], explanation: 'FIRST-解説' });
    await vi.advanceTimersByTimeAsync(0);

    const p = popup();
    expect(p!.textContent).toContain('SECOND-訳');
    expect(p!.textContent).not.toContain('FIRST-訳');
  });

  it('ポップアップ表示中に別の単語へ移ると、ドウェル待ちなしで即時切替する', async () => {
    const seen: string[] = [];
    panel = createTranscriptPanel({
      onSeek: () => {},
      onExplainWord: async (w) => {
        seen.push(w);
        return { ok: true, senses: [], explanation: `expl:${w}` };
      },
      onExplain: async () => ({ ok: true, translation: 't', explanation: '' }),
    });
    panel.append({ id: 1, english: 'one two three', videoTime: 1 });
    const [one, two, three] = wordsOf(rowsOf()[0]);

    one.dispatchEvent(new Event('mouseenter'));
    await vi.advanceTimersByTimeAsync(500); // ドウェル後に open
    expect(popup()).not.toBeNull();
    expect(seen).toEqual(['one']);

    two.dispatchEvent(new Event('mouseenter')); // 即時切替
    await vi.advanceTimersByTimeAsync(0);
    three.dispatchEvent(new Event('mouseenter'));
    await vi.advanceTimersByTimeAsync(0);

    expect(seen).toEqual(['one', 'two', 'three']);
    expect(popup()!.textContent).toContain('three');
  });

  it('onExplainWord のみ指定なら下段（文セクション）は出ない', async () => {
    panel = createTranscriptPanel({
      onSeek: () => {},
      onExplainWord: async () => ({ ok: true, senses: [{ pos: 'N[C]', gloss: 'x' }], explanation: '' }),
    });
    panel.append({ id: 1, english: 'Solo', videoTime: 1 });
    wordsOf(rowsOf()[0])[0].dispatchEvent(new Event('mouseenter'));
    await vi.advanceTimersByTimeAsync(500);

    expect(popup()!.querySelectorAll('.hp-section')).toHaveLength(1);
  });

  it('onExplain のみ指定なら上段（単語セクション）は出ない（後方互換）', async () => {
    panel = createTranscriptPanel({
      onSeek: () => {},
      onExplain: async () => ({ ok: true, translation: '和訳のみ', explanation: '' }),
    });
    panel.append({ id: 1, english: 'Solo', videoTime: 1 });
    wordsOf(rowsOf()[0])[0].dispatchEvent(new Event('mouseenter'));
    await vi.advanceTimersByTimeAsync(500);

    const p = popup();
    expect(p!.querySelectorAll('.hp-section')).toHaveLength(1);
    expect(p!.textContent).toContain('和訳のみ');
    expect(p!.querySelector('.hp-word-head')).toBeNull();
  });

  it('どちらのコールバックも未指定ならホバーしてもポップアップは出ない', async () => {
    panel = createTranscriptPanel({ onSeek: () => {} });
    panel.append({ id: 1, english: 'Nothing', videoTime: 1 });
    wordsOf(rowsOf()[0])[0].dispatchEvent(new Event('mouseenter'));
    await vi.advanceTimersByTimeAsync(500);
    expect(popup()).toBeNull();
  });
});

describe('createTranscriptPanel — clear() で履歴を全消去', () => {
  let panel: TranscriptPanel | null = null;

  beforeEach(() => {
    document.body.replaceChildren();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  });

  afterEach(() => {
    vi.useRealTimers();
    panel?.destroy();
    panel = null;
  });

  function rowsOf(): HTMLDivElement[] {
    const host = document.getElementById(HOST_ID);
    return Array.from(host!.shadowRoot!.querySelectorAll<HTMLDivElement>('.row'));
  }
  function popup(): HTMLDivElement | null {
    const host = document.getElementById(HOST_ID);
    return host!.shadowRoot!.querySelector<HTMLDivElement>('.hover-popup');
  }

  it('clear() で全ての行が消える', () => {
    panel = createTranscriptPanel({ onSeek: () => {} });
    panel.append({ id: 1, english: 'A', videoTime: 1 });
    panel.append({ id: 2, english: 'B', videoTime: 2 });
    expect(rowsOf()).toHaveLength(2);

    panel.clear();
    expect(rowsOf()).toHaveLength(0);
  });

  it('clear() 後の updateActiveByTime は何もせず例外を出さない', () => {
    panel = createTranscriptPanel({ onSeek: () => {} });
    panel.append({ id: 1, english: 'A', videoTime: 10 });
    panel.clear();
    expect(() => panel!.updateActiveByTime(50)).not.toThrow();
    expect(rowsOf().filter((r) => r.classList.contains('active'))).toHaveLength(0);
  });

  it('clear() 後に append すると新しい行が先頭になる', () => {
    panel = createTranscriptPanel({ onSeek: () => {} });
    panel.append({ id: 1, english: 'OLD', videoTime: 1000 });
    panel.clear();
    panel.append({ id: 2, english: 'NEW', videoTime: 3 });

    const rows = rowsOf();
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('NEW');
    expect(rows[0].textContent).not.toContain('OLD');
  });

  it('clear() 後に旧 id へ setTranslation しても無視され例外を出さない（遅延翻訳の混入防止）', () => {
    panel = createTranscriptPanel({ onSeek: () => {} });
    panel.append({ id: 1, english: 'OLD', videoTime: 1 });
    panel.clear();
    expect(() => panel!.setTranslation(1, '遅れて来た翻訳')).not.toThrow();
    const host = document.getElementById(HOST_ID);
    expect(host!.shadowRoot!.textContent).not.toContain('遅れて来た翻訳');
  });

  it('ホバーカードが開いている状態で clear() すると閉じる', async () => {
    vi.useFakeTimers();
    panel = createTranscriptPanel({
      onSeek: () => {},
      onExplain: async () => ({ ok: true, translation: 'x', explanation: 'y' }),
    });
    panel.append({ id: 1, english: 'Hello', videoTime: 1 });
    wordsOf(rowsOf()[0])[0].dispatchEvent(new Event('mouseenter'));
    await vi.advanceTimersByTimeAsync(500);
    expect(popup()).not.toBeNull();

    panel.clear();
    expect(popup()).toBeNull();
  });
});

describe('createTranscriptPanel — 履歴の手動消去ボタン', () => {
  let panel: TranscriptPanel | null = null;

  beforeEach(() => {
    document.body.replaceChildren();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  });

  afterEach(() => {
    panel?.destroy();
    panel = null;
  });

  function clearButton(): HTMLElement | null {
    const host = document.getElementById(HOST_ID);
    return host!.shadowRoot!.querySelector<HTMLElement>('.clear');
  }

  it('onClearHistory 指定時、ヘッダーに消去ボタンが表示される', () => {
    panel = createTranscriptPanel({ onSeek: () => {}, onClearHistory: () => {} });
    expect(clearButton()).not.toBeNull();
  });

  it('消去ボタンをクリックすると onClearHistory が1回呼ばれる', () => {
    let calls = 0;
    panel = createTranscriptPanel({ onSeek: () => {}, onClearHistory: () => { calls++; } });
    clearButton()!.click();
    expect(calls).toBe(1);
  });

  it('onClearHistory 未指定なら消去ボタンは表示されない', () => {
    panel = createTranscriptPanel({ onSeek: () => {} });
    expect(clearButton()).toBeNull();
  });
});
