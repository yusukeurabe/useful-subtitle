import { type HandlerDeps } from './handler';
import { getCached, setCached } from './cache';
import { callAnthropic } from './aiClient';
import { getSettings } from '../shared/settings';
import { createWordInfoFetcher } from './wordInfo';
import { createOffscreenAudioPlayer } from './offscreenAudio';
import { createNativeClient } from './nativeClient';
import { createRequestBoundary } from './requestBoundary';

/** 単語の IPA＋音源 URL（Cambridge 一次・dictionaryapi.dev 予備、結果はメモリに保持）。 */
const getWordInfo = createWordInfoFetcher((url) => fetch(url));

/**
 * offscreen で音源を再生する。AUDIO_PLAYBACK の offscreen は無音30秒で Chrome に閉じられる
 * ため、毎回 runtime.getContexts で存在を確かめて無ければ作り直す。
 */
const playOffscreenAudio = createOffscreenAudioPlayer({
  hasDocument: async () => {
    // getContexts は Chrome 116+。無い環境では「無い」とみなし、作成時の重複エラーで判定する。
    if (typeof chrome.runtime.getContexts !== 'function') return false;
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
    });
    return contexts.length > 0;
  },
  createDocument: () =>
    chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK' as chrome.offscreen.Reason],
      justification: '単語の発音音声を再生するため',
    }),
  sendPlay: (url) => chrome.runtime.sendMessage({ target: 'offscreen', url }),
});

const native = createNativeClient();
const deps: HandlerDeps = {
  getSettings,
  getCached,
  setCached,
  callAi: callAnthropic,
  callSubscription: native.request,
  getWordInfo,
  playOffscreenAudio,
};

const boundary = createRequestBoundary(deps, native);
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const response = boundary.dispatch(message, sender);
  if (!response) return;
  void response.then(sendResponse).catch(() => sendResponse({ ok: false, code: 'UNKNOWN', error: '要求を処理できませんでした。' }));
  return true;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && ['provider', 'model', 'explanationLanguage', 'apiKey', 'dualSubtitle'].some(key => key in changes)) {
    boundary.settingsChanged();
  }
});
chrome.tabs.onRemoved.addListener(tabId => boundary.dropTab(tabId));
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading' || change.url) boundary.dropTab(tabId);
});

// ツールバーアイコンのクリックで設定画面を開く。
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
