import { handleRequest, type HandlerDeps } from './handler';
import type { RequestMessage } from '../shared/types';

export function isVideoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (
      ['www.youtube.com', 'youtube.com', 'www.primevideo.com'].includes(url.hostname)
      || (['www.amazon.co.jp', 'www.amazon.com'].includes(url.hostname) && url.pathname.startsWith('/gp/video/'))
    );
  } catch { return false; }
}
export function isRequest(value: unknown): value is RequestMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const text = (key: string, max = 8192): boolean => typeof v[key] === 'string' && (v[key] as string).length > 0 && (v[key] as string).length <= max;
  switch (v.type) {
    case 'ping': return true;
    case 'translateLine': case 'explainSentence': return text('text');
    case 'explainSelection': return text('selection', 2048) && text('context');
    case 'lookupWord': return text('text', 256);
    case 'playAudio': return text('url', 2048) && /^https:\/\/(?:dictionary\.cambridge\.org|(?:ssl\.)?gstatic\.com|api\.dictionaryapi\.dev)\//.test(v.url as string);
    default: return false;
  }
}

/** 非同期の設定・キャッシュ読み込みをまたぐ要求にも同じ世代を適用する。 */
export function createRequestBoundary(deps: HandlerDeps, native: { reset: () => void; dropTab: (tabId: number) => void; retireTranslation: (tabId: number) => void }) {
  let settingsRevision = 0;
  const tabs = new Map<number, { url: string; text?: string; translation: number }>();
  const dropTab = (tabId: number): void => {
    tabs.delete(tabId);
    native.dropTab(tabId);
  };
  const settingsChanged = (): void => { settingsRevision++; native.reset(); };
  const dispatch = (message: unknown, sender: chrome.runtime.MessageSender) => {
    if (sender.id !== chrome.runtime.id) return undefined;
    const value = message as { type?: unknown } | null;
    const options = sender.url === chrome.runtime.getURL('options.html');
    const tabId = sender.tab?.id;
    const content = tabId !== undefined && sender.frameId === 0 && typeof sender.url === 'string' && isVideoUrl(sender.url);
    if (!options && !content) return undefined;
    if (options && value?.type !== 'ping') return undefined;
    if (content && value?.type === 'ping') return undefined;
    if (content && value?.type === 'contextChanged') {
      dropTab(tabId!);
      return Promise.resolve({ ok: true as const, text: '' });
    }
    if (!isRequest(message)) return undefined;
    let state: { url: string; text?: string; translation: number } | undefined;
    if (content) {
      state = tabs.get(tabId!);
      if (!state || state.url !== sender.url) {
        dropTab(tabId!);
        state = { url: sender.url!, translation: 0 };
        tabs.set(tabId!, state);
      }
      if (message.type === 'translateLine' && state.text !== message.text) {
        state.text = message.text;
        state.translation++;
        // Retire pending work before any async settings/cache read, including a newer cache hit.
        native.retireTranslation(tabId!);
      }
    }
    const revision = settingsRevision;
    const translation = state?.translation;
    return handleRequest(message, deps, {
      tabId: content ? tabId : undefined,
      isCurrent: () => settingsRevision === revision && (!content || tabs.get(tabId!) === state),
      canDispatchSubscription: () => message.type !== 'translateLine' || state?.translation === translation,
    });
  };
  return { dispatch, dropTab, settingsChanged };
}
