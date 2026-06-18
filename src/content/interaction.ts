import type { Overlay } from './overlay';
import type { Settings } from '../shared/types';
import { pauseVideo } from './videoControl';
import { sendRequest } from '../shared/messages';

/**
 * 単語/フレーズの意味引きを実行する。
 * 自動一時停止 → ローディング表示 → AI へ問い合わせ → 結果 / エラー表示。
 */
export async function runLookup(
  overlay: Overlay,
  settings: Settings,
  selection: string,
  sentence: string,
  anchor: DOMRect,
): Promise<void> {
  if (!selection.trim()) return;
  if (settings.autoPauseOnClick) pauseVideo();
  overlay.showPopupLoading(anchor, selection);
  const res = await sendRequest({ type: 'explainSelection', selection, context: sentence });
  if (res.ok) overlay.showPopupResult(anchor, selection, res.text);
  else overlay.showPopupError(anchor, res.error);
}
