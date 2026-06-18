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
