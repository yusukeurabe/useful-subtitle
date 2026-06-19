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

/**
 * Prime の再生/一時停止トグルボタン候補（先頭から順に探す）。
 * 生の <video>.play() は Prime に握り潰されることがあるため、再生再開は
 * Prime 自身のこのボタンを押して状態機械ごと動かす。
 */
export const PLAYPAUSE_BUTTON_SELECTORS: readonly string[] = [
  '.atvwebplayersdk-playpause-button',
  '[class*="playpause"]',
  '[aria-label="再生"]',
  '[aria-label="Play"]',
];

/** カスタム字幕オーバーレイの取り付け先候補（先頭から順に探す）。 */
export const PLAYER_CONTAINER_SELECTORS: readonly string[] = [
  '.atvwebplayersdk-player-container',
  '.webPlayerSDKContainer',
  '#dv-web-player',
  '.dv-player-fullscreen',
];
