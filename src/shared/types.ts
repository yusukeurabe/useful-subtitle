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
  /** 字幕の大小文字をローカルで自動整形する（簡易 truecasing）。 */
  truecaseSubtitle: boolean;
  /** カスタム字幕の画面下からの位置（％）。 */
  subtitleBottomPercent: number;
  /** 右側の字幕履歴パネルを表示する。 */
  showTranscriptPanel: boolean;
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
/** 字幕一文まるごとの意味（和訳＋解説）を問う。履歴行ホバーで使う。 */
export interface ExplainSentenceRequest {
  type: 'explainSentence';
  text: string;
}
/** 設定画面の「接続テスト」で使う疎通確認。 */
export interface PingRequest {
  type: 'ping';
}
export interface LookupWordRequest {
  type: 'lookupWord';
  text: string;
}
export interface PlayAudioRequest {
  type: 'playAudio';
  url: string;
}
export type RequestMessage =
  | TranslateLineRequest
  | ExplainSelectionRequest
  | ExplainSentenceRequest
  | PingRequest
  | LookupWordRequest
  | PlayAudioRequest;

/** service worker → content script のレスポンス。 */
export type ErrorCode =
  | 'NO_API_KEY'
  | 'AUTH'
  | 'RATE_LIMIT'
  | 'NETWORK'
  | 'CONTEXT_INVALIDATED'
  | 'UNKNOWN';

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

/** lookupWord の応答（APIキー不要）。発音記号と音源URL。 */
export interface WordInfoResponse {
  ok: true;
  kind: 'word';
  ipa: string | null;
  audioUrl: string | null;
}
/** playAudio の応答。played:true=offscreen でネイティブ音源を再生開始。 */
export interface AudioResponse {
  ok: true;
  kind: 'audio';
  played: boolean;
}
