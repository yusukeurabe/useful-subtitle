// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTranscriptPanel, type TranscriptPanel } from '../src/content/transcriptPanel';

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
