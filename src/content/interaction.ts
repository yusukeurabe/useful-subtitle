import type { Overlay, PopupAction } from './overlay';
import type { CaptionNeighbors, ErrorResponse, Settings } from '../shared/types';
import { pauseVideo } from './videoControl';
import { sendRequest } from '../shared/messages';
import { loadWordInfo } from './word';
import { parseExplanation, parseSentenceMeaning } from '../shared/explanation';

const LOGIN_LABEL = 'ブラウザでログイン';
const LOGIN_WAITING = 'ブラウザでログインを完了してください…';

type ShowError = (message: string, action?: PopupAction) => void;
/** ログインの案内を出せる場所（上段の単語解説/下段の字幕一文）。error はその段に出しているエラー文。 */
interface LoginSection {
  show: ShowError;
  error: string;
}
interface LoginOffer {
  /** エラーを出す。ボタンを出せる条件（サブスク接続の AUTH）ならログインボタンも添える。 */
  showError(res: ErrorResponse, show: ShowError): void;
}

/**
 * 1 回の意味引き（ポップアップ）ごとのログイン状態。上段・下段のボタンで共有し、
 * どちらを押してもログイン依頼は 1 回だけ・両段そろって待機表示にする。
 * ボタンは Claude サブスク接続（enabled）の AUTH エラーのときだけ出す（API キーの AUTH はキーの誤りなので出さない）。
 * 成功してポップアップがまだ同じなら retry（意味引きのやり直し）を 1 回だけ呼ぶ。
 */
function createLoginOffer(overlay: Overlay, popupToken: number, enabled: boolean, retry: () => void): LoginOffer {
  const sections: LoginSection[] = [];
  let inProgress = false;
  const waiting = (): PopupAction => ({ label: LOGIN_WAITING });
  // code を見ずにボタンを作る。出すかどうかは呼び出し側で決める。
  const button = (): PopupAction => ({ label: LOGIN_LABEL, onClick: start });
  function start(): void {
    if (inProgress) return;
    inProgress = true;
    for (const section of sections) section.show(section.error, waiting());
    void sendRequest({ type: 'login' }).then((login) => {
      inProgress = false;
      if (!overlay.isPopupCurrent(popupToken)) return;
      if (login.ok) {
        retry();
        return;
      }
      // ログインの失敗（AUTH）と取り消し（CANCELED）だけ押し直せるようにする。
      // 拡張の再読み込み（CONTEXT_INVALIDATED）などはボタンを押しても直らないので文言だけ出す。
      const again = login.code === 'AUTH' || login.code === 'CANCELED';
      for (const section of sections) {
        section.error = login.error;
        section.show(login.error, again ? button() : undefined);
      }
    });
  }
  return {
    showError(res, show) {
      if (!enabled || res.code !== 'AUTH') {
        show(res.error);
        return;
      }
      sections.push({ show, error: res.error });
      show(res.error, inProgress ? waiting() : button());
    },
  };
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
  login: LoginOffer,
): Promise<void> {
  if (!sentence.trim()) return;
  overlay.setPopupSentence(null);
  const res = await sendRequest({ type: 'explainSentence', text: sentence, ...neighbors });
  if (!overlay.isPopupCurrent(popupToken)) return;
  if (res.ok) {
    const { translation, explanation } = parseSentenceMeaning(res.text);
    overlay.setPopupSentence({ ok: true, translation, explanation });
  } else {
    login.showError(res, (error, action) => overlay.setPopupSentence({ ok: false, error, action }));
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
  const login = createLoginOffer(overlay, popupToken, settings.provider === 'claude-subscription', retry);
  void loadSentenceMeaning(overlay, sentence, neighbors, popupToken, login);
  const res = await word;
  if (!overlay.isPopupCurrent(popupToken)) return;
  if (res.ok) {
    const { senses, explanation } = parseExplanation(res.text);
    overlay.setPopupMeaning(explanation, senses);
  } else {
    login.showError(res, (error, action) => overlay.setPopupError(error, action));
  }
}
