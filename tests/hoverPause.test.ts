import { describe, it, expect, vi } from 'vitest';
import { createHoverPause } from '../src/content/hoverPause';

/** play/pause と play イベントだけを持つ偽 video。 */
class FakeVideo extends EventTarget {
  paused: boolean;
  isConnected = true;
  constructor(playing: boolean) {
    super();
    this.paused = !playing;
  }
  pause(): void {
    this.paused = true;
  }
  play(): Promise<void> {
    this.paused = false;
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  }
}

/** 実ブラウザ同様、play イベントを後のタスクで届ける偽 video。 */
class AsyncEventFakeVideo extends FakeVideo {
  play(): Promise<void> {
    this.paused = false;
    setTimeout(() => this.dispatchEvent(new Event('play')), 0);
    return Promise.resolve();
  }
}

/** Prime のように生の play() を握り潰し、停止のままにする偽 video。 */
class SwallowPlayFakeVideo extends FakeVideo {
  play(): Promise<void> {
    return Promise.resolve();
  }
}

function setup(video: FakeVideo | null) {
  const cancel = vi.fn();
  const resume = vi.fn((_v: HTMLVideoElement) => cancel);
  const hp = createHoverPause({
    findVideo: () => video as unknown as HTMLVideoElement | null,
    resume,
  });
  return { hp, resume, cancel };
}

describe('createHoverPause', () => {
  it('再生中なら start で止め、end(resume:true) で再開を依頼する', () => {
    const v = new FakeVideo(true);
    const { hp, resume } = setup(v);
    hp.start();
    expect(v.paused).toBe(true);
    hp.end({ resume: true });
    expect(resume).toHaveBeenCalledWith(v);
    hp.end({ resume: true });
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('もともと停止中なら何もせず、end でも再開しない', () => {
    const v = new FakeVideo(false);
    const { hp, resume } = setup(v);
    hp.start();
    hp.end({ resume: true });
    expect(resume).not.toHaveBeenCalled();
  });

  it('end(resume:false) は再開せず、記録も消える', () => {
    const v = new FakeVideo(true);
    const { hp, resume } = setup(v);
    hp.start();
    hp.end({ resume: false });
    hp.end({ resume: true });
    expect(resume).not.toHaveBeenCalled();
    expect(v.paused).toBe(true);
  });

  it('止めたあとユーザーが再生したら、止め直しても end で再開しない', () => {
    const v = new FakeVideo(true);
    const { hp, resume } = setup(v);
    hp.start();
    void v.play(); // スペースキー等の手動再生
    v.pause(); // 手動で止め直す
    hp.end({ resume: true });
    expect(resume).not.toHaveBeenCalled();
  });

  it('start が続けて呼ばれても1回だけ止め、end で再開する', () => {
    const v = new FakeVideo(true);
    const pauseSpy = vi.spyOn(v, 'pause');
    const { hp, resume } = setup(v);
    hp.start();
    hp.start();
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    hp.end({ resume: true });
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('video が無ければ何もしない', () => {
    const { hp, resume } = setup(null);
    expect(() => hp.start()).not.toThrow();
    hp.end({ resume: true });
    expect(resume).not.toHaveBeenCalled();
  });

  it('video がページから外れていたら再開しない', () => {
    const v = new FakeVideo(true);
    const { hp, resume } = setup(v);
    hp.start();
    v.isConnected = false;
    hp.end({ resume: true });
    expect(resume).not.toHaveBeenCalled();
  });

  it('再開の直後にまた start したら、保留中の再開処理を取り消して止め直す', () => {
    const v = new FakeVideo(true);
    const { hp, resume, cancel } = setup(v);
    resume.mockImplementation((video: HTMLVideoElement) => {
      void video.play();
      return cancel;
    });
    hp.start();
    hp.end({ resume: true });
    expect(v.paused).toBe(false);
    hp.start();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(v.paused).toBe(true);
  });

  it('自分の再開で遅れて届く play イベントでは、止め直した記録を消さない', async () => {
    const v = new AsyncEventFakeVideo(true);
    const { hp, resume, cancel } = setup(v);
    resume.mockImplementation((video: HTMLVideoElement) => {
      void video.play();
      return cancel;
    });
    hp.start();
    hp.end({ resume: true }); // play() で paused=false、play イベントは後で届く
    hp.start(); // イベントが届く前に再び入って止め直す
    await new Promise((r) => setTimeout(r, 0)); // 遅れた play イベントを届ける
    hp.end({ resume: true });
    expect(resume).toHaveBeenCalledTimes(2);
  });

  it('Prime が再開の play() を握り潰した直後に入り直しても、外したときに再開を依頼する', () => {
    const v = new SwallowPlayFakeVideo(true);
    const { hp, resume, cancel } = setup(v);
    resume.mockImplementation((video: HTMLVideoElement) => {
      void video.play(); // 握り潰されて paused のまま
      return cancel;
    });
    hp.start();
    hp.end({ resume: true });
    expect(v.paused).toBe(true);
    hp.start(); // 保留中のボタン押下より前に入り直す
    hp.end({ resume: true });
    expect(resume).toHaveBeenCalledTimes(2);
  });

  it('再開が成功した後にユーザーが止めた video は、入り直しても記録し直さない', () => {
    const v = new FakeVideo(true);
    const { hp, resume, cancel } = setup(v);
    resume.mockImplementation((video: HTMLVideoElement) => {
      void video.play(); // 再生に成功し、play イベントも同期で届く
      return cancel;
    });
    hp.start();
    hp.end({ resume: true });
    v.pause(); // ユーザーが手動で止める
    hp.start();
    hp.end({ resume: true });
    expect(resume).toHaveBeenCalledTimes(1);
    expect(v.paused).toBe(true);
  });
});
