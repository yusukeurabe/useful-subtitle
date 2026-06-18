import { handleRequest, type HandlerDeps } from './handler';
import { getCached, setCached } from './cache';
import { callAnthropic } from './aiClient';
import { getSettings } from '../shared/settings';
import type { RequestMessage } from '../shared/types';

const deps: HandlerDeps = {
  getSettings,
  getCached,
  setCached,
  callAi: callAnthropic,
};

chrome.runtime.onMessage.addListener((message: RequestMessage, _sender, sendResponse) => {
  handleRequest(message, deps).then(sendResponse);
  // 非同期で sendResponse を呼ぶためチャンネルを開いたままにする。
  return true;
});

// ツールバーアイコンのクリックで設定画面を開く。
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
