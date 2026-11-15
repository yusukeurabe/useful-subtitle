import { describe, it, expect, vi } from 'vitest';
import { createOffscreenAudioPlayer, type OffscreenApi } from '../src/background/offscreenAudio';

const NO_RECEIVER = new Error('Could not establish connection. Receiving end does not exist.');

function api(overrides: Partial<OffscreenApi> = {}): OffscreenApi {
  return {
    hasDocument: vi.fn(async () => true),
    createDocument: vi.fn(async () => {}),
    sendPlay: vi.fn(async () => ({ played: true })),
    ...overrides,
  };
}

describe('createOffscreenAudioPlayer', () => {
  it('Chrome が無音30秒で offscreen を閉じた後でも、作り直して再生する', async () => {
    // 1回目は存在、2回目（30秒後）は Chrome に閉じられて存在しない。
    let alive = true;
    const a = api({
      hasDocument: vi.fn(async () => alive),
      createDocument: vi.fn(async () => { alive = true; }),
    });
    const play = createOffscreenAudioPlayer(a);
    await play('https://x/a.mp3');
    alive = false;
    await play('https://x/b.mp3');
    expect(a.createDocument).toHaveBeenCalledTimes(1);
    expect(a.sendPlay).toHaveBeenLastCalledWith('https://x/b.mp3');
  });

  it('存在確認と実体がずれて受信先が無い場合は、作り直して1回だけ再送する', async () => {
    const sendPlay = vi.fn()
      .mockRejectedValueOnce(NO_RECEIVER)
      .mockResolvedValueOnce({ played: true });
    const hasDocument = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const a = api({ sendPlay, hasDocument });
    await createOffscreenAudioPlayer(a)('https://x/a.mp3');
    expect(sendPlay).toHaveBeenCalledTimes(2);
    expect(a.createDocument).toHaveBeenCalledTimes(1);
  });

  it('offscreen 側で再生に失敗したら例外にする（TTS フォールバックさせるため）', async () => {
    const a = api({ sendPlay: vi.fn(async () => ({ played: false, error: 'NotSupportedError' })) });
    await expect(createOffscreenAudioPlayer(a)('https://x/a.mp3')).rejects.toThrow();
  });

  it('応答が無い（undefined）場合も再生できなかった扱いにする', async () => {
    const a = api({ sendPlay: vi.fn(async () => undefined) });
    await expect(createOffscreenAudioPlayer(a)('https://x/a.mp3')).rejects.toThrow();
  });

  it('既に存在するエラーは成功扱い、同時要求でも作成は1回', async () => {
    let calls = 0;
    const a = api({
      hasDocument: vi.fn(async () => false),
      createDocument: vi.fn(async () => {
        calls++;
        if (calls > 1) throw new Error('Only a single offscreen document may be created.');
      }),
    });
    const play = createOffscreenAudioPlayer(a);
    await Promise.all([play('https://x/a.mp3'), play('https://x/b.mp3')]);
    expect(a.createDocument).toHaveBeenCalledTimes(1);
    await play('https://x/c.mp3'); // 2回目の作成は「既に存在」エラー → 成功扱い
    expect(a.sendPlay).toHaveBeenCalledTimes(3);
  });
});
