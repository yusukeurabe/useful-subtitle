/**
 * Prime Video 上の DOM セレクタ。Amazon のプレイヤー更新で変わり得るため、
 * 字幕テキストは優先順のフォールバック配列で持つ（先頭が確認済みの本命）。
 */
export const CAPTION_TEXT_SELECTORS: readonly string[] = [
  '.atvwebplayersdk-captions-text',
  '[class*="captions-text"]',
  '[class*="atvwebplayersdk-captions"] span',
];

export const VIDEO_SELECTOR = 'video';

/** カスタム字幕オーバーレイの取り付け先候補（先頭から順に探す）。 */
export const PLAYER_CONTAINER_SELECTORS: readonly string[] = [
  '.atvwebplayersdk-player-container',
  '.webPlayerSDKContainer',
  '#dv-web-player',
  '.dv-player-fullscreen',
];
