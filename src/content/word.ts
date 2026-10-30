import type { Overlay } from './overlay';
import { isSingleWord } from '../shared/dictionary';
import { sendRequest } from '../shared/messages';

/**
 * 単語のとき辞書情報（IPA＋音源URL）を取得し、ポップアップに反映する。
 * フレーズ・取得失敗時は IPA なし／音源なしとして扱う（🔊 は TTS にフォールバック）。
 */
export async function loadWordInfo(overlay: Overlay, selection: string, popupToken: number): Promise<void> {
  if (!overlay.isPopupCurrent(popupToken)) return;
  if (!isSingleWord(selection)) {
    overlay.setPopupWordInfo(null, null);
    return;
  }
  const res = await sendRequest({ type: 'lookupWord', text: selection });
  if (!overlay.isPopupCurrent(popupToken)) return;
  if (res.ok && res.kind === 'word') {
    overlay.setPopupWordInfo(res.ipa, res.audioUrl);
  } else {
    overlay.setPopupWordInfo(null, null);
  }
}
