// offscreen document: 拡張オリジンで音声を再生し、ページ(CSP)の影響を受けない。
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

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (!isPlayMessage(message)) return;
  const audio = new Audio(message.url);
  void audio.play().catch((e) => {
    console.warn('[Useful Subtitle] offscreen 再生に失敗', e);
  });
});
