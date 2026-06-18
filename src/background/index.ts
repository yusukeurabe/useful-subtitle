import { handleRequest, type HandlerDeps } from './handler';
import { getCached, setCached } from './cache';
import { callAnthropic } from './aiClient';
import { getSettings } from '../shared/settings';
import { extractWordInfo, type WordInfo } from '../shared/dictionary';
import type { RequestMessage } from '../shared/types';

const DICT_API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';

/** 無料辞書APIから単語の IPA＋音源URLを取得する。失敗時は {null,null}。 */
async function getWordInfo(word: string): Promise<WordInfo> {
  const res = await fetch(`${DICT_API}${encodeURIComponent(word)}`);
  if (!res.ok) return { ipa: null, audioUrl: null };
  const json = (await res.json().catch(() => null)) as unknown;
  return extractWordInfo(json);
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

const deps: HandlerDeps = {
  getSettings,
  getCached,
  setCached,
  callAi: callAnthropic,
  getWordInfo,
  playOffscreenAudio,
};

chrome.runtime.onMessage.addListener(
  (message: RequestMessage & { target?: string }, _sender, sendResponse) => {
    // offscreen 宛のメッセージは background では扱わない。
    if (message?.target === 'offscreen') return;
    handleRequest(message, deps).then(sendResponse);
    // 非同期で sendResponse を呼ぶためチャンネルを開いたままにする。
    return true;
  },
);

// ツールバーアイコンのクリックで設定画面を開く。
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
