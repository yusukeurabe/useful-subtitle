/**
 * 字幕ホバーで一時停止するための判断部品。
 *
 * 字幕枠にカーソルが入ったら（再生中なら）止め、ホバーが終わったら
 * 「この部品が止めた」場合だけ再開する。DOM 構造には依存せず、
 * video の取得と再開処理は外から受け取る（テストしやすくするため）。
 */
export interface HoverPause {
  /** 字幕枠にカーソルが入った。 */
  start(): void;
  /** ホバー状態が終わった。resume=false なら記録だけ消して再開しない。 */
  end(opts: { resume: boolean }): void;
}

export interface HoverPauseDeps {
  /** 本編 video を返す（無ければ null）。 */
  findVideo: () => HTMLVideoElement | null;
  /**
   * 停止中の v を再生し直す。戻り値は保留中の再開処理を取り消す関数で、
   * 再開が済んだ後や複数回呼ばれても安全であること。
   */
  resume: (v: HTMLVideoElement) => () => void;
}

export function createHoverPause(deps: HoverPauseDeps): HoverPause {
  // ホバーで止めた video。ユーザーが自分で再生したら（play イベント）忘れる。
  let pausedVideo: HTMLVideoElement | null = null;
  let cancelResume: (() => void) | null = null;
  // end で再開を依頼したが、まだ再生が始まったと確認できていない video。
  // Prime は生の play() を握り潰すことがあり、その場合は 200ms 後のボタン押下
  // （やその後に Prime が実際に再生を始めるまで）の間も停止したままになる。
  // この間に入り直すと start が「もともと停止中」と誤認して記録せず、外しても
  // 再開されず止まったままになるので、この video を覚えておいて記録し直す。
  let resumingVideo: HTMLVideoElement | null = null;

  const forget = (): void => {
    pausedVideo?.removeEventListener('play', onPlay);
    pausedVideo = null;
  };

  // play() は paused を即座に false にするが、play イベントは後のタスクで届く。
  // 自分の再開直後にまた start で止め直すと、その遅れたイベントが新しい記録を
  // 消してしまう。届いた時点で再び停止中なら古いイベントとみなして無視し、
  // 本当に再生中（ユーザーが再生した）ときだけ忘れる。
  const onPlay = (): void => {
    if (pausedVideo && !pausedVideo.paused) forget();
  };

  const clearResuming = (): void => {
    resumingVideo?.removeEventListener('play', onResumePlay);
    resumingVideo = null;
  };

  // 再開が本当に成功した（play が届いた時点で再生中）ら覚えるのをやめる。
  // こうしておけば、その後ユーザーが自分で止めた video を入り直しで
  // 「ホバーで止めた」と誤って記録し直すことはない。
  const onResumePlay = (): void => {
    if (resumingVideo && !resumingVideo.paused) clearResuming();
  };

  return {
    start() {
      // 外した直後にまた入った場合、保留中の再開（Prime ボタン押下）を止める。
      cancelResume?.();
      cancelResume = null;
      const resuming = resumingVideo;
      clearResuming();
      if (pausedVideo) return;
      // 再開を依頼したのにまだ停止中（Prime が握り潰した等）なら、それはこの部品が
      // 止めたままの video。止め直さず（既に停止中）記録だけ戻し、外したら再開する。
      if (resuming && resuming.paused && resuming.isConnected) {
        pausedVideo = resuming;
        resuming.addEventListener('play', onPlay);
        return;
      }
      const v = deps.findVideo();
      if (!v || v.paused) return; // もともと停止中なら触らない
      v.pause();
      pausedVideo = v;
      v.addEventListener('play', onPlay);
    },
    end({ resume }) {
      const v = pausedVideo;
      if (!v) return;
      forget(); // 自分の再開で play イベントが来る前に外しておく
      if (resume && v.paused && v.isConnected) {
        // resume が同期で play を発火しても取りこぼさないよう、呼ぶ前に見張りを付ける。
        clearResuming();
        resumingVideo = v;
        v.addEventListener('play', onResumePlay);
        cancelResume = deps.resume(v);
      }
    },
  };
}
