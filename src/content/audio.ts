import { sendRequest } from '../shared/messages';

/**
 * 🔊 の再生。先読み済み音源URLがあれば offscreen でネイティブ音源を再生。
 * 無い／再生不可なら Web Speech API で読み上げる。
 */
export async function playPronunciation(
  selection: string,
  audioUrl: string | null,
): Promise<void> {
  if (audioUrl) {
    const res = await sendRequest({ type: 'playAudio', url: audioUrl });
    if (res.ok && res.kind === 'audio' && res.played) return;
  }
  speak(selection);
}

/** ブラウザ内蔵の読み上げ。非対応環境では静かに何もしない。 */
function speak(text: string): void {
  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
  try {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    const enVoice = synth.getVoices().find((v) => v.lang.startsWith('en'));
    if (enVoice) u.voice = enVoice;
    synth.speak(u);
  } catch {
    // 読み上げ非対応・失敗時は何もしない。
  }
}
