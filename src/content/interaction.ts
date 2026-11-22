import type { Overlay } from './overlay';
import type { Settings } from '../shared/types';
import { pauseVideo } from './videoControl';
import { sendRequest } from '../shared/messages';
import { loadWordInfo } from './word';
import { parseExplanation, parseSentenceMeaning } from '../shared/explanation';

/**
 * ポップアップ下段に、いま表示中の字幕一文の和訳＋解説を出す（字幕一覧のホバーと同じ explainSentence）。
 * 単語の解説を先に頼んでから呼ぶので、単語の意味が先に届く。
 */
async function loadSentenceMeaning(overlay: Overlay, sentence: string, popupToken: number): Promise<void> {
  if (!sentence.trim()) return;
  overlay.setPopupSentence(null);
  const res = await sendRequest({ type: 'explainSentence', text: sentence });
  if (!overlay.isPopupCurrent(popupToken)) return;
  if (res.ok) {
    const { translation, explanation } = parseSentenceMeaning(res.text);
    overlay.setPopupSentence({ ok: true, translation, explanation });
  } else {
    overlay.setPopupSentence({ ok: false, error: res.error });
  }
}

/**
 * 単語/フレーズの意味引きを実行する。
 * 自動一時停止 → ポップアップを開く → 発音情報の先読み（並行） → AI 解説の表示。
 * 下段には字幕一文の和訳＋解説を並行して取得・表示する。
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
  const popupToken = overlay.openPopup(anchor, selection);
  // 発音記号・音源URLの先読み（意味取得と独立・並行）。
  void loadWordInfo(overlay, selection, popupToken);
  const word = sendRequest({ type: 'explainSelection', selection, context: sentence });
  void loadSentenceMeaning(overlay, sentence, popupToken);
  const res = await word;
  if (!overlay.isPopupCurrent(popupToken)) return;
  if (res.ok) {
    const { senses, explanation } = parseExplanation(res.text);
    overlay.setPopupMeaning(explanation, senses);
  } else {
    overlay.setPopupError(res.error);
  }
}
