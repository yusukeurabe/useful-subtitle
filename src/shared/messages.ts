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
    return {
      ok: false,
      code: 'UNKNOWN',
      error: (e as Error)?.message ?? 'メッセージの送信に失敗しました',
    };
  }
}
