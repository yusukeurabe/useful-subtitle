import { pickCaptionText } from './captionExtractor';
import { CAPTION_TEXT_SELECTORS, YOUTUBE_CAPTION_SELECTORS } from '../shared/selectors';
import { extractContentId } from './contentIdentity';
import { isYouTube, isYouTubeAd, youtubePlayer, youtubeVideoId } from './site';

export interface CaptionObserver {
  stop: () => void;
}

export interface CaptionContext {
  contentId: string;
  active: boolean;
  isAd: boolean;
  player: HTMLElement | null;
}

/** 字幕とページ状態をフレーム単位で読み、同じ文字でも動画が変われば通知する。 */
export function startCaptionObserver(
  onChange: (text: string | null, context: CaptionContext) => void,
): CaptionObserver {
  const youtube = isYouTube();
  let last: string | null = null;
  let previous: CaptionContext | undefined;
  let frame: number | null = null;
  let navigating = false;
  let stopped = false;

  const read = (): void => {
    frame = null;
    if (stopped) return;
    const player = youtube ? youtubePlayer() : null;
    const context: CaptionContext = {
      contentId: extractContentId(location.href),
      active: !youtube || (!navigating && !!youtubeVideoId()),
      isAd: youtube && isYouTubeAd(player),
      player,
    };
    const text = context.active && !context.isAd
      ? pickCaptionText(document, youtube ? YOUTUBE_CAPTION_SELECTORS : CAPTION_TEXT_SELECTORS)
      : null;
    if (text !== last || !previous || Object.keys(context).some(
      (key) => context[key as keyof CaptionContext] !== previous![key as keyof CaptionContext],
    )) {
      last = text;
      previous = context;
      onChange(text, context);
    }
  };

  const schedule = (): void => {
    if (frame === null && !stopped) frame = requestAnimationFrame(read);
  };
  const startNavigation = (): void => { navigating = true; schedule(); };
  const finishNavigation = (): void => { navigating = false; schedule(); };
  const observer = new MutationObserver((records) => {
    if (records.some((record) => record.type !== 'attributes' || (
      record.target instanceof Element && (
        record.target.id === 'movie_player' ||
        record.target.closest('#movie_player .ytp-caption-window-container')
      )
    ))) schedule();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    ...(youtube ? { attributes: true, attributeFilter: ['class'] } : {}),
  });
  if (youtube) {
    document.addEventListener('yt-navigate-start', startNavigation);
    document.addEventListener('yt-navigate-finish', finishNavigation);
    window.addEventListener('popstate', finishNavigation);
  }
  schedule();

  return {
    stop: () => {
      stopped = true;
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      document.removeEventListener('yt-navigate-start', startNavigation);
      document.removeEventListener('yt-navigate-finish', finishNavigation);
      window.removeEventListener('popstate', finishNavigation);
    },
  };
}
