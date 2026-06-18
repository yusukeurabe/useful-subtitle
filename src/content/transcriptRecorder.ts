/**
 * 字幕を履歴パネルへ「新規に」記録すべきかを判定する記録ポリシー。
 *
 * 履歴行クリックや再生バーの手動操作で過去へ巻き戻すと、同じ字幕が DOM に
 * 再出現して重複が積み上がる。これを防ぐため「記録済みの最大再生位置
 * （フロンティア）」を保持し、フロンティアを越える前進だけを新規として記録する。
 * 巻き戻して記録済み範囲を再生し直す間は記録せず、フロンティアを追い越したら
 * 新規視聴とみなして記録を再開する。
 *
 * エピソード切替などで再生位置が小さい値に戻る場合は {@link reset} を呼ぶ。
 */
export interface TranscriptRecorder {
  /**
   * videoTime（秒）の字幕を履歴へ新規記録すべきかを返す。
   * 記録する場合（true）はフロンティアを更新する副作用を持つ。
   */
  shouldRecord(videoTime: number): boolean;
  /** フロンティアを初期化する（新しい動画の読み込み時に呼ぶ）。 */
  reset(): void;
}

export function createTranscriptRecorder(): TranscriptRecorder {
  // 記録済みの最大再生位置。これを厳密に上回る前進だけを新規として記録する。
  let maxRecordedTime = -Infinity;

  return {
    shouldRecord(videoTime: number): boolean {
      if (videoTime > maxRecordedTime) {
        maxRecordedTime = videoTime;
        return true;
      }
      return false;
    },
    reset(): void {
      maxRecordedTime = -Infinity;
    },
  };
}
