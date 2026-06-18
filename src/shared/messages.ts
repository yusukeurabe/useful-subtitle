import type { RequestMessage, ResponseMessage } from './types';

/**
 * content script / options ページから service worker へリクエストを送り、
 * 型付きのレスポンスを受け取る。送信自体の失敗も ErrorResponse に正規化する。
 */
export async function sendRequest(req: RequestMessage): Promise<ResponseMessage> {
  try {
    return (await chrome.runtime.sendMessage(req)) as ResponseMessage;
  } catch (e) {
    return {
      ok: false,
      code: 'UNKNOWN',
      error: (e as Error)?.message ?? 'メッセージの送信に失敗しました',
    };
  }
}
