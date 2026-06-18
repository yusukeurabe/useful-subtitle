import type { Overlay } from './overlay';
import type { Settings } from '../shared/types';
import { pauseVideo } from './videoControl';
import { sendRequest } from '../shared/messages';
import { loadWordInfo } from './word';

/**
 * 単語/フレーズの意味引きを実行する。
 * 自動一時停止 → ポップアップを開く → 発音情報の先読み（並行） → AI 解説の表示。
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
  overlay.openPopup(anchor, selection);
  // 発音記号・音源URLの先読み（意味取得と独立・並行）。
  void loadWordInfo(overlay, selection);
  const res = await sendRequest({ type: 'explainSelection', selection, context: sentence });
  if (res.ok) overlay.setPopupMeaning(res.text);
  else overlay.setPopupError(res.error);
}
