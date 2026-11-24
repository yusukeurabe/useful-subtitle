import type { Overlay, PopupAction } from './overlay';
import type { CaptionNeighbors, ErrorResponse, Settings } from '../shared/types';
import { pauseVideo } from './videoControl';
import { sendRequest } from '../shared/messages';
import { loadWordInfo } from './word';
import { parseExplanation, parseSentenceMeaning } from '../shared/explanation';

const LOGIN_LABEL = 'ブラウザでログイン';
const LOGIN_WAITING = 'ブラウザでログインを完了してください…';

/**
 * AUTH エラーのときだけ「ブラウザでログイン」ボタンを作る。押すと公式 CLI のログインを起動し、
 * 成功してポップアップがまだ同じなら retry（意味引きのやり直し）を呼ぶ。show はボタンを出す場所（上段/下段）。
 */
function loginAction(
  res: ErrorResponse,
  overlay: Overlay,
  popupToken: number,
  show: (message: string, action?: PopupAction) => void,
  retry: () => void,
): PopupAction | undefined {
  if (res.code !== 'AUTH') return undefined;
  const action: PopupAction = {
    label: LOGIN_LABEL,
    onClick: () => {
      show(res.error, { label: LOGIN_WAITING });
      void sendRequest({ type: 'login' }).then((login) => {
        if (!overlay.isPopupCurrent(popupToken)) return;
        if (login.ok) retry();
        // ログイン失敗は code が何であっても（CANCELED / UNKNOWN 等）ボタンを出し直す。
        else show(login.error, loginAction({ ...login, code: 'AUTH' }, overlay, popupToken, show, retry));
      });
    },
  };
  return action;
}

/**
 * ポップアップ下段に、いま表示中の字幕一文の和訳＋解説を出す（字幕一覧のホバーと同じ explainSentence）。
 * 単語の解説を先に頼んでから呼ぶので、単語の意味が先に届く。
 */
async function loadSentenceMeaning(
  overlay: Overlay,
  sentence: string,
  neighbors: CaptionNeighbors,
  popupToken: number,
  retry: () => void,
): Promise<void> {
  if (!sentence.trim()) return;
  overlay.setPopupSentence(null);
  const res = await sendRequest({ type: 'explainSentence', text: sentence, ...neighbors });
  if (!overlay.isPopupCurrent(popupToken)) return;
  if (res.ok) {
    const { translation, explanation } = parseSentenceMeaning(res.text);
    overlay.setPopupSentence({ ok: true, translation, explanation });
  } else {
    const show = (error: string, action?: PopupAction): void => overlay.setPopupSentence({ ok: false, error, action });
    show(res.error, loginAction(res, overlay, popupToken, show, retry));
  }
}

/**
 * 単語/フレーズの意味引きを実行する。
 * 自動一時停止 → ポップアップを開く → 発音情報の先読み（並行） → AI 解説の表示。
 * 下段には字幕一文の和訳＋解説を並行して取得・表示する。
 * neighbors は前後の字幕。文やフレーズが字幕をまたいで切れていても正しい意味を出すために渡す。
 */
export async function runLookup(
  overlay: Overlay,
  settings: Settings,
  selection: string,
  sentence: string,
  anchor: DOMRect,
  neighbors: CaptionNeighbors = {},
): Promise<void> {
  if (!selection.trim()) return;
  if (settings.autoPauseOnClick) pauseVideo();
  const popupToken = overlay.openPopup(anchor, selection);
  // 発音記号・音源URLの先読み（意味取得と独立・並行）。
  void loadWordInfo(overlay, selection, popupToken);
  const word = sendRequest({ type: 'explainSelection', selection, context: sentence, ...neighbors });
  // ログイン成功後のやり直し。同じ選択・字幕・前後の字幕で意味引きを最初からかけ直す。
  const retry = (): void => {
    void runLookup(overlay, settings, selection, sentence, anchor, neighbors);
  };
  void loadSentenceMeaning(overlay, sentence, neighbors, popupToken, retry);
  const res = await word;
  if (!overlay.isPopupCurrent(popupToken)) return;
  if (res.ok) {
    const { senses, explanation } = parseExplanation(res.text);
    overlay.setPopupMeaning(explanation, senses);
  } else {
    const show = (error: string, action?: PopupAction): void => overlay.setPopupError(error, action);
    show(res.error, loginAction(res, overlay, popupToken, show, retry));
  }
}
