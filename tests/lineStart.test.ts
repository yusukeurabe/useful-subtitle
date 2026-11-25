import { describe, it, expect } from 'vitest';
import { createLineStartTracker } from '../src/content/lineStart';

describe('createLineStartTracker — 字幕の頭の時刻', () => {
  it('新しい字幕は、それが出た時刻を頭にする', () => {
    const t = createLineStartTracker();
    expect(t.show('Hello there.', 10)).toBe(10);
    expect(t.show('How are you?', 13)).toBe(13);
  });

  it('YouTube の自動字幕のように単語が書き足されても、頭は最初に出た時刻のまま', () => {
    const t = createLineStartTracker();
    expect(t.show('so today', 20)).toBe(20);
    expect(t.show('so today we are', 20.6)).toBe(20);
    expect(t.show('so today we are going to', 21.3)).toBe(20);
  });

  it('流れる字幕で先頭の語が押し出されたら、いま先頭にある語が出た時刻を頭にする', () => {
    const t = createLineStartTracker();
    t.show('so today', 20);
    t.show('so today we are', 21);
    t.show('so today we are going to talk', 22);
    // 'so today' が消え、'we are going to talk about' になった → 'we are' が出たのは 21 秒
    expect(t.show('we are going to talk about this', 23)).toBe(21);
  });

  it('同じ字幕が一瞬消えてすぐ出直しても（停止中の描き直しなど）、頭は最初の時刻のまま', () => {
    const t = createLineStartTracker();
    t.show('I never said that.', 50);
    t.hide(52.4); // ホバーで止めた位置で一瞬消える
    expect(t.show('I never said that.', 52.4)).toBe(50);
  });

  it('▶で頭へ戻した直後に出直した字幕でも、頭がずれていかない', () => {
    const t = createLineStartTracker();
    t.show('I never said that.', 50);
    t.hide(52); // シークで消える
    expect(t.show('I never said that.', 50.08)).toBe(50);
  });

  it('台詞が書き足されて文が伸びても（Prime の掛け合い）、頭は最初の台詞の時刻', () => {
    const t = createLineStartTracker();
    t.show('- Are you okay?', 30);
    expect(t.show('- Are you okay? - Yeah.', 31.5)).toBe(30);
  });

  it('前の字幕と語が1つだけ偶然かさなっても、別の字幕として扱う', () => {
    const t = createLineStartTracker();
    t.show('I told you', 40);
    expect(t.show('you need to go now', 42)).toBe(42);
  });

  it('しばらく消えていた後に同じ文がまた出たら、新しい字幕として扱う', () => {
    const t = createLineStartTracker();
    t.show('No.', 60);
    t.hide(61);
    expect(t.show('No.', 65)).toBe(65);
  });

  it('頭より前へ巻き戻して同じ文が出たら、新しく出た時刻を頭にする', () => {
    const t = createLineStartTracker();
    t.show('Hello there.', 100);
    t.hide(101);
    expect(t.show('Hello there.', 90)).toBe(90);
  });

  it('reset 後は前の字幕を引き継がない', () => {
    const t = createLineStartTracker();
    t.show('so today', 20);
    t.reset();
    expect(t.show('so today we are', 20.5)).toBe(20.5);
  });

  it('時刻が読めないときはその値をそのまま返し、前の字幕も引き継がない', () => {
    const t = createLineStartTracker();
    t.show('so today', 20);
    expect(t.show('so today we are', NaN)).toBeNaN();
    expect(t.show('so today we are going', 21)).toBe(21);
  });
});
