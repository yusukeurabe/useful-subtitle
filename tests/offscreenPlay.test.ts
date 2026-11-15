import { describe, it, expect, vi } from 'vitest';
import { createAudioPlayer } from '../src/offscreen/play';

function fakeAudio(play: () => Promise<void>) {
  return { play: vi.fn(play), pause: vi.fn() };
}

describe('createAudioPlayer (offscreen)', () => {
  it('再生開始できたら played:true', async () => {
    const audio = fakeAudio(async () => {});
    const play = createAudioPlayer(() => audio);
    expect(await play('https://x/a.mp3')).toEqual({ played: true });
  });

  it('再生に失敗したら played:false を返す（以前は常に成功扱いで無音になっていた）', async () => {
    const audio = fakeAudio(async () => { throw new Error('NotSupportedError'); });
    const play = createAudioPlayer(() => audio);
    expect(await play('https://x/404.mp3')).toMatchObject({ played: false });
  });

  it('読み込みが終わらない場合はタイムアウトで played:false にして止める', async () => {
    vi.useFakeTimers();
    try {
      const audio = fakeAudio(() => new Promise<void>(() => {}));
      const play = createAudioPlayer(() => audio, 1000);
      const result = play('https://x/slow.mp3');
      await vi.advanceTimersByTimeAsync(1000);
      expect(await result).toMatchObject({ played: false });
      expect(audio.pause).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('新しい再生を始めるときは前の音声を止める', async () => {
    const first = fakeAudio(async () => {});
    const second = fakeAudio(async () => {});
    const audios = [first, second];
    const play = createAudioPlayer(() => audios.shift()!);
    await play('https://x/a.mp3');
    await play('https://x/b.mp3');
    expect(first.pause).toHaveBeenCalled();
  });
});
