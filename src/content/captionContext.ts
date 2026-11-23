import type { CaptionNeighbors } from '../shared/types';

/** 時刻つきの字幕1件。 */
export interface TimedCaption {
  text: string;
  videoTime: number;
}

/** 前後それぞれ何件まで渡すか。文が3枚以上にまたがることは少ないので2件で足りる。 */
export const NEIGHBOR_COUNT = 2;
/**
 * 前後の字幕として扱う時間の幅（秒）。これより離れた字幕は別の場面・別の会話とみなして渡さない
 * （無関係な字幕で AI の判断を濁さないため）。隣り合う字幕どうしの間隔で測る。
 */
export const NEIGHBOR_GAP_SEC = 8;

/**
 * 時刻順に並んだ字幕の index 番目について、前後の字幕を最大 count 件ずつ取り出す。
 * 隣との間隔が gapSec を超えたところで打ち切る。空欄はフィールドごと省く。
 */
export function pickNeighbors(
  list: readonly TimedCaption[],
  index: number,
  count = NEIGHBOR_COUNT,
  gapSec = NEIGHBOR_GAP_SEC,
): CaptionNeighbors {
  const target = list[index];
  if (!target) return {};
  const before: string[] = [];
  let edge = target.videoTime;
  for (let i = index - 1; i >= 0 && before.length < count; i--) {
    const c = list[i]!;
    if (edge - c.videoTime > gapSec) break;
    if (c.text !== target.text) before.unshift(c.text);
    edge = c.videoTime;
  }
  const after: string[] = [];
  edge = target.videoTime;
  for (let i = index + 1; i < list.length && after.length < count; i++) {
    const c = list[i]!;
    if (c.videoTime - edge > gapSec) break;
    if (c.text !== target.text) after.push(c.text);
    edge = c.videoTime;
  }
  const result: CaptionNeighbors = {};
  if (before.length) result.before = before;
  if (after.length) result.after = after;
  return result;
}

const normalize = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** 同じ字幕の再表示とみなす時刻のずれ（秒）。巻き戻して見直したときの重複を防ぐ。 */
const SAME_CAPTION_SEC = 1.5;
/** 覚えておく字幕の上限。長編でもメモリを使いすぎないよう古い（時刻の早い）ものから捨てる。 */
const MAX_CAPTIONS = 600;

/**
 * 画面に出た字幕を動画の時刻順に覚えておき、ある字幕の前後の字幕を引けるようにする。
 * 字幕リスト（履歴パネル）の有無・記録ルールに関係なく、画面上の字幕の解説で使う。
 * 巻き戻して見直すと、まだ再生中には分からなかった「次の字幕」も引けるようになる。
 */
export function createCaptionTimeline() {
  const list: TimedCaption[] = [];

  const findIndex = (text: string, videoTime: number): number =>
    list.findIndex((c) => c.text === text && Math.abs(c.videoTime - videoTime) <= SAME_CAPTION_SEC);

  return {
    add(text: string, videoTime: number): void {
      if (!text.trim() || !Number.isFinite(videoTime)) return;
      if (findIndex(text, videoTime) !== -1) return;
      // YouTube のローリング字幕は語単位で伸びる。直前（時刻の近い）の字幕の続きなら置き換える。
      const next = normalize(text);
      const i = list.findIndex((c) => {
        if (Math.abs(c.videoTime - videoTime) > 3) return false;
        const prev = normalize(c.text);
        return Boolean(prev && next && (next.startsWith(`${prev} `) || prev.startsWith(`${next} `)));
      });
      if (i !== -1) {
        // 伸びた側を残す（DOM の入れ替え途中の短い字幕で、完成済みの文を削らない）。
        if (normalize(list[i]!.text).length < next.length) list[i] = { text, videoTime: list[i]!.videoTime };
        return;
      }
      const at = list.findIndex((c) => c.videoTime > videoTime);
      if (at === -1) list.push({ text, videoTime });
      else list.splice(at, 0, { text, videoTime });
      if (list.length > MAX_CAPTIONS) list.shift();
    },
    /** text（videoTime に出た字幕）の前後の字幕。覚えていなければ空。 */
    neighbors(text: string, videoTime: number): CaptionNeighbors {
      let i = findIndex(text, videoTime);
      if (i === -1) {
        // ローリング字幕で伸びた後の文に置き換わっている場合は、時刻の近い字幕を対象とみなす。
        const t = normalize(text);
        i = list.findIndex((c) => Math.abs(c.videoTime - videoTime) <= 3 && normalize(c.text).startsWith(t));
      }
      return i === -1 ? {} : pickNeighbors(list, i);
    },
    clear(): void {
      list.length = 0;
    },
  };
}
