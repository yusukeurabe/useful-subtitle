// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createOverlay, type Overlay, type OverlayCallbacks } from '../src/content/overlay';
import { tokenizeLine } from '../src/shared/tokenize';

const HOST_ID = 'useful-subtitle-overlay';

function noopCallbacks(): OverlayCallbacks {
  return {
    onLookup: () => {},
    onPlayAudio: () => {},
    onSeek: () => {},
  };
}

function shadow(): ShadowRoot {
  const host = document.getElementById(HOST_ID);
  return host!.shadowRoot!;
}

function replayBtn(): HTMLButtonElement | null {
  return shadow().querySelector<HTMLButtonElement>('.replay-btn');
}

describe('createOverlay — 字幕の頭から再生する▶ボタン', () => {
  let overlay: Overlay | null = null;

  beforeEach(() => {
    document.body.replaceChildren();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  });

  afterEach(() => {
    overlay?.destroy();
    overlay = null;
  });

  it('Prime の画面固定配置と全画面への付け替えを維持する', () => {
    overlay = createOverlay(noopCallbacks(), { bottomPercent: 10, onBottomChange: () => {} });
    const host = document.getElementById(HOST_ID)!;
    expect(host.parentElement).toBe(document.body);
    expect(host.style.position).toBe('fixed');
    const player = document.createElement('div');
    document.body.append(player);
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: player });
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(host.parentElement).toBe(player);
  });

  it('renderLine で▶ボタンが字幕の中に描画される', () => {
    overlay = createOverlay(noopCallbacks(), { bottomPercent: 10, onBottomChange: () => {} });
    overlay.renderLine('Hello, world.', tokenizeLine('Hello, world.'), 12.5);
    expect(replayBtn()).not.toBeNull();
  });

  it('▶クリックで onSeek が renderLine の videoTime で呼ばれる', () => {
    const seeks: number[] = [];
    overlay = createOverlay(
      { ...noopCallbacks(), onSeek: (t) => seeks.push(t) },
      { bottomPercent: 10, onBottomChange: () => {} },
    );
    overlay.renderLine('Hello there.', tokenizeLine('Hello there.'), 42);
    replayBtn()!.click();
    expect(seeks).toEqual([42]);
  });

  it('renderLine を新しい videoTime で呼び直すと▶クリックは新しい時刻でシークする', () => {
    const seeks: number[] = [];
    overlay = createOverlay(
      { ...noopCallbacks(), onSeek: (t) => seeks.push(t) },
      { bottomPercent: 10, onBottomChange: () => {} },
    );
    overlay.renderLine('First line.', tokenizeLine('First line.'), 10);
    overlay.renderLine('Second line.', tokenizeLine('Second line.'), 25);
    replayBtn()!.click();
    expect(seeks).toEqual([25]);
  });

  it('clearLine 後は▶ボタンが消える', () => {
    overlay = createOverlay(noopCallbacks(), { bottomPercent: 10, onBottomChange: () => {} });
    overlay.renderLine('Hello.', tokenizeLine('Hello.'), 7);
    expect(replayBtn()).not.toBeNull();
    overlay.clearLine();
    expect(replayBtn()).toBeNull();
  });

  it('videoTime=0 でも▶クリックで onSeek(0) が呼ばれる（動画未取得の保険）', () => {
    const seeks: number[] = [];
    overlay = createOverlay(
      { ...noopCallbacks(), onSeek: (t) => seeks.push(t) },
      { bottomPercent: 10, onBottomChange: () => {} },
    );
    overlay.renderLine('A.', tokenizeLine('A.'), 0);
    replayBtn()!.click();
    expect(seeks).toEqual([0]);
  });
});

describe('createOverlay — ポップアップの発音ボタン', () => {
  let overlay: Overlay | null = null;
  beforeEach(() => {
    document.body.replaceChildren();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  });
  afterEach(() => {
    overlay?.destroy();
    overlay = null;
  });

  it('発音ボタンは絵文字ではなく SVG アイコンで、押すと選択語と音源で再生を依頼する', () => {
    const plays: Array<[string, string | null]> = [];
    overlay = createOverlay(
      { ...noopCallbacks(), onPlayAudio: (s, url) => plays.push([s, url]) },
      { bottomPercent: 10, onBottomChange: () => {} },
    );
    overlay.openPopup(new DOMRect(100, 100, 50, 20), 'staircase');
    overlay.setPopupWordInfo('ˈster.keɪs', 'https://x/staircase.mp3');
    const btn = shadow().querySelector<HTMLButtonElement>('.audio-btn')!;
    expect(btn.querySelector('svg')).not.toBeNull();
    expect(btn.textContent).toBe('');
    expect(btn.getAttribute('aria-label')).toBe('発音を再生');
    btn.click();
    expect(plays).toEqual([['staircase', 'https://x/staircase.mp3']]);
  });
});

describe('createOverlay — 字幕ホバーの通知', () => {
  let overlay: Overlay | null = null;
  let starts: number;
  let ends: Array<{ resume: boolean }>;

  const subtitleEl = (): HTMLDivElement => shadow().querySelector<HTMLDivElement>('.subtitle')!;
  const enter = (): void => void subtitleEl().dispatchEvent(new MouseEvent('mouseenter'));
  const leave = (): void => void subtitleEl().dispatchEvent(new MouseEvent('mouseleave'));
  const open = (): void => void overlay!.openPopup(new DOMRect(0, 0, 10, 10), 'hello');

  beforeEach(() => {
    document.body.replaceChildren();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    starts = 0;
    ends = [];
    overlay = createOverlay(
      {
        ...noopCallbacks(),
        onHoverStart: () => void starts++,
        onHoverEnd: (o) => void ends.push(o),
      },
      { bottomPercent: 10, onBottomChange: () => {} },
    );
    overlay.renderLine('Hello there.', tokenizeLine('Hello there.'), 1);
  });

  afterEach(() => {
    overlay?.destroy();
    overlay = null;
  });

  it('字幕枠に入ると onHoverStart、出ると onHoverEnd({resume:true})', () => {
    enter();
    expect(starts).toBe(1);
    leave();
    expect(ends).toEqual([{ resume: true }]);
  });

  it('ポップアップが開いている間は字幕枠から出ても onHoverEnd を呼ばない', () => {
    enter();
    open();
    leave();
    expect(ends).toEqual([]);
  });

  it('枠外で×を押してポップアップを閉じると onHoverEnd({resume:true})', () => {
    enter();
    open();
    leave();
    shadow().querySelector<HTMLDivElement>('.popup .close')!.click();
    expect(ends).toEqual([{ resume: true }]);
  });

  it('枠外で Esc でポップアップを閉じると onHoverEnd({resume:true})', () => {
    enter();
    open();
    leave();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(ends).toEqual([{ resume: true }]);
  });

  it('枠内でポップアップを閉じたら通知せず、その後出たときに通知する', () => {
    enter();
    open();
    shadow().querySelector<HTMLDivElement>('.popup .close')!.click();
    expect(ends).toEqual([]);
    leave();
    expect(ends).toEqual([{ resume: true }]);
  });

  it('ポップアップの外側クリックで閉じると onHoverEnd({resume:false})', () => {
    enter();
    open();
    leave();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(ends).toEqual([{ resume: false }]);
  });

  it('clearLine では再開を通知しない（ポップアップ無し）', () => {
    enter();
    overlay!.clearLine();
    expect(ends).toEqual([]);
  });

  it('clearLine でポップアップが閉じても resume:false にとどめる', () => {
    enter();
    open();
    overlay!.clearLine();
    expect(ends).toEqual([{ resume: false }]);
  });

  it('ポップアップが無ければ hidePopup しても通知しない', () => {
    overlay!.hidePopup();
    expect(ends).toEqual([]);
  });
});
