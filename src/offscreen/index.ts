// offscreen document: 拡張オリジンで音声を再生し、ページ(CSP)の影響を受けない。
import { createAudioPlayer } from './play';

interface OffscreenPlayMessage {
  target: 'offscreen';
  url: string;
}

function isPlayMessage(m: unknown): m is OffscreenPlayMessage {
  return (
    typeof m === 'object' &&
    m !== null &&
    (m as { target?: unknown }).target === 'offscreen' &&
    typeof (m as { url?: unknown }).url === 'string'
  );
}

const play = createAudioPlayer();

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isPlayMessage(message)) return;
  // 再生の成否を service worker に返す（失敗なら content 側で TTS にフォールバック）。
  void play(message.url).then((result) => {
    if (!result.played) console.warn('[Useful Subtitle] offscreen 再生に失敗', result.error);
    sendResponse(result);
  });
  return true;
});
