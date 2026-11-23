import { describe, it, expect } from 'vitest';
import { createCaptionTimeline, pickNeighbors } from '../src/content/captionContext';

const at = (text: string, videoTime: number) => ({ text, videoTime });

describe('pickNeighbors', () => {
  const list = [at('A', 0), at('B', 2), at('C', 4), at('D', 6), at('E', 8)];

  it('前後の字幕を2件ずつ、出た順に返す', () => {
    expect(pickNeighbors(list, 2)).toEqual({ before: ['A', 'B'], after: ['D', 'E'] });
  });

  it('端では無い側を省く', () => {
    expect(pickNeighbors(list, 0)).toEqual({ after: ['B', 'C'] });
    expect(pickNeighbors([at('only', 0)], 0)).toEqual({});
  });

  it('間が空いた字幕は別の場面とみなして渡さない', () => {
    const gap = [at('old scene', 0), at('I am gonna take', 30), at('a rain check.', 32), at('later', 60)];
    expect(pickNeighbors(gap, 1)).toEqual({ after: ['a rain check.'] });
  });

  it('同じ文の重複は前後に含めない', () => {
    expect(pickNeighbors([at('Hi', 0), at('Hi', 1), at('There', 2)], 1)).toEqual({ after: ['There'] });
  });
});

describe('createCaptionTimeline', () => {
  it('時刻順に覚え、前後の字幕を引ける', () => {
    const t = createCaptionTimeline();
    t.add("I'm gonna take", 10);
    t.add('a rain check on that.', 12);
    t.add('Okay.', 14);
    expect(t.neighbors("I'm gonna take", 10)).toEqual({ after: ['a rain check on that.', 'Okay.'] });
    expect(t.neighbors('a rain check on that.', 12)).toEqual({ before: ["I'm gonna take"], after: ['Okay.'] });
  });

  it('巻き戻して見直しても重複せず、見直し時は次の字幕も引ける', () => {
    const t = createCaptionTimeline();
    t.add("I'm gonna take", 10);
    t.add('a rain check on that.', 12);
    t.add("I'm gonna take", 10.3); // 巻き戻して再表示
    expect(t.neighbors("I'm gonna take", 10.3)).toEqual({ after: ['a rain check on that.'] });
  });

  it('先へ飛ばした後に戻って見た字幕も時刻どおりの位置に入る', () => {
    const t = createCaptionTimeline();
    t.add('first', 0);
    t.add('third', 4);
    t.add('second', 2);
    expect(t.neighbors('second', 2)).toEqual({ before: ['first'], after: ['third'] });
  });

  it('語単位で伸びるローリング字幕は1件にまとめる', () => {
    const t = createCaptionTimeline();
    t.add('before this', 8);
    t.add("I'm gonna", 10);
    t.add("I'm gonna take", 10.5);
    t.add('a rain check', 13);
    expect(t.neighbors("I'm gonna", 10)).toEqual({ before: ['before this'], after: ['a rain check'] });
    expect(t.neighbors("I'm gonna take", 10.5)).toEqual({ before: ['before this'], after: ['a rain check'] });
  });

  it('clear で忘れる', () => {
    const t = createCaptionTimeline();
    t.add('a', 0);
    t.add('b', 1);
    t.clear();
    expect(t.neighbors('a', 0)).toEqual({});
  });
});
