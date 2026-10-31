import {
  buildTranslationPrompt,
  buildExplanationPrompt,
  buildSentenceMeaningPrompt,
} from '../shared/prompts';
import type { NativeParams, NativeContext } from './nativeClient';
import { makeCacheKey } from './cache';
import { AiError, type AnthropicParams } from './aiClient';
import { normalizeWord, isSingleWord, type WordInfo } from '../shared/dictionary';
import type {
  RequestMessage,
  ResponseMessage,
  WordInfoResponse,
  AudioResponse,
  Settings,
} from '../shared/types';

/** handleRequest が依存する外部境界（設定・キャッシュ・AI 呼び出し）。テストで差し替え可能。 */
export interface HandlerDeps {
  getSettings: () => Promise<Settings>;
  getCached: (key: string) => Promise<string | undefined>;
  setCached: (key: string, value: string) => Promise<void>;
  callAi: (params: AnthropicParams) => Promise<string>;
  callSubscription: (params: NativeParams, context: NativeContext) => Promise<string>;
  /** 単語の発音情報（IPA＋音源URL）を取得する（辞書API）。 */
  getWordInfo: (word: string) => Promise<WordInfo>;
  /** 音源URLを offscreen で再生する。 */
  playOffscreenAudio: (url: string) => Promise<void>;
}

/**
 * content script からのリクエストを処理して応答を返す。
 * APIキー確認 → （翻訳/解説は）キャッシュ確認 → AI 呼び出し → キャッシュ保存。
 */
export async function handleRequest(
  req: RequestMessage,
  deps: HandlerDeps,
  context: { tabId?: number; isCurrent?: () => boolean; canDispatchSubscription?: () => boolean } = {},
): Promise<ResponseMessage | WordInfoResponse | AudioResponse> {
  // 辞書情報・音声再生は APIキー不要。最初に分岐する。
  if (req.type === 'lookupWord') {
    if (!isSingleWord(req.text)) {
      return { ok: true, kind: 'word', ipa: null, audioUrl: null };
    }
    try {
      const info = await deps.getWordInfo(normalizeWord(req.text));
      return { ok: true, kind: 'word', ipa: info.ipa, audioUrl: info.audioUrl };
    } catch {
      return { ok: true, kind: 'word', ipa: null, audioUrl: null };
    }
  }
  if (req.type === 'playAudio') {
    if (!req.url) return { ok: true, kind: 'audio', played: false };
    try {
      await deps.playOffscreenAudio(req.url);
      return { ok: true, kind: 'audio', played: true };
    } catch {
      return { ok: true, kind: 'audio', played: false };
    }
  }

  try {
    const ensureCurrent = (): void => {
      if (context.isCurrent && !context.isCurrent()) throw new AiError('CANCELED', '設定またはページが変更されました。');
    };
    const settings = await deps.getSettings();
    ensureCurrent();
    if ((req.type !== 'ping' && !settings.enabled)
      || (req.type === 'translateLine' && !settings.dualSubtitle)) {
      throw new AiError('CANCELED', '設定で AI の処理が無効になっています。');
    }
    if (settings.provider !== 'anthropic' && settings.provider !== 'claude-subscription') {
      throw new AiError('UNKNOWN', '設定画面で接続方式を選択してください。');
    }
    if (settings.provider === 'anthropic' && !settings.apiKey) {
      return {
        ok: false,
        code: 'NO_API_KEY',
        error: 'APIキーが未設定です。拡張機能の設定画面で入力してください。',
      };
    }

    const call = (params: NativeParams): Promise<string> => {
      ensureCurrent();
      if (settings.provider === 'claude-subscription') {
        // Once started, a translation still belongs in its original history/cache entry.
        // Caption freshness only prevents obsolete work from entering the native queue.
        if (context.canDispatchSubscription && !context.canDispatchSubscription()) {
          throw new AiError('CANCELED', '新しい字幕に切り替わりました。');
        }
        return deps.callSubscription(params, { kind: req.type === 'translateLine' ? 'translation' : 'interactive', tabId: context.tabId, retry: req.type === 'ping' });
      }
      return deps.callAi({ ...params, apiKey: settings.apiKey });
    };
    if (req.type === 'ping') {
      const text = await call({
        model: settings.model,
        system: 'Reply with the single word: OK',
        user: 'ping',
        maxTokens: 16,
      });
      ensureCurrent();
      return { ok: true, text };
    }

    const key = makeCacheKey(req, settings.model, settings.explanationLanguage, settings.provider);
    const cached = await deps.getCached(key);
    ensureCurrent();
    if (cached !== undefined) {
      return { ok: true, text: cached };
    }

    const prompt =
      req.type === 'translateLine'
        ? buildTranslationPrompt(req.text)
        : req.type === 'explainSentence'
          ? buildSentenceMeaningPrompt(req.text, settings.explanationLanguage)
          : buildExplanationPrompt(req.selection, req.context, settings.explanationLanguage);

    const text = await call({
      model: settings.model,
      system: prompt.system,
      user: prompt.user,
    });
    ensureCurrent();
    await deps.setCached(key, text);
    ensureCurrent();
    return { ok: true, text };
  } catch (e) {
    if (e instanceof AiError) {
      return { ok: false, code: e.code, error: e.message };
    }
    return { ok: false, code: 'UNKNOWN', error: (e as Error)?.message ?? '不明なエラー' };
  }
}
