/**
 * 画面の字幕の「頭」の時刻（▶＝字幕の頭から再生 の戻り先）を決める部品。
 *
 * 字幕の監視は、文字が変わるたび・一瞬消えて出直すたびに字幕を通知し直す。
 * その通知の瞬間の再生位置をそのまま頭にすると、次の場合に頭が字幕の途中へずれる。
 * - YouTube の自動字幕のように、単語が少しずつ書き足される（書き足すたびに頭が後ろへ）
 * - Prime の掛け合いのように、同じ字幕に台詞が書き足される
 * - ホバー停止や操作バーの表示で字幕が描き直され、一瞬消えて同じ文が出直す
 * そこで単語ごとに「最初に出た時刻」を覚えておき、前の字幕の続きとみなせるときは
 * 引き継ぐ。字幕の頭は、いま先頭にある単語が最初に出た時刻とする。
 *
 * さらに、シーク（巻き戻しボタン・シークバー・字幕リスト）で字幕の途中に着地すると、
 * 字幕は着地した瞬間に途中から画面に出る。その時刻を頭にすると▶が字幕の途中へ戻る。
 * そこで普通に再生していて出た字幕の頭を「字幕の文 → 頭の時刻」として覚えておき、
 * シーク直後に出た字幕は、覚えている頭の時刻を使う（巻き戻し先はふつう一度見た字幕）。
 */
export interface LineStartTracker {
  /** text が videoTime（秒）に表示された。この字幕の頭の時刻を返す。 */
  show(text: string, videoTime: number): number;
  /** 字幕が消えた（videoTime はそのときの再生位置）。 */
  hide(videoTime: number): void;
  /** 本編がシークされた（landing は着地した再生位置）。直後に出る字幕は途中から出たものとみなす。 */
  seeked(landing: number): void;
  /** 広告などで、いま出ている字幕を引き継がないようにする（覚えた頭の時刻は残す）。 */
  reset(): void;
  /** 別の動画に切り替わった。覚えた頭の時刻も含めてすべて忘れる。 */
  clear(): void;
}

/** 消えていた字幕を「出直し」とみなす最大の再生時間（秒）。 */
const REAPPEAR_GAP = 1;
/** 頭より少し前で出直しても続きとみなす幅（秒）。読み取りの揺れを吸収する。 */
const BACK_TOLERANCE = 0.3;
/** 先頭の語が押し出された字幕を続きとみなすのに要る、かさなる語数。 */
const MIN_ROLLING_OVERLAP = 3;
/**
 * シークの着地からこの秒数以内に出た字幕は「途中から出た」可能性があるとみなす。
 * 途中に着地すると字幕は着地と同時に出る（実測 0.03 秒ほど）。それより遅れて出た字幕は、
 * 再生が進んで本当に始まったものなので、ふつうの字幕と同じに扱う。
 */
const AFTER_SEEK_WINDOW = 0.35;
/** 覚えている頭を使ってよい、着地点からさかのぼる最大の秒数（別の場面の同じ文を拾わないため）。 */
const MAX_LOOKBACK = 12;
/** 覚えておく字幕の文の数の上限。 */
const MAX_REMEMBERED = 3000;

interface Word {
  key: string;
  time: number;
}

const splitWords = (text: string): string[] => text.split(/\s+/).filter(Boolean);

/**
 * 前の字幕の語のうち、どこから先が新しい字幕の先頭とそのまま一致するかを返す。
 * 前の字幕がまるごと新しい字幕の先頭にある（書き足し・出直し）なら 0。
 * 先頭の語が押し出された場合は、かさなりが MIN_ROLLING_OVERLAP 語以上のときだけ認める
 * （1〜2語の偶然の一致で前の字幕の時刻を引き継がないため）。無ければ -1。
 */
function findOverlap(prev: readonly Word[], next: readonly string[]): number {
  for (let i = 0; i < prev.length; i++) {
    const overlap = prev.length - i;
    if (overlap > next.length) continue;
    if (i > 0 && overlap < MIN_ROLLING_OVERLAP) break;
    let match = true;
    for (let j = 0; j < overlap; j++) {
      if (prev[i + j].key !== next[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

const normalizeKey = (text: string): string => splitWords(text).join(' ').toLowerCase();

export function createLineStartTracker(): LineStartTracker {
  let words: Word[] = [];
  // 字幕が消えた時の再生位置。表示中は null。
  let hiddenAt: number | null = null;
  // 最後にシークした着地点。
  let lastSeek: number | null = null;
  // 普通に再生していて出た字幕の頭の時刻（字幕の文 → 頭の時刻の一覧）。
  const knownStarts = new Map<string, number[]>();

  const reset = (): void => {
    words = [];
    hiddenAt = null;
  };

  const remember = (key: string, start: number): void => {
    const list = knownStarts.get(key);
    if (list) {
      if (!list.includes(start)) list.push(start);
      return;
    }
    if (knownStarts.size >= MAX_REMEMBERED) {
      const oldest = knownStarts.keys().next().value;
      if (oldest !== undefined) knownStarts.delete(oldest);
    }
    knownStarts.set(key, [start]);
  };

  /** 着地点 videoTime で出た字幕 key の、覚えている頭（着地点より前で一番近いもの）。 */
  const lookup = (key: string, videoTime: number): number | undefined => {
    let best: number | undefined;
    for (const start of knownStarts.get(key) ?? []) {
      if (start > videoTime + BACK_TOLERANCE || videoTime - start > MAX_LOOKBACK) continue;
      if (best === undefined || start > best) best = start;
    }
    return best;
  };

  return {
    show(text, videoTime) {
      if (!Number.isFinite(videoTime)) {
        reset();
        return videoTime;
      }
      // 大文字小文字は比べない（truecase で文頭の語の大文字が変わることがあるため）。
      const keys = splitWords(text).map((w) => w.toLowerCase());
      const continuing = words.length > 0
        && videoTime >= words[0].time - BACK_TOLERANCE
        && (hiddenAt === null || videoTime - hiddenAt <= REAPPEAR_GAP);
      const offset = continuing ? findOverlap(words, keys) : -1;
      // シークの着地と同時に出た字幕は、途中から出たのかもしれない。
      const afterSeek = lastSeek !== null
        && videoTime >= lastSeek - BACK_TOLERANCE
        && videoTime - lastSeek <= AFTER_SEEK_WINDOW;
      const key = normalizeKey(text);
      // 前の字幕の続きではない新しい字幕がシーク直後に出たら、覚えている頭を使う。
      const known = offset < 0 && afterSeek ? lookup(key, videoTime) : undefined;
      words = keys.map((k, j) => {
        const inherited = offset >= 0 ? words[offset + j] : undefined;
        return { key: k, time: inherited ? inherited.time : known ?? videoTime };
      });
      hiddenAt = null;
      const start = words.length > 0 ? words[0].time : videoTime;
      // 途中から出たかもしれない時刻は、頭として覚えない（後で引き当てて▶が途中へ戻るため）。
      if (!afterSeek && key) remember(key, start);
      return start;
    },
    hide(videoTime) {
      if (words.length === 0) return;
      if (!Number.isFinite(videoTime)) {
        reset();
        return;
      }
      // 消えている間の通知が続いても、最初に消えた位置を保つ。
      if (hiddenAt === null) hiddenAt = videoTime;
    },
    seeked(landing) {
      lastSeek = Number.isFinite(landing) ? landing : null;
    },
    reset,
    clear() {
      reset();
      lastSeek = null;
      knownStarts.clear();
    },
  };
}
