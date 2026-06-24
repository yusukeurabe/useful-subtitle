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
