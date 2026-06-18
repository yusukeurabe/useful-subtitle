import type { ErrorCode } from '../shared/types';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 1024;

/** AI 呼び出しの失敗を、UI に出し分けやすいコード付きで表す。 */
export class AiError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'AiError';
    this.code = code;
  }
}

export interface AnthropicParams {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}

/** fetch に渡す URL と init を組み立てる（純粋関数・テスト容易）。 */
export function buildAnthropicRequest(params: AnthropicParams): {
  url: string;
  init: RequestInit;
} {
  const body = {
    model: params.model,
    max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
    system: params.system,
    messages: [{ role: 'user', content: params.user }],
  };
  return {
    url: ANTHROPIC_URL,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': params.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        // ブラウザ起点（拡張の Service Worker）からの呼び出しを許可する必須ヘッダ。
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    },
  };
}

interface AnthropicResponseShape {
  content?: Array<{ type: string; text?: string }>;
}

/** Messages API の応答から本文テキストを取り出す。 */
export function parseAnthropicResponse(json: unknown): string {
  const blocks = (json as AnthropicResponseShape | null)?.content ?? [];
  return blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('')
    .trim();
}

function codeForStatus(status: number): ErrorCode {
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 429) return 'RATE_LIMIT';
  return 'UNKNOWN';
}

/**
 * Anthropic Messages API を呼び、本文テキストを返す。
 * 失敗時は AiError（code 付き）を投げる。fetch は注入可能（テスト用）。
 */
export async function callAnthropic(
  params: AnthropicParams,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const { url, init } = buildAnthropicRequest(params);

  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch (e) {
    throw new AiError('NETWORK', `ネットワークエラー: ${(e as Error).message}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new AiError(
      codeForStatus(res.status),
      `APIエラー (${res.status}): ${detail.slice(0, 200)}`,
    );
  }

  const json = await res.json().catch(() => null);
  const text = parseAnthropicResponse(json);
  if (!text) {
    throw new AiError('UNKNOWN', 'AI から空の応答が返りました。');
  }
  return text;
}
