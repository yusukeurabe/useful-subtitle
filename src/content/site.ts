import { YOUTUBE_PLAYER_SELECTOR } from '../shared/selectors';

export function isYouTube(href = location.href): boolean {
  try {
    const { hostname } = new URL(href);
    return hostname === 'www.youtube.com' || hostname === 'youtube.com';
  } catch {
    return false;
  }
}

export function youtubeVideoId(href = location.href): string {
  const url = new URL(href);
  return isYouTube(href) && url.pathname === '/watch' ? url.searchParams.get('v') ?? '' : '';
}

export function youtubePlayer(): HTMLElement | null {
  return youtubeVideoId() ? document.querySelector<HTMLElement>(YOUTUBE_PLAYER_SELECTOR) : null;
}

export function isYouTubeAd(player = youtubePlayer()): boolean {
  return !!player?.matches('.ad-showing, .ad-interrupting');
}
