/** 再生に使う最小限の音声要素（テストで差し替え可能）。 */
export interface PlayableAudio {
  play: () => Promise<void>;
  pause: () => void;
}

export interface PlayResult {
  played: boolean;
  error?: string;
}

/**
 * 音源 URL を再生し、実際に再生が始まったかを返す関数を作る。
 * 以前は再生の成否を待たずに「成功」としていたため、読み込み失敗時は無音のままだった。
 * 失敗・タイムアウトを played:false で返し、呼び出し側が TTS にフォールバックできるようにする。
 */
export function createAudioPlayer(
  createAudio: (url: string) => PlayableAudio = (url) => new Audio(url),
  timeoutMs = 5000,
): (url: string) => Promise<PlayResult> {
  let current: PlayableAudio | null = null;

  return async (url: string): Promise<PlayResult> => {
    current?.pause();
    const audio = createAudio(url);
    current = audio;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('音源の読み込みがタイムアウトしました')), timeoutMs);
    });
    try {
      await Promise.race([audio.play(), timeout]);
      return { played: true };
    } catch (e) {
      audio.pause();
      return { played: false, error: String(e) };
    } finally {
      clearTimeout(timer);
    }
  };
}
