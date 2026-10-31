import { type HandlerDeps } from './handler';
import { getCached, setCached } from './cache';
import { callAnthropic } from './aiClient';
import { getSettings } from '../shared/settings';
import { extractWordInfo, extractCambridgeWordInfo, CAMBRIDGE_BASE, type WordInfo } from '../shared/dictionary';
import { createNativeClient } from './nativeClient';
import { createRequestBoundary } from './requestBoundary';

const DICT_API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';

/** Cambridge 英英ページから US の IPA と mp3 URL を取得する。未収録/失敗時は {null,null}。 */
async function tryCambridge(word: string): Promise<WordInfo> {
  try {
    const res = await fetch(`${CAMBRIDGE_BASE}/dictionary/english/${encodeURIComponent(word)}`);
    if (!res.ok) return { ipa: null, audioUrl: null };
    const html = await res.text();
    return extractCambridgeWordInfo(html);
  } catch {
    return { ipa: null, audioUrl: null };
  }
}

/** 無料辞書 API（フォールバック）から IPA と mp3 URL を取得する。失敗時は {null,null}。 */
async function tryDictionaryApi(word: string): Promise<WordInfo> {
  try {
    const res = await fetch(`${DICT_API}${encodeURIComponent(word)}`);
    if (!res.ok) return { ipa: null, audioUrl: null };
    const json = (await res.json().catch(() => null)) as unknown;
    return extractWordInfo(json);
  } catch {
    return { ipa: null, audioUrl: null };
  }
}

/**
 * Cambridge を一次、dictionaryapi.dev をフォールバックとして単語の IPA＋音源 URL を返す。
 * Cambridge で IPA が取れたら音源 null でも採用する（部分採用＝音源は TTS フォールバックで埋まる）。
 */
async function getWordInfo(word: string): Promise<WordInfo> {
  const cam = await tryCambridge(word);
  if (cam.ipa) return cam;
  return tryDictionaryApi(word);
}

// offscreen ドキュメントは1つだけ生成可。生成を直列化し、既存ならエラーを無視。
let offscreenReady: Promise<void> | null = null;
async function ensureOffscreen(): Promise<void> {
  if (!offscreenReady) {
    offscreenReady = chrome.offscreen
      .createDocument({
        url: 'offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: '単語の発音音声を再生するため',
      })
      .catch((e: unknown) => {
        // 既に存在していれば成功扱い。それ以外は次回再試行できるよう reset して再throw。
        if (!String(e).toLowerCase().includes('single offscreen')) {
          offscreenReady = null;
          throw e;
        }
      });
  }
  await offscreenReady;
}

/** offscreen に音源URLを渡して再生させる。 */
async function playOffscreenAudio(url: string): Promise<void> {
  await ensureOffscreen();
  await chrome.runtime.sendMessage({ target: 'offscreen', url });
}

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
  if (area === 'local' && ['provider', 'model', 'explanationLanguage', 'apiKey', 'enabled', 'dualSubtitle'].some(key => key in changes)) {
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
