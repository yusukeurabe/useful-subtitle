import { describe, it, expect } from 'vitest';
import { createTranscriptRecorder } from '../src/content/transcriptRecorder';

describe('createTranscriptRecorder — 履歴へ記録すべきかの判定', () => {
  it('最初の字幕は時刻に関わらず記録する', () => {
    expect(createTranscriptRecorder().shouldRecord(0)).toBe(true);
    expect(createTranscriptRecorder().shouldRecord(42.5)).toBe(true);
  });

  it('再生位置が前進する字幕は記録する', () => {
    const r = createTranscriptRecorder();
    expect(r.shouldRecord(0)).toBe(true);
    expect(r.shouldRecord(5)).toBe(true);
    expect(r.shouldRecord(10.2)).toBe(true);
  });

  it('記録済み地点まで巻き戻して再生した字幕は記録しない（履歴クリックでの巻き戻し）', () => {
    const r = createTranscriptRecorder();
    [10, 30, 60].forEach((t) => r.shouldRecord(t)); // 0..60 を視聴済み（最大 60）

    // 30 の場面へ戻って 60 まで再生し直す → すべて重複なので記録しない
    expect(r.shouldRecord(30)).toBe(false);
    expect(r.shouldRecord(45)).toBe(false);
    expect(r.shouldRecord(60)).toBe(false);
  });

  it('手動シークバーで巻き戻した分も記録せず、追い越したら記録を再開する', () => {
    const r = createTranscriptRecorder();
    [0, 50, 100].forEach((t) => r.shouldRecord(t)); // 最大 100 まで視聴済み

    // 手動で 20 へ巻き戻して再視聴 → 記録済み範囲は抑制
    expect(r.shouldRecord(20)).toBe(false);
    expect(r.shouldRecord(80)).toBe(false);
    expect(r.shouldRecord(100)).toBe(false);

    // 記録済み地点(100)を追い越したら新規視聴として記録を再開
    expect(r.shouldRecord(101)).toBe(true);
    expect(r.shouldRecord(130)).toBe(true);
  });

  it('同一時刻での再発火は重複とみなして記録しない', () => {
    const r = createTranscriptRecorder();
    expect(r.shouldRecord(10)).toBe(true);
    expect(r.shouldRecord(10)).toBe(false);
  });

  it('reset() でフロンティアが初期化され、新しい動画（小さい時刻）でも記録を再開する', () => {
    const r = createTranscriptRecorder();
    [600, 1800, 3600].forEach((t) => r.shouldRecord(t)); // 別エピソードを最後まで視聴

    // エピソード切替（loadstart 等）でリセット
    r.reset();

    // 新エピソードは時刻 0 付近から始まるが、記録済み最大(3600)に抑制されず記録する
    expect(r.shouldRecord(5)).toBe(true);
    expect(r.shouldRecord(12)).toBe(true);
  });
});
