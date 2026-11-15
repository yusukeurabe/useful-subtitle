import type { Overlay } from './overlay';
import { isSingleWord } from '../shared/dictionary';
import { sendRequest } from '../shared/messages';

/** 🔊 が辞書取得の完了を待つ上限。これを超えたら TTS で読み上げる。 */
const AUDIO_WAIT_MS = 4000;

// 直近に開始した辞書取得（単語と、その音源URLが決まる Promise）。
let pendingLookup: { selection: string; audioUrl: Promise<string | null> } | null = null;

/**
 * 単語の辞書情報（IPA＋音源URL）を取得する。フレーズ・失敗時は {null,null}。
 * 進行中の取得として記録し、🔊 が取得完了前に押されても waitForAudioUrl で待てるようにする。
 */
export function fetchWordInfo(selection: string): Promise<{ ipa: string | null; audioUrl: string | null }> {
  if (!isSingleWord(selection)) {
    pendingLookup = null;
    return Promise.resolve({ ipa: null, audioUrl: null });
  }
  const info = sendRequest({ type: 'lookupWord', text: selection }).then(
    (r) => (r.ok && r.kind === 'word' ? { ipa: r.ipa, audioUrl: r.audioUrl } : { ipa: null, audioUrl: null }),
    () => ({ ipa: null, audioUrl: null }),
  );
  pendingLookup = { selection, audioUrl: info.then((i) => i.audioUrl) };
  return info;
}

/**
 * 単語のとき辞書情報（IPA＋音源URL）を取得し、ポップアップに反映する。
 * フレーズ・取得失敗時は IPA なし／音源なしとして扱う（🔊 は TTS にフォールバック）。
 */
export async function loadWordInfo(overlay: Overlay, selection: string, popupToken: number): Promise<void> {
  if (!overlay.isPopupCurrent(popupToken)) return;
  const info = await fetchWordInfo(selection);
  if (!overlay.isPopupCurrent(popupToken)) return;
  overlay.setPopupWordInfo(info.ipa, info.audioUrl);
}

/**
 * 同じ単語の辞書取得が進行中（または完了済み）なら、その音源URLを待って返す。
 * 取得完了前に 🔊 を押すと音源なし扱いで TTS になっていたのを防ぐ。
 * 別の単語・待ち時間超過のときは null。
 */
export function waitForAudioUrl(selection: string, timeoutMs = AUDIO_WAIT_MS): Promise<string | null> {
  if (!pendingLookup || pendingLookup.selection !== selection) return Promise.resolve(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  return Promise.race([pendingLookup.audioUrl, timeout]).finally(() => clearTimeout(timer));
}
