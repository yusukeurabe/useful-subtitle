import { describe, it, expect } from 'vitest';
import { extractContentId, createTitleSwitchDetector } from '../src/content/contentIdentity';

describe('extractContentId — URL から作品コードを取り出す', () => {
  it('GTI を含む URL はその GTI を返す（クエリ・ref は無視）', () => {
    expect(
      extractContentId(
        'https://www.amazon.co.jp/gp/video/detail/amzn1.dv.gti.abc123/ref=foo?autoplay=1',
      ),
    ).toBe('amzn1.dv.gti.abc123');
  });

  it('detail パスの ASIN を返す（クエリ・ref は無視）', () => {
    expect(
      extractContentId(
        'https://www.amazon.co.jp/gp/video/detail/B0ABCDEFGH/ref=atv_dp?autoplay=1&t=120',
      ),
    ).toBe('B0ABCDEFGH');
  });

  it('/dp/ パスの ASIN を返す', () => {
    expect(extractContentId('https://www.amazon.co.jp/dp/B0ZZZZ1234')).toBe('B0ZZZZ1234');
  });

  it('同一作品でクエリ・ハッシュだけ違う URL は同じ id になる', () => {
    const a = extractContentId('https://www.amazon.co.jp/gp/video/detail/B0ABCDEFGH/ref=a?t=1');
    const b = extractContentId('https://www.amazon.co.jp/gp/video/detail/B0ABCDEFGH/ref=b?t=999#x');
    expect(a).toBe(b);
    expect(a).toBe('B0ABCDEFGH');
  });

  it('作品コードを含まない URL は空文字を返す', () => {
    expect(extractContentId('https://www.amazon.co.jp/gp/video/storefront')).toBe('');
  });
});

describe('createTitleSwitchDetector — 作品切替の判定', () => {
  const movie = (id: string, durationRaw: number) => ({ id, durationRaw });

  it('初回は基準確立のみで false（起動直後に消さない）', () => {
    const d = createTitleSwitchDetector();
    expect(d.check(movie('B0A', 2520))).toBe(false);
  });

  it('同じ id・同じ尺なら false（同一作品の通常再生）', () => {
    const d = createTitleSwitchDetector();
    d.check(movie('B0A', 2520));
    expect(d.check(movie('B0A', 2520))).toBe(false);
  });

  it('id が変われば true（別作品・別エピソード）', () => {
    const d = createTitleSwitchDetector();
    d.check(movie('B0A', 2520));
    expect(d.check(movie('B0B', 2520))).toBe(true);
  });

  it('尺が閾値を超えて変わると true（URL が変わらない切替の backstop）', () => {
    const d = createTitleSwitchDetector();
    d.check(movie('B0A', 2520));
    expect(d.check(movie('B0A', 1800))).toBe(true);
  });

  it('短い尺（広告）は尺シグナルとして無視し、誤発火しない', () => {
    const d = createTitleSwitchDetector();
    d.check(movie('B0A', 2520)); // 本編の基準
    expect(d.check(movie('B0A', 30))).toBe(false); // 広告(30秒) → 無視
    expect(d.check(movie('B0A', 2520))).toBe(false); // 本編へ復帰 → 消さない
  });

  it('duration が NaN / Infinity のときは尺シグナルを無視する', () => {
    const d = createTitleSwitchDetector();
    d.check(movie('B0A', 2520));
    expect(d.check(movie('B0A', NaN))).toBe(false);
    expect(d.check(movie('B0A', Infinity))).toBe(false);
  });

  it('id が空文字なら良い基準を上書きせず、単独で切替判定もしない', () => {
    const d = createTitleSwitchDetector();
    d.check(movie('B0A', 2520)); // 基準 id=B0A
    expect(d.check(movie('', 2520))).toBe(false); // id 取れず → 消さない
    expect(d.check(movie('B0B', 2520))).toBe(true); // 基準は B0A のまま → B0B で切替
  });

  it('尺差が許容閾値内（微小ゆらぎ）なら false', () => {
    const d = createTitleSwitchDetector({ durationToleranceSeconds: 1 });
    d.check(movie('B0A', 2520));
    expect(d.check(movie('B0A', 2520.4))).toBe(false);
  });

  it('id が無くても尺だけで切替を拾える（非破壊の backstop）', () => {
    const d = createTitleSwitchDetector();
    d.check(movie('', 2520)); // id 無し、尺で基準
    expect(d.check(movie('', 2520))).toBe(false);
    expect(d.check(movie('', 1500))).toBe(true); // 別尺 → 切替
  });
});
