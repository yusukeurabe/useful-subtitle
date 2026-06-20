// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createTranscriptPanel,
  nextFollowState,
  type TranscriptPanel,
  type TranscriptMeaning,
} from '../src/content/transcriptPanel';

const HOST_ID = 'useful-subtitle-transcript';

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

    row.dispatchEvent(new Event('mouseenter'));
    await vi.advanceTimersByTimeAsync(500);
    expect(popup()).not.toBeNull(); // ポップアップが出ている状態でも…

    row.click(); // …クリックはちゃんとシークする
    expect(seeks).toEqual([7]);
  });
});

describe('createTranscriptPanel — ホバーで文の意味', () => {
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

  it('ドウェル時間が過ぎると onExplain が呼ばれ和訳・解説が出る', async () => {
    const calls: string[] = [];
    panel = createTranscriptPanel({
      onSeek: () => {},
      onExplain: async (s) => {
        calls.push(s);
        return { ok: true, translation: '和訳テキスト', explanation: '解説テキスト' };
      },
    });
    panel.append({ id: 1, english: 'Break a leg!', videoTime: 1 });
    const row = rowsOf()[0];

    row.dispatchEvent(new Event('mouseenter'));
    expect(popup()).toBeNull(); // ドウェル前は出ない
    await vi.advanceTimersByTimeAsync(500);

    expect(calls).toEqual(['Break a leg!']);
    const p = popup();
    expect(p).not.toBeNull();
    expect(p!.textContent).toContain('和訳テキスト');
    expect(p!.textContent).toContain('解説テキスト');
  });

  it('ドウェル前に離れると onExplain は呼ばれない', async () => {
    let called = 0;
    panel = createTranscriptPanel({
      onSeek: () => {},
      onExplain: async () => {
        called++;
        return { ok: true, translation: 'x', explanation: 'y' };
      },
    });
    panel.append({ id: 1, english: 'Hello there', videoTime: 1 });
    const row = rowsOf()[0];

    row.dispatchEvent(new Event('mouseenter'));
    await vi.advanceTimersByTimeAsync(200);
    row.dispatchEvent(new Event('mouseleave'));
    await vi.advanceTimersByTimeAsync(500);

    expect(called).toBe(0);
    expect(popup()).toBeNull();
  });

  it('エラー応答は赤字(.err)で表示する', async () => {
    panel = createTranscriptPanel({
      onSeek: () => {},
      onExplain: async () => ({ ok: false, error: 'APIキーが未設定です。' }),
    });
    panel.append({ id: 1, english: 'X', videoTime: 1 });
    rowsOf()[0].dispatchEvent(new Event('mouseenter'));
    await vi.advanceTimersByTimeAsync(500);

    const p = popup();
    expect(p!.textContent).toContain('APIキーが未設定です。');
    expect(p!.querySelector('.err')).not.toBeNull();
  });

  it('別の行へ移ると古い応答は無視され、最後の行の意味が残る', async () => {
    let resolveFirst: (v: TranscriptMeaning) => void = () => {};
    panel = createTranscriptPanel({
      onSeek: () => {},
      onExplain: (s) => {
        if (s === 'first') return new Promise<TranscriptMeaning>((r) => { resolveFirst = r; });
        return Promise.resolve({ ok: true, translation: 'SECOND', explanation: 'second expl' });
      },
    });
    panel.append({ id: 1, english: 'first', videoTime: 1 });
    panel.append({ id: 2, english: 'second', videoTime: 2 });
    const [r1, r2] = rowsOf();

    r1.dispatchEvent(new Event('mouseenter'));
    await vi.advanceTimersByTimeAsync(500); // first 要求中（未解決）
    r1.dispatchEvent(new Event('mouseleave'));
    r2.dispatchEvent(new Event('mouseenter')); // r1 の閉じる猶予をキャンセル
    await vi.advanceTimersByTimeAsync(500); // second 解決→描画

    resolveFirst({ ok: true, translation: 'FIRST', explanation: 'first expl' });
    await vi.advanceTimersByTimeAsync(0);

    const p = popup();
    expect(p!.textContent).toContain('SECOND');
    expect(p!.textContent).not.toContain('FIRST');
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
    rowsOf()[0].dispatchEvent(new Event('mouseenter'));
    await vi.advanceTimersByTimeAsync(500);
    expect(popup()).not.toBeNull();

    panel.clear();
    expect(popup()).toBeNull();
  });
});
