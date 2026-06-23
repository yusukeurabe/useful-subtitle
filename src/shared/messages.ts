import type {
  RequestMessage,
  ResponseMessage,
  TranslateLineRequest,
  ExplainSelectionRequest,
  ExplainSentenceRequest,
  PingRequest,
  LookupWordRequest,
  PlayAudioRequest,
  WordInfoResponse,
  AudioResponse,
  ErrorResponse,
} from './types';

const REQUEST_RELOAD_MSG =
  '拡張機能が更新されました。このタブを再読み込み（F5）してください。';

/**
 * sendMessage の例外を ErrorResponse に正規化する純関数。
 * 拡張機能を再読込／更新したあと、ページに残った古い content script から
 * runtime を叩くと "Extension context invalidated" になる。生英文を UI に
 * 出してもユーザーは何をすればよいか分からないので、ここで日本語ガイドに
 * 置き換える（runtimeId が無い場合も同じ救済を出す）。
 */
export function normalizeSendError(
  err: unknown,
  runtimeId: string | undefined,
): ErrorResponse {
  const raw = (err as { message?: unknown } | null | undefined)?.message;
  const text = typeof raw === 'string' ? raw : undefined;
  if (!runtimeId || (text && /context invalidated/i.test(text))) {
    return {
      ok: false,
      code: 'CONTEXT_INVALIDATED',
      error: REQUEST_RELOAD_MSG,
    };
  }
  return {
    ok: false,
    code: 'UNKNOWN',
    error: text || 'メッセージの送信に失敗しました',
  };
}

/**
 * content script / options ページから service worker へリクエストを送り、
 * 型付きのレスポンスを受け取る。送信自体の失敗も ErrorResponse に正規化する。
 */
export function sendRequest(req: LookupWordRequest): Promise<WordInfoResponse | ErrorResponse>;
export function sendRequest(req: PlayAudioRequest): Promise<AudioResponse | ErrorResponse>;
export function sendRequest(
  req: TranslateLineRequest | ExplainSelectionRequest | ExplainSentenceRequest | PingRequest,
): Promise<ResponseMessage>;
export async function sendRequest(
  req: RequestMessage,
): Promise<ResponseMessage | WordInfoResponse | AudioResponse> {
  try {
    return (await chrome.runtime.sendMessage(req)) as
      | ResponseMessage
      | WordInfoResponse
      | AudioResponse;
  } catch (e) {
    return normalizeSendError(e, chrome.runtime?.id);
  }
}
