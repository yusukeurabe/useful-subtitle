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

  it('▶クリックで開いている単語ポップアップを閉じてから onSeek を呼ぶ（×を押さなくても消える）', () => {
    const order: string[] = [];
    overlay = createOverlay(
      { ...noopCallbacks(), onSeek: () => order.push(shadow().querySelector('.popup') ? 'seek:open' : 'seek:closed') },
      { bottomPercent: 10, onBottomChange: () => {} },
    );
    overlay.renderLine('Hello there.', tokenizeLine('Hello there.'), 42);
    overlay.openPopup(new DOMRect(0, 0, 10, 10), 'Hello');
    expect(shadow().querySelector('.popup')).not.toBeNull();
    replayBtn()!.click();
    expect(shadow().querySelector('.popup')).toBeNull();
    expect(order).toEqual(['seek:closed']);
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

describe('createOverlay — ポップアップを字幕に被せない', () => {
  let overlay: Overlay | null = null;
  let popupHeight = 200;
  const originalInnerHeight = window.innerHeight;
  const originalInnerWidth = window.innerWidth;

  beforeEach(() => {
    document.body.replaceChildren();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1000 });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
    popupHeight = 200;
    // jsdom はレイアウトしないので、ポップアップの寸法だけ与える（maxHeight を付けたらその高さに縮む）。
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        if (!this.classList.contains('popup')) return 0;
        const max = parseFloat(this.style.maxHeight);
        return Number.isNaN(max) ? popupHeight : Math.min(popupHeight, max);
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(this: HTMLElement) { return this.classList.contains('popup') ? 300 : 0; },
    });
  });

  afterEach(() => {
    overlay?.destroy();
    overlay = null;
    delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
    delete (HTMLElement.prototype as { offsetWidth?: number }).offsetWidth;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
  });

  /** 字幕枠を top〜bottom（px）に置いた状態で描画する。 */
  const renderAt = (top: number, bottom: number): void => {
    overlay = createOverlay(noopCallbacks(), { bottomPercent: 10, onBottomChange: () => {} });
    overlay.renderLine('First line\nsecond line', tokenizeLine('First line second line'), 0);
    shadow().querySelector<HTMLElement>('.subtitle')!.getBoundingClientRect =
      () => new DOMRect(300, top, 600, bottom - top);
  };
  const popupBox = (): { top: number; bottom: number; maxHeight: string } => {
    const popup = shadow().querySelector<HTMLElement>('.popup')!;
    const top = parseFloat(popup.style.top);
    return { top, bottom: top + popup.offsetHeight, maxHeight: popup.style.maxHeight };
  };

  it('字幕の 2 行目の語をクリックしても、字幕枠全体の上に置く（1 行目に被らない）', () => {
    renderAt(600, 760);
    // 2 行目の語（字幕枠の途中）。旧実装は語の真上＝ 1 行目に重なっていた。
    overlay!.openPopup(new DOMRect(500, 680, 60, 30), 'second');
    const box = popupBox();
    expect(box.bottom).toBeLessThanOrEqual(600);
    expect(box.top).toBe(600 - 8 - 200);
    expect(box.maxHeight).toBe('');
  });

  it('解説が届いて背が伸びても、字幕の上に置き直す', () => {
    renderAt(600, 760);
    overlay!.openPopup(new DOMRect(500, 610, 60, 30), 'First');
    popupHeight = 420;
    overlay!.setPopupMeaning('long', []);
    const box = popupBox();
    expect(box.bottom).toBeLessThanOrEqual(600);
    expect(box.top).toBe(600 - 8 - 420);
  });

  it('字幕の上に入らなければ、字幕の下に置く', () => {
    renderAt(100, 220);
    overlay!.openPopup(new DOMRect(500, 110, 60, 30), 'Hello');
    const box = popupBox();
    expect(box.top).toBe(220 + 8);
    expect(box.top).toBeGreaterThanOrEqual(220);
  });

  it('上下どちらにも入らなければ、広い側に高さを詰めて置く（中はスクロール）', () => {
    popupHeight = 900;
    renderAt(400, 560);
    overlay!.openPopup(new DOMRect(500, 410, 60, 30), 'Hello');
    const box = popupBox();
    // 上の余白 400-16=384 より下の余白 1000-560-16=424 の方が広いので、下側に詰める。
    expect(box.maxHeight).toBe('424px');
    expect(box.top).toBe(560 + 8);
    expect(box.bottom).toBeLessThanOrEqual(1000 - 8);
    expect(shadow().querySelector<HTMLElement>('.popup')!.style.overflowY).toBe('auto');
  });

  it('次に背の低い内容で置き直したら、詰めた高さを解除する', () => {
    popupHeight = 900;
    renderAt(400, 560);
    overlay!.openPopup(new DOMRect(500, 410, 60, 30), 'Hello');
    popupHeight = 150;
    overlay!.setPopupMeaning('short', []);
    const box = popupBox();
    expect(box.maxHeight).toBe('');
    expect(box.bottom).toBeLessThanOrEqual(400);
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
    leave();
    expect(ends).toEqual([{ resume: false }]);
  });

  it('枠外へはみ出すフレーズドラッグ中は通知せず、選択を終えたときに通知する', () => {
    enter();
    shadow().querySelector<HTMLSpanElement>('.word')!.dispatchEvent(new MouseEvent('mousedown'));
    leave();
    expect(ends).toEqual([]);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(ends).toEqual([{ resume: true }]);
  });

  it('ドラッグ中に枠外へ出て clearLine された後の mouseup では再開を通知しない', () => {
    enter();
    shadow().querySelector<HTMLSpanElement>('.word')!.dispatchEvent(new MouseEvent('mousedown'));
    leave();
    overlay!.clearLine();
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(ends).not.toContainEqual({ resume: true });
  });

  it('destroy で開いているポップアップを閉じても resume:false にとどめる', () => {
    enter();
    open();
    leave();
    overlay!.destroy();
    overlay = null;
    expect(ends).toEqual([{ resume: false }]);
  });

  it('clearLine でポップアップが閉じても resume:false にとどめる', () => {
    enter();
    open();
    overlay!.clearLine();
    expect(ends).toEqual([{ resume: false }]);
  });

  it('次の字幕描画でポップアップが閉じても resume:false にとどめる', () => {
    enter();
    open();
    leave();
    overlay!.renderLine('Next line.', tokenizeLine('Next line.'), 2);
    expect(ends).toEqual([{ resume: false }]);
  });

  it('ポップアップが無ければ hidePopup しても通知しない', () => {
    overlay!.hidePopup();
    expect(ends).toEqual([]);
  });
});

describe('createOverlay — つまみのドラッグで字幕を上下に動かす', () => {
  let overlay: Overlay | null = null;

  beforeEach(() => {
    document.body.replaceChildren();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  });

  afterEach(() => {
    overlay?.destroy();
    overlay = null;
  });

  const posControls = (): HTMLElement => shadow().querySelector<HTMLElement>('.pos-controls')!;
  const handle = (): HTMLElement => shadow().querySelector<HTMLElement>('.pos-handle')!;
  const subtitleEl = (): HTMLElement => shadow().querySelector<HTMLElement>('.subtitle')!;
  const bottom = (): number => parseFloat(subtitleEl().style.bottom);

  // jsdom はレイアウトしないので、基準枠（host）の高さを固定する。
  const fixHostHeight = (h: number): void => {
    const host = document.getElementById(HOST_ID)!;
    host.getBoundingClientRect = () => new DOMRect(0, 0, 800, h);
  };

  // jsdom の PointerEvent は buttons の既定が 0 なので、押下中のイベントは buttons: 1 を渡す。
  const pointer = (target: EventTarget, type: string, clientY: number): PointerEvent => {
    const e = new PointerEvent(type, {
      pointerId: 1, button: 0, clientY, bubbles: true, composed: true, cancelable: true,
      buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    });
    target.dispatchEvent(e);
    return e;
  };

  const setup = (bottomPercent = 10): number[] => {
    const saved: number[] = [];
    overlay = createOverlay(noopCallbacks(), {
      bottomPercent,
      onBottomChange: (p) => saved.push(p),
    });
    fixHostHeight(1000);
    overlay.renderLine('Hello, world.', tokenizeLine('Hello, world.'), 0);
    return saved;
  };

  it('つまみが ▲ と ▼ の間に描画される', () => {
    setup();
    const kids = [...posControls().children] as HTMLElement[];
    expect(kids.map((k) => k.className)).toEqual(['pos-btn', 'pos-handle', 'pos-btn']);
    expect(kids.map((k) => k.textContent)).toEqual(['▲', '⠿', '▼']);
  });

  it('上へ 100px ドラッグすると高さ 1000px に対して 10% 上がる', () => {
    setup(10);
    pointer(handle(), 'pointerdown', 500);
    pointer(document, 'pointermove', 400);
    expect(bottom()).toBeCloseTo(20);
    pointer(document, 'pointermove', 550);
    expect(bottom()).toBeCloseTo(5);
  });

  it('下限 2% と上限 85% を超えない', () => {
    setup(10);
    pointer(handle(), 'pointerdown', 500);
    pointer(document, 'pointermove', -5000);
    expect(bottom()).toBe(85);
    pointer(document, 'pointermove', 5000);
    expect(bottom()).toBe(2);
  });

  it('ドラッグ中は保存せず、離したときに最終位置を 1 回だけ保存する', () => {
    const saved = setup(10);
    pointer(handle(), 'pointerdown', 500);
    pointer(document, 'pointermove', 450);
    pointer(document, 'pointermove', 400);
    expect(saved).toEqual([]);
    pointer(document, 'pointerup', 400);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toBeCloseTo(20);
    // 離した後の移動では動かない。
    pointer(document, 'pointermove', 100);
    expect(bottom()).toBeCloseTo(20);
    expect(saved).toHaveLength(1);
  });

  it('動かさずに離したときは保存しない', () => {
    const saved = setup(10);
    pointer(handle(), 'pointerdown', 500);
    pointer(document, 'pointerup', 500);
    expect(saved).toEqual([]);
  });

  it('pointercancel でも見えている位置を保存して終わる', () => {
    const saved = setup(10);
    pointer(handle(), 'pointerdown', 500);
    pointer(document, 'pointermove', 400);
    pointer(document, 'pointercancel', 400);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toBeCloseTo(20);
  });

  it('ドラッグ中に字幕が消えてもドラッグは続き、離すと保存される', () => {
    const saved = setup(10);
    pointer(handle(), 'pointerdown', 500);
    overlay!.clearLine();
    expect(subtitleEl().hidden).toBe(true);
    pointer(document, 'pointermove', 300);
    pointer(document, 'pointerup', 300);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toBeCloseTo(30);
    overlay!.renderLine('Next line.', tokenizeLine('Next line.'), 1);
    expect(bottom()).toBeCloseTo(30);
  });

  it('ドラッグ開始で単語のポップアップを閉じる', () => {
    setup(10);
    overlay!.openPopup(new DOMRect(0, 0, 10, 10), 'Hello');
    expect(shadow().querySelector('.popup')).not.toBeNull();
    pointer(handle(), 'pointerdown', 500);
    expect(shadow().querySelector('.popup')).toBeNull();
  });

  it('つまみの pointerdown は既定動作を止める（再生切り替え・文字選択を防ぐ）', () => {
    setup(10);
    const e = pointer(handle(), 'pointerdown', 500);
    expect(e.defaultPrevented).toBe(true);
  });

  it('左ボタン以外ではドラッグを始めない', () => {
    setup(10);
    handle().dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 2, clientY: 500, bubbles: true, composed: true, cancelable: true,
    }));
    pointer(document, 'pointermove', 400);
    expect(bottom()).toBe(10);
  });

  it('▲▼ ボタンは今までどおり 6% ずつ動かして保存する', () => {
    const saved = setup(10);
    const [up, , down] = [...posControls().children] as HTMLElement[];
    up.click();
    expect(bottom()).toBe(16);
    down.click();
    expect(bottom()).toBe(10);
    expect(saved).toEqual([16, 10]);
  });

  it('ボタンが離されたまま pointermove が来たら（pointerup の取りこぼし）ドラッグを終えて 1 回保存する', () => {
    const saved = setup(10);
    pointer(handle(), 'pointerdown', 500);
    pointer(document, 'pointermove', 400);
    document.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1, button: 0, buttons: 0, clientY: 300, bubbles: true, composed: true, cancelable: true,
    }));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toBeCloseTo(20);
    pointer(document, 'pointermove', 100);
    expect(bottom()).toBeCloseTo(20);
    expect(saved).toHaveLength(1);
  });

  it('ドラッグ中に destroy しても、その後のポインタ操作で保存も例外も起きない', () => {
    const saved = setup(10);
    pointer(handle(), 'pointerdown', 500);
    pointer(document, 'pointermove', 400);
    overlay!.destroy();
    overlay = null;
    expect(() => {
      pointer(document, 'pointermove', 300);
      pointer(document, 'pointerup', 300);
    }).not.toThrow();
    expect(saved).toEqual([]);
  });

  describe('字幕ホバーの一時停止との関係', () => {
    let ends: Array<{ resume: boolean }>;

    const setupWithHover = (): void => {
      ends = [];
      overlay = createOverlay(
        { ...noopCallbacks(), onHoverEnd: (o) => void ends.push(o) },
        { bottomPercent: 10, onBottomChange: () => {} },
      );
      fixHostHeight(1000);
      overlay.renderLine('Hello, world.', tokenizeLine('Hello, world.'), 0);
    };
    const enter = (): void => void subtitleEl().dispatchEvent(new MouseEvent('mouseenter'));
    const leave = (): void => void subtitleEl().dispatchEvent(new MouseEvent('mouseleave'));

    it('つまみのドラッグ中に字幕枠を出ても通知せず、離したときに resume:true を 1 回通知する', () => {
      setupWithHover();
      enter();
      pointer(handle(), 'pointerdown', 500);
      pointer(document, 'pointermove', 400);
      leave();
      expect(ends).toEqual([]);
      pointer(document, 'pointerup', 400);
      expect(ends).toEqual([{ resume: true }]);
    });

    it('字幕枠から出ずに離したときは通知しない', () => {
      setupWithHover();
      enter();
      pointer(handle(), 'pointerdown', 500);
      pointer(document, 'pointermove', 400);
      pointer(document, 'pointerup', 400);
      expect(ends).toEqual([]);
    });

    // つまみのドラッグは clearLine 後も意図的に続く。clearLine の時点で resume:false が送られ
    // 一時停止の記録は消えているので、離したときの 2 回目（resume:true）は hoverPause.end の
    // `if (!v) return` で何もしない（勝手に再生は始まらない）。
    it('ドラッグ中に clearLine → 枠外へ出て離すと resume:false の後に resume:true を 1 回通知する', () => {
      setupWithHover();
      enter();
      pointer(handle(), 'pointerdown', 500);
      overlay!.clearLine();
      leave();
      pointer(document, 'pointerup', 500);
      expect(ends).toEqual([{ resume: false }, { resume: true }]);
    });
  });
});

describe('createOverlay — 字幕の下の巻き戻しボタン', () => {
  let overlay: Overlay | null = null;

  beforeEach(() => {
    document.body.replaceChildren();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  });

  afterEach(() => {
    overlay?.destroy();
    overlay = null;
  });

  const bar = (): HTMLElement => shadow().querySelector<HTMLElement>('.rewind-bar')!;
  const buttons = (): HTMLButtonElement[] =>
    [...bar().querySelectorAll<HTMLButtonElement>('.rewind-btn:not(.play-toggle):not(.list-toggle)')];

  it('↺5 と ↺10 のボタンが並ぶ', () => {
    overlay = createOverlay(noopCallbacks(), { bottomPercent: 10, onBottomChange: () => {} });
    expect(buttons().map((b) => b.textContent)).toEqual(['↺5', '↺10']);
    expect(buttons().map((b) => b.title)).toEqual(['5秒戻る', '10秒戻る']);
  });

  it('↺5・↺10・再生/一時停止・字幕位置のつまみの順に並ぶ', () => {
    overlay = createOverlay(noopCallbacks(), { bottomPercent: 10, onBottomChange: () => {} });
    const kids = [...bar().children] as HTMLElement[];
    expect(kids.map((k) => k.textContent)).toEqual(['↺5', '↺10', '', '⠿']);
    expect(kids[2].classList.contains('play-toggle')).toBe(true);
    expect(kids[3].classList.contains('pos-handle')).toBe(true);
    expect(kids[3].title).toBe('ドラッグで字幕を上下に移動');
  });

  it('再生/一時停止ボタンの中心が画面中央に来るよう、バーの右端を 50% + 56px に合わせる', () => {
    overlay = createOverlay(noopCallbacks(), { bottomPercent: 10, onBottomChange: () => {} });
    const css = shadow().querySelector('style')!.textContent ?? '';
    // 56 = ボタン幅 44 の半分 22 + すき間 6 + つまみ幅 28
    expect(css).toMatch(/\.rewind-bar \.bar-handle\s*\{[^}]*width:\s*28px/);
    expect(css).toMatch(/\.play-toggle\s*\{[^}]*width:\s*44px/);
    expect(css).toMatch(/\.rewind-bar\s*\{[^}]*gap:\s*6px/);
    expect(css).toMatch(/\.rewind-bar\s*\{[^}]*left:\s*50%;\s*transform:\s*translateX\(calc\(-100% \+ 56px\)\)/);
  });

  describe('字幕リストの開閉ボタン', () => {
    const listToggle = (): HTMLButtonElement | null =>
      bar().querySelector<HTMLButtonElement>('.list-toggle');
    const withList = (onToggleTranscript: () => void = () => {}): Overlay =>
      createOverlay(
        { ...noopCallbacks(), onToggleTranscript },
        { bottomPercent: 10, onBottomChange: () => {} },
      );

    it('onToggleTranscript 指定時は再生/一時停止とつまみの間に並ぶ', () => {
      overlay = withList();
      const kids = [...bar().children] as HTMLElement[];
      expect(kids).toHaveLength(5);
      expect(kids[2].classList.contains('play-toggle')).toBe(true);
      expect(kids[3].classList.contains('list-toggle')).toBe(true);
      expect(kids[4].classList.contains('pos-handle')).toBe(true);
      expect(bar().classList.contains('has-list')).toBe(true);
    });

    it('onToggleTranscript 未指定ならボタンを出さず、配置も従来どおり', () => {
      overlay = createOverlay(noopCallbacks(), { bottomPercent: 10, onBottomChange: () => {} });
      expect(listToggle()).toBeNull();
      expect(bar().classList.contains('has-list')).toBe(false);
    });

    it('再生/一時停止ボタンが中央に残るよう、ボタンありではバーの右端を 50% + 98px に合わせる', () => {
      overlay = withList();
      const css = shadow().querySelector('style')!.textContent ?? '';
      // 98 = 再生ボタン幅 44 の半分 22 + すき間 6 + 開閉ボタン幅 36 + すき間 6 + つまみ幅 28
      expect(css).toMatch(/\.list-toggle\s*\{[^}]*width:\s*36px/);
      expect(css).toMatch(/\.rewind-bar\.has-list\s*\{[^}]*transform:\s*translateX\(calc\(-100% \+ 98px\)\)/);
    });

    it('クリックで onToggleTranscript が呼ばれる', () => {
      let toggles = 0;
      overlay = withList(() => toggles++);
      listToggle()!.click();
      expect(toggles).toBe(1);
    });

    it('初期は閉じた状態で、setTranscriptOpen で点灯とラベルが切り替わる', () => {
      overlay = withList();
      const btn = listToggle()!;
      expect(btn.classList.contains('open')).toBe(false);
      expect(btn.getAttribute('aria-pressed')).toBe('false');
      expect(btn.title).toBe('字幕リストを開く');
      expect(btn.querySelector('svg')).not.toBeNull();
      overlay.setTranscriptOpen(true);
      expect(btn.classList.contains('open')).toBe(true);
      expect(btn.getAttribute('aria-pressed')).toBe('true');
      expect(btn.title).toBe('字幕リストを閉じる');
      expect(btn.getAttribute('aria-label')).toBe('字幕リストを閉じる');
      overlay.setTranscriptOpen(false);
      expect(btn.classList.contains('open')).toBe(false);
      expect(btn.title).toBe('字幕リストを開く');
    });

    it('ボタンが無いときの setTranscriptOpen は例外を出さない', () => {
      overlay = createOverlay(noopCallbacks(), { bottomPercent: 10, onBottomChange: () => {} });
      expect(() => overlay!.setTranscriptOpen(true)).not.toThrow();
    });

    it('mousedown の既定動作を止め、クリックでフォーカスを取らない', () => {
      overlay = withList();
      const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      listToggle()!.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
    });

    it('クリックで開いている単語ポップアップを閉じる', () => {
      overlay = withList();
      overlay.openPopup(new DOMRect(0, 0, 10, 10), 'Hello');
      listToggle()!.click();
      expect(shadow().querySelector('.popup')).toBeNull();
    });
  });

  describe('再生/一時停止ボタン', () => {
    const toggle = (): HTMLButtonElement => bar().querySelector<HTMLButtonElement>('.play-toggle')!;

    it('初期状態は再生中とみなし、一時停止ボタンとして表示する', () => {
      overlay = createOverlay(noopCallbacks(), { bottomPercent: 10, onBottomChange: () => {} });
      expect(toggle().title).toBe('一時停止');
      expect(toggle().getAttribute('aria-label')).toBe('一時停止');
      expect(toggle().querySelectorAll('svg path')).toHaveLength(2);
    });

    it('setPlaying(false) で再生ボタン、setPlaying(true) で一時停止ボタンに切り替わる', () => {
      overlay = createOverlay(noopCallbacks(), { bottomPercent: 10, onBottomChange: () => {} });
      overlay.setPlaying(false);
      expect(toggle().title).toBe('再生');
      expect(toggle().querySelectorAll('svg path')).toHaveLength(1);
      overlay.setPlaying(true);
      expect(toggle().title).toBe('一時停止');
      expect(toggle().querySelectorAll('svg path')).toHaveLength(2);
    });

    it('クリックで onTogglePlay が呼ばれ、巻き戻しは呼ばれない', () => {
      let toggles = 0;
      const rewinds: number[] = [];
      overlay = createOverlay(
        { ...noopCallbacks(), onTogglePlay: () => toggles++, onRewind: (s) => rewinds.push(s) },
        { bottomPercent: 10, onBottomChange: () => {} },
      );
      toggle().click();
      expect(toggles).toBe(1);
      expect(rewinds).toEqual([]);
    });

    it('onTogglePlay 未指定でもクリックで例外を出さない', () => {
      overlay = createOverlay(noopCallbacks(), { bottomPercent: 10, onBottomChange: () => {} });
      expect(() => toggle().click()).not.toThrow();
    });

    it('mousedown の既定動作を止め、クリックでフォーカスを取らない', () => {
      overlay = createOverlay(noopCallbacks(), { bottomPercent: 10, onBottomChange: () => {} });
      const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      toggle().dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
    });

    it('クリックで開いている単語ポップアップを閉じる', () => {
      overlay = createOverlay(noopCallbacks(), { bottomPercent: 10, onBottomChange: () => {} });
      overlay.openPopup(new DOMRect(0, 0, 10, 10), 'Hello');
      toggle().click();
      expect(shadow().querySelector('.popup')).toBeNull();
    });
  });

  describe('下のつまみのドラッグ', () => {
    const barHandle = (): HTMLElement => bar().querySelector<HTMLElement>('.pos-handle')!;
    const bottom = (): number =>
      parseFloat(shadow().querySelector<HTMLElement>('.subtitle')!.style.bottom);
    const pointer = (target: EventTarget, type: string, clientY: number): PointerEvent => {
      const e = new PointerEvent(type, {
        pointerId: 1, button: 0, clientY, bubbles: true, composed: true, cancelable: true,
        buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
      });
      target.dispatchEvent(e);
      return e;
    };
    const setup = (): number[] => {
      const saved: number[] = [];
      overlay = createOverlay(noopCallbacks(), {
        bottomPercent: 10,
        onBottomChange: (p) => saved.push(p),
      });
      document.getElementById(HOST_ID)!.getBoundingClientRect = () => new DOMRect(0, 0, 800, 1000);
      overlay.renderLine('Hello, world.', tokenizeLine('Hello, world.'), 0);
      return saved;
    };

    it('ドラッグで字幕とバーが一緒に動き、離したときに 1 回だけ保存する', () => {
      const saved = setup();
      const down = pointer(barHandle(), 'pointerdown', 500);
      expect(down.defaultPrevented).toBe(true);
      pointer(document, 'pointermove', 400);
      expect(bottom()).toBeCloseTo(20);
      expect(parseFloat(bar().style.getPropertyValue('--sub-bottom'))).toBeCloseTo(20);
      expect(saved).toEqual([]);
      pointer(document, 'pointerup', 400);
      expect(saved).toHaveLength(1);
      expect(saved[0]).toBeCloseTo(20);
    });

    it('字幕が消えている合間でもドラッグできる', () => {
      const saved = setup();
      overlay!.clearLine();
      pointer(barHandle(), 'pointerdown', 500);
      pointer(document, 'pointermove', 300);
      pointer(document, 'pointerup', 300);
      expect(saved).toHaveLength(1);
      expect(saved[0]).toBeCloseTo(30);
    });

    it('つまみを押しても巻き戻しは呼ばれない', () => {
      const rewinds: number[] = [];
      overlay = createOverlay(
        { ...noopCallbacks(), onRewind: (s) => rewinds.push(s) },
        { bottomPercent: 10, onBottomChange: () => {} },
      );
      barHandle().click();
      expect(rewinds).toEqual([]);
    });
  });

  it('クリックで onRewind が 5 / 10 で呼ばれる', () => {
    const rewinds: number[] = [];
    overlay = createOverlay(
      { ...noopCallbacks(), onRewind: (s) => rewinds.push(s) },
      { bottomPercent: 10, onBottomChange: () => {} },
    );
    buttons()[0].click();
    buttons()[1].click();
    expect(rewinds).toEqual([5, 10]);
  });

  it('onRewind 未指定でもクリックで例外を出さない', () => {
    overlay = createOverlay(noopCallbacks(), { bottomPercent: 10, onBottomChange: () => {} });
    expect(() => buttons()[0].click()).not.toThrow();
  });

  it('字幕の直後に置かれ、字幕の子ではない（字幕が消えても残るため）', () => {
    overlay = createOverlay(noopCallbacks(), { bottomPercent: 10, onBottomChange: () => {} });
    expect(bar()).not.toBeNull();
    const subtitle = shadow().querySelector<HTMLElement>('.subtitle')!;
    expect(subtitle.contains(bar())).toBe(false);
    expect(subtitle.nextElementSibling).toBe(bar());
  });

  it('最初の字幕が出るまでは隠れている（Prime のホームや詳細ページで出さない）', () => {
    overlay = createOverlay(noopCallbacks(), { bottomPercent: 10, onBottomChange: () => {} });
    expect(bar().hidden).toBe(true);
  });

  it('renderLine で表示される', () => {
    overlay = createOverlay(noopCallbacks(), { bottomPercent: 10, onBottomChange: () => {} });
    overlay.renderLine('Hello, world.', tokenizeLine('Hello, world.'), 0);
    expect(bar().hidden).toBe(false);
  });

  it('hidden のときは CSS で非表示になる（display: flex に負けない）', () => {
    overlay = createOverlay(noopCallbacks(), { bottomPercent: 10, onBottomChange: () => {} });
    const css = shadow().querySelector('style')!.textContent ?? '';
    expect(css).toMatch(/\.rewind-bar\[hidden\]\s*\{\s*display:\s*none;?\s*\}/);
  });

  it('mousedown の既定動作を止め、クリックでフォーカスを取らない（Space で再度押されないため）', () => {
    overlay = createOverlay(noopCallbacks(), { bottomPercent: 10, onBottomChange: () => {} });
    for (const btn of buttons()) {
      const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      btn.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
    }
  });

  it('クリックで開いている単語ポップアップを閉じてから onRewind を呼ぶ', () => {
    const rewinds: number[] = [];
    overlay = createOverlay(
      { ...noopCallbacks(), onRewind: (s) => rewinds.push(s) },
      { bottomPercent: 10, onBottomChange: () => {} },
    );
    overlay.openPopup(new DOMRect(0, 0, 10, 10), 'Hello');
    expect(shadow().querySelector('.popup')).not.toBeNull();
    buttons()[0].click();
    expect(shadow().querySelector('.popup')).toBeNull();
    expect(rewinds).toEqual([5]);
  });

  it('clearLine で字幕が隠れてもバーは表示されたまま', () => {
    overlay = createOverlay(noopCallbacks(), { bottomPercent: 10, onBottomChange: () => {} });
    overlay.renderLine('Hello, world.', tokenizeLine('Hello, world.'), 0);
    overlay.clearLine();
    expect(shadow().querySelector<HTMLElement>('.subtitle')!.hidden).toBe(true);
    expect(bar().hidden).toBe(false);
  });

  it('字幕の縦位置を CSS 変数で受け取り、▲▼で字幕と一緒に動く', () => {
    overlay = createOverlay(noopCallbacks(), { bottomPercent: 10, onBottomChange: () => {} });
    expect(bar().style.getPropertyValue('--sub-bottom')).toBe('10%');
    const up = shadow().querySelector<HTMLButtonElement>('.pos-btn')!; // 先頭は ▲
    up.click();
    expect(bar().style.getPropertyValue('--sub-bottom')).toBe('16%');
  });
});
