import { AiError } from './aiClient';
import type { ErrorCode } from '../shared/types';

export interface NativeParams {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}
export interface NativeContext {
  kind: 'translation' | 'interactive';
  tabId?: number;
  /** 設定画面の明示的な接続テストだけ利用制限の再確認を許可する。 */
  retry?: boolean;
}
interface Job {
  id: string;
  key: string;
  params: NativeParams;
  context: NativeContext;
  promise: Promise<string>;
  resolve: (text: string) => void;
  reject: (error: AiError) => void;
}
const MESSAGES: Partial<Record<ErrorCode, string>> = {
  AUTH: 'Claude Code で利用する Claude Pro アカウントにログインし直してください。',
  RATE_LIMIT: 'Claude の利用上限に達しました。自動送信を60秒停止します。時間をおいて接続テストしてください。',
  NATIVE_SETUP: '接続プログラムを登録し、拡張機能を再読み込みしてください。設定画面の手順を確認してください。',
  NETWORK: 'Claude Code との接続が切れました。ネットワークとログイン状態を確認してください。',
  TIMEOUT: 'Claude Code の応答がタイムアウトしました。時間をおいて再度お試しください。',
  BUSY: 'Claude が別の要求を処理中です。しばらく待って再度お試しください。',
  CANCELED: '設定・ページ・字幕の変更により処理を取り消しました。',
  UNKNOWN: 'Claude Code の応答を確認できませんでした。モデルの利用可否と接続設定を確認してください。',
};
const failure = (code: ErrorCode): AiError => new AiError(code, MESSAGES[code] ?? MESSAGES.UNKNOWN!);

/** タブ単位で重複をまとめる。他タブのキャンセルが共有要求に影響しない。 */
export function createNativeClient(connect = () => chrome.runtime.connectNative('com.useful_subtitle.claude')) {
  let port: chrome.runtime.Port | undefined;
  let active: Job | undefined;
  let sequence = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let handover: ReturnType<typeof setTimeout> | undefined;
  let reconnectAfter = 0;
  let cooldownUntil = 0;
  let cooldownCode: ErrorCode = 'RATE_LIMIT';
  const coolDown = (code: ErrorCode): void => {
    cooldownUntil = Date.now() + 60_000;
    cooldownCode = code;
  };
  const interactive: Job[] = [];
  const translations = new Map<number | undefined, Job>();

  const close = (): void => {
    clearTimeout(idle);
    clearTimeout(timeout);
    const old = port;
    if (old && active) reconnectAfter = Date.now() + 750;
    port = undefined;
    old?.disconnect();
  };
  const clearPending = (code: ErrorCode): void => {
    for (const job of [...interactive, ...translations.values()]) job.reject(failure(code));
    interactive.length = 0;
    translations.clear();
  };
  const reset = (code: ErrorCode = 'CANCELED'): void => {
    clearTimeout(handover);
    handover = undefined;
    if (code !== 'CANCELED') coolDown(code);
    close();
    active?.reject(failure(code));
    active = undefined;
    clearPending(code);
  };
  const pump = (): void => {
    if (active) return;
    if (Date.now() < reconnectAfter) {
      handover ??= setTimeout(() => { handover = undefined; pump(); }, reconnectAfter - Date.now());
      return;
    }
    const job = interactive.shift() ?? translations.values().next().value as Job | undefined;
    if (!job) {
      if (port) idle = setTimeout(close, 30_000);
      return;
    }
    if (job.context.kind === 'translation') translations.delete(job.context.tabId);
    active = job;
    clearTimeout(idle);
    try {
      if (!port) {
        const current = connect();
        port = current;
        current.onDisconnect.addListener(() => {
          // lastError must be consumed, but raw OS/CLI messages are not exposed.
          void chrome.runtime.lastError;
          if (port === current) reset('NATIVE_SETUP');
        });
        current.onMessage.addListener((reply: unknown) => {
          if (port !== current || !active) return;
          const value = reply as { id?: unknown; ok?: unknown; text?: unknown; code?: unknown } | null;
          if (!value || typeof value !== 'object' || value.id !== active.id || typeof value.ok !== 'boolean'
            || (value.ok && (typeof value.text !== 'string' || !value.text.trim() || value.text.length > 100_000))
            || (!value.ok && (typeof value.code !== 'string' || !Object.hasOwn(MESSAGES, value.code)))) {
            reset('UNKNOWN');
            return;
          }
          clearTimeout(timeout);
          const done = active;
          active = undefined;
          if (value.ok) {
            if (done.context.retry) cooldownUntil = 0;
            done.resolve(value.text as string);
          }
          else {
            const code = value.code as ErrorCode;
            coolDown(code);
            clearPending(code);
            done.reject(failure(code));
          }
          pump();
        });
      }
      timeout = setTimeout(() => reset('TIMEOUT'), 55_000);
      // Enumerate fields: even an extra apiKey on a caller's object never crosses this boundary.
      const { model, system, user, maxTokens } = job.params;
      port.postMessage({ id: job.id, model, system, user, ...(maxTokens === undefined ? {} : { maxTokens }) });
    } catch {
      reset('NATIVE_SETUP');
    }
  };
  const request = (params: NativeParams, context: NativeContext): Promise<string> => {
    if (Date.now() < cooldownUntil && !context.retry) return Promise.reject(failure(cooldownCode));
    const key = JSON.stringify([context.tabId, context.kind, params.model, params.system, params.user, params.maxTokens]);
    const same = [active, ...interactive, ...translations.values()].find(job => job?.key === key);
    if (same) {
      // A → B → A: active A can be shared, but queued B is no longer the latest caption.
      const pending = translations.get(context.tabId);
      if (context.kind === 'translation' && pending && pending !== same) {
        pending.reject(failure('CANCELED'));
        translations.delete(context.tabId);
      }
      return same.promise;
    }
    if (context.kind === 'interactive' && interactive.length >= 8) return Promise.reject(failure('BUSY'));
    if (context.kind === 'translation' && !translations.has(context.tabId) && translations.size >= 8) return Promise.reject(failure('BUSY'));
    let resolve!: Job['resolve'];
    let reject!: Job['reject'];
    const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
    const job: Job = { id: String(++sequence), key, params, context, promise, resolve, reject };
    if (context.kind === 'interactive') interactive.push(job);
    else {
      translations.get(context.tabId)?.reject(failure('CANCELED'));
      translations.set(context.tabId, job);
    }
    pump();
    return promise;
  };
  const retireTranslation = (tabId: number): void => {
    translations.get(tabId)?.reject(failure('CANCELED'));
    translations.delete(tabId);
  };
  const dropTab = (tabId: number): void => {
    retireTranslation(tabId);
    for (let i = interactive.length - 1; i >= 0; i--) {
      if (interactive[i]!.context.tabId === tabId) interactive.splice(i, 1)[0]!.reject(failure('CANCELED'));
    }
    if (active?.context.tabId === tabId) {
      active.reject(failure('CANCELED'));
      close();
      active = undefined;
      pump();
    }
  };
  return { request, reset, dropTab, retireTranslation };
}
