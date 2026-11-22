/**
 * 字幕を履歴パネルへ「新規に」記録すべきかを判定する記録ポリシー。
 *
 * 履歴行クリックや再生バーの手動操作で過去へ巻き戻すと、同じ字幕が DOM に
 * 再出現して重複が積み上がる。これを防ぐため「実際に続けて再生した区間
 * （視聴済み区間）」の一覧を保持し、どの視聴済み区間にも入らない字幕だけを
 * 新規として記録する。
 *
 * 以前は「記録済みの最大再生位置（フロンティア）」1つだけで判定していたが、
 * それだと先へ飛ばした後に飛ばした区間へ戻ると、まだ一度も見ていない字幕まで
 * 「フロンティアより前＝視聴済み」とみなされて記録されず、画面の字幕と履歴が
 * 連動しなくなっていた。シーク（{@link TranscriptRecorder.breakRange}）で区間を
 * 区切ることで、飛ばした区間は未視聴のまま残り、戻って見れば記録される。
 *
 * エピソード切替などで再生位置が小さい値に戻る場合は {@link reset} を呼ぶ。
 */
export interface TranscriptRecorder {
  /**
   * videoTime（秒）の字幕を履歴へ新規記録すべきかを返す。
   * 記録する場合（true）は視聴済み区間を広げる副作用を持つ。
   */
  shouldRecord(videoTime: number): boolean;
  /** シークを受けて、いまの視聴済み区間を閉じる（次の字幕から新しい区間）。 */
  breakRange(): void;
  /** 視聴済み区間をすべて忘れる（新しい動画の読み込み時に呼ぶ）。 */
  reset(): void;
}

interface Range { start: number; end: number }

/**
 * 視聴済み区間の集合。`add` で再生位置を足すと、続けて再生している区間（open）を
 * 後ろへ伸ばす。`breakRange`（シーク）で open を閉じ、次の `add` から新しい区間になる。
 * シークイベントを取りこぼしても、open の始点より前へ戻った位置は新しい区間として扱う。
 */
function createPlaybackCoverage() {
  const closed: Range[] = [];
  let open: Range | null = null;
  const inside = (r: Range, t: number): boolean => r.start <= t && t <= r.end;
  const close = (): void => {
    if (open) closed.push(open);
    open = null;
  };
  return {
    /** 閉じた（過去の）視聴済み区間に入っているか。 */
    coversClosed: (t: number): boolean => closed.some((r) => inside(r, t)),
    /** 閉じた区間・いま伸ばしている区間のどちらかに入っているか。 */
    covers: (t: number): boolean => (open !== null && inside(open, t)) || closed.some((r) => inside(r, t)),
    add(t: number): void {
      if (open && t >= open.end) open.end = t;
      else {
        close();
        open = { start: t, end: t };
      }
    },
    breakRange: close,
    reset(): void {
      closed.length = 0;
      open = null;
    },
  };
}

export function createTranscriptRecorder(): TranscriptRecorder {
  const coverage = createPlaybackCoverage();

  return {
    shouldRecord(videoTime: number): boolean {
      if (coverage.covers(videoTime)) return false;
      coverage.add(videoTime);
      return true;
    },
    breakRange: coverage.breakRange,
    reset: coverage.reset,
  };
}

/** YouTube の語単位の追記を同じ履歴 ID にまとめる。Prime の記録規則とは分離する。 */
export function createRollingTranscriptRecorder() {
  let sequence = 0;
  const coverage = createPlaybackCoverage();
  let current: { id: number; english: string; videoTime: number; lastTime: number } | undefined;
  const normalize = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return {
    record(english: string, videoTime: number) {
      if (!Number.isFinite(videoTime)) return null;
      // 記録中の行の続き（同じか後ろの時刻）は、過去の視聴済み区間に入らない限り続けて扱う。
      // それ以外（巻き戻し・視聴済み区間の再生）は記録しない。
      const continuing = current !== undefined && videoTime >= current.lastTime;
      if (continuing ? coverage.coversClosed(videoTime) : coverage.covers(videoTime)) {
        current = undefined;
        return null;
      }
      coverage.add(videoTime);
      const previous = current && normalize(current.english);
      const next = normalize(english);
      // 連続する字幕の追記だけを統合。間が空いた同じ台詞や遠いシーク先は別の行にする。
      if (current && videoTime - current.lastTime <= 3 && videoTime - current.videoTime <= 20
        && previous && next && (next === previous || next.startsWith(`${previous} `) || previous.startsWith(`${next} `))) {
        current.lastTime = videoTime;
        // DOM の入れ替え途中で短くなった字幕で、完成済みの文を削らない。
        if (previous.startsWith(`${next} `)) return null;
        current = { ...current, english };
      } else {
        current = { id: ++sequence, english, videoTime, lastTime: videoTime };
      }
      const { id, videoTime: start } = current;
      return { id, english: current.english, videoTime: start };
    },
    /** シーク・広告などで連続が途切れた。行の統合を止め、視聴済み区間も閉じる。 */
    breakSequence() {
      current = undefined;
      coverage.breakRange();
    },
    reset() {
      current = undefined;
      coverage.reset();
    },
  };
}
