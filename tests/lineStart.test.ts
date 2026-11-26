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

  describe('シーク（巻き戻し・シークバー・字幕リスト）の直後', () => {
    it('巻き戻して前に見た字幕の途中に着地しても、頭はその字幕が最初に出た時刻', () => {
      const t = createLineStartTracker();
      t.show('Suddenly, after I ate my chicken rice', 172.66);
      t.show('I went to the store', 176.4);
      t.hide(181.9);
      t.seeked(171.9 + 2.8); // ↺10 で 174.7 に着地（字幕の途中）
      expect(t.show('Suddenly, after I ate my chicken rice', 174.75)).toBe(172.66);
    });

    it('一度も見ていない字幕の途中に着地したら、着地した時刻を頭にする（推測できないため）', () => {
      const t = createLineStartTracker();
      t.seeked(300);
      expect(t.show('Never seen before.', 300.03)).toBe(300.03);
    });

    it('シーク直後に途中から出た時刻は、字幕の頭として覚えない', () => {
      const t = createLineStartTracker();
      t.seeked(50);
      t.show('Hello there my friend.', 50.02); // 途中から出た（本当の頭は不明）
      t.hide(52);
      // 普通に再生していて同じ文が出ても、途中の時刻 50.02 を引き当てない
      t.seeked(48);
      expect(t.show('Hello there my friend.', 48.03)).toBe(48.03);
    });

    it('シーク後、しばらく再生してから出た字幕は普通に記録する', () => {
      const t = createLineStartTracker();
      t.seeked(100);
      t.show('First line here.', 100.02);
      expect(t.show('Second line now.', 103.5)).toBe(103.5);
      t.hide(106);
      t.seeked(104.8);
      expect(t.show('Second line now.', 104.83)).toBe(103.5);
    });

    it('同じ文が何度も出る場合は、着地点より前で一番近いものを使う', () => {
      const t = createLineStartTracker();
      t.show('Yeah.', 10);
      t.hide(11);
      t.show('Something else entirely.', 12);
      t.show('Yeah.', 20);
      t.hide(21);
      t.seeked(20.5);
      expect(t.show('Yeah.', 20.52)).toBe(20);
    });

    it('覚えている頭が着地点から離れすぎていたら使わない（別の場面の同じ文）', () => {
      const t = createLineStartTracker();
      t.show('Okay.', 10);
      t.hide(11);
      t.seeked(60);
      expect(t.show('Okay.', 60.02)).toBe(60.02);
    });

    it('▶で頭へ戻ったときも頭がずれていかない', () => {
      const t = createLineStartTracker();
      t.show('Previous line.', 40);
      t.show('Target line is here.', 42);
      t.hide(44); // ▶でシークして消える
      t.seeked(42);
      expect(t.show('Target line is here.', 42.03)).toBe(42);
    });

    it('clear 後は覚えた頭を使わない（別の動画）', () => {
      const t = createLineStartTracker();
      t.show('Same words.', 10);
      t.clear();
      t.seeked(12);
      expect(t.show('Same words.', 12.02)).toBe(12.02);
    });

    it('reset（広告など）では覚えた頭は残す', () => {
      const t = createLineStartTracker();
      t.show('Before the ad.', 10);
      t.show('Next line.', 13);
      t.reset();
      t.seeked(11);
      expect(t.show('Before the ad.', 11.02)).toBe(10);
    });
  });
});
