import { pickCaptionText } from './captionExtractor';

export interface CaptionObserver {
  stop: () => void;
}

/**
 * 字幕テキストの変化を監視し、変化があるたびに onChange(text|null) を呼ぶ。
 * Prime は SPA で字幕要素が出入り・再マウントするため、document.body 全体を
 * subtree 監視し、連続ミューテーションは 1 フレームにまとめて読む。
 * 同一テキストの連続発火は抑制する。
 */
export function startCaptionObserver(
  onChange: (text: string | null) => void,
): CaptionObserver {
  let last: string | null = null;
  let scheduled = false;

  const read = (): void => {
    scheduled = false;
    const text = pickCaptionText(document);
    if (text !== last) {
      last = text;
      onChange(text);
    }
  };

  const schedule = (): void => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(read);
  };

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // 初回の状態も一度読む。
  schedule();

  return { stop: () => observer.disconnect() };
}
