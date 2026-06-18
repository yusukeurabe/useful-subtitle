/** 解説の言語。MVP では 'ja'（日本語）を既定とする。 */
export type ExplanationLanguage = 'ja' | 'en' | 'both';

/** AI プロバイダ。将来 'openai' を追加できるよう型で表現しておく。 */
export type AiProvider = 'anthropic';

/** ユーザー設定（chrome.storage.local に保存）。 */
export interface Settings {
  apiKey: string;
  provider: AiProvider;
  model: string;
  explanationLanguage: ExplanationLanguage;
  /** 字幕一文の日本語訳を併記する（デュアル字幕）。 */
  dualSubtitle: boolean;
  /** 単語クリック時に動画を自動で一時停止する。 */
  autoPauseOnClick: boolean;
  /** 拡張機能全体のオン/オフ。 */
  enabled: boolean;
}

/** content script → service worker のリクエスト。 */
export interface TranslateLineRequest {
  type: 'translateLine';
  text: string;
}
export interface ExplainSelectionRequest {
  type: 'explainSelection';
  selection: string;
  context: string;
}
/** 設定画面の「接続テスト」で使う疎通確認。 */
export interface PingRequest {
  type: 'ping';
}
export type RequestMessage =
  | TranslateLineRequest
  | ExplainSelectionRequest
  | PingRequest;

/** service worker → content script のレスポンス。 */
export type ErrorCode = 'NO_API_KEY' | 'AUTH' | 'RATE_LIMIT' | 'NETWORK' | 'UNKNOWN';

export interface SuccessResponse {
  ok: true;
  text: string;
}
export interface ErrorResponse {
  ok: false;
  code: ErrorCode;
  error: string;
}
export type ResponseMessage = SuccessResponse | ErrorResponse;
