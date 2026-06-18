import { buildTranslationPrompt, buildExplanationPrompt } from '../shared/prompts';
import { makeCacheKey } from './cache';
import { AiError, type AnthropicParams } from './aiClient';
import type { RequestMessage, ResponseMessage, Settings } from '../shared/types';

/** handleRequest が依存する外部境界（設定・キャッシュ・AI 呼び出し）。テストで差し替え可能。 */
export interface HandlerDeps {
  getSettings: () => Promise<Settings>;
  getCached: (key: string) => Promise<string | undefined>;
  setCached: (key: string, value: string) => Promise<void>;
  callAi: (params: AnthropicParams) => Promise<string>;
}

/**
 * content script からのリクエストを処理して応答を返す。
 * APIキー確認 → （翻訳/解説は）キャッシュ確認 → AI 呼び出し → キャッシュ保存。
 */
export async function handleRequest(
  req: RequestMessage,
  deps: HandlerDeps,
): Promise<ResponseMessage> {
  const settings = await deps.getSettings();
  if (!settings.apiKey) {
    return {
      ok: false,
      code: 'NO_API_KEY',
      error: 'APIキーが未設定です。拡張機能の設定画面で入力してください。',
    };
  }

  try {
    if (req.type === 'ping') {
      const text = await deps.callAi({
        apiKey: settings.apiKey,
        model: settings.model,
        system: 'Reply with the single word: OK',
        user: 'ping',
        maxTokens: 16,
      });
      return { ok: true, text };
    }

    const key = makeCacheKey(req, settings.model, settings.explanationLanguage);
    const cached = await deps.getCached(key);
    if (cached !== undefined) {
      return { ok: true, text: cached };
    }

    const prompt =
      req.type === 'translateLine'
        ? buildTranslationPrompt(req.text)
        : buildExplanationPrompt(req.selection, req.context, settings.explanationLanguage);

    const text = await deps.callAi({
      apiKey: settings.apiKey,
      model: settings.model,
      system: prompt.system,
      user: prompt.user,
    });
    await deps.setCached(key, text);
    return { ok: true, text };
  } catch (e) {
    if (e instanceof AiError) {
      return { ok: false, code: e.code, error: e.message };
    }
    return { ok: false, code: 'UNKNOWN', error: (e as Error)?.message ?? '不明なエラー' };
  }
}
