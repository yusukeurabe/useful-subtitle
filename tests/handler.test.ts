import { describe, it, expect, vi } from 'vitest';
import { handleRequest, type HandlerDeps } from '../src/background/handler';
import { AiError, callAnthropic, type AnthropicParams } from '../src/background/aiClient';
import { DEFAULT_SETTINGS } from '../src/shared/settings';

function deps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    getSettings: async () => ({ ...DEFAULT_SETTINGS, apiKey: 'sk-ant' }),
    getCached: async () => undefined,
    setCached: async () => {},
    callAi: async () => 'AI_RESULT',
    callSubscription: async () => 'NATIVE',
    getWordInfo: async () => ({ ipa: null, audioUrl: null }),
    playOffscreenAudio: async () => {},
    loginSubscription: async () => {},
    ...overrides,
  };
}

describe('handleRequest', () => {
  it('returns NO_API_KEY when the key is empty', async () => {
    const res = await handleRequest(
      { type: 'translateLine', text: 'Hello' },
      deps({ getSettings: async () => DEFAULT_SETTINGS }),
    );
    expect(res).toEqual({ ok: false, code: 'NO_API_KEY', error: expect.any(String) });
  });

  it('translates on a cache miss and stores the result', async () => {
    let stored: [string, string] | null = null;
    const res = await handleRequest(
      { type: 'translateLine', text: 'Hello' },
      deps({
        setCached: async (k: string, v: string) => {
          stored = [k, v];
        },
      }),
    );
    expect(res).toEqual({ ok: true, text: 'AI_RESULT' });
    expect(stored![1]).toBe('AI_RESULT');
  });

  it('does not cache a refusal returned by the Messages API', async () => {
    const setCached = vi.fn(async () => {});
    const fakeFetch = async () => new Response(JSON.stringify({
      stop_reason: 'refusal',
      content: [{ type: 'text', text: 'I cannot answer this request.' }],
    }), { status: 200 });
    const res = await handleRequest(
      { type: 'translateLine', text: 'Hello' },
      deps({ callAi: (params) => callAnthropic(params, fakeFetch as typeof fetch), setCached }),
    );
    expect(res).toEqual({ ok: false, code: 'UNKNOWN', error: expect.stringContaining('拒否') });
    expect(setCached).not.toHaveBeenCalled();
  });

  it('returns the cached value without calling the AI', async () => {
    let aiCalled = false;
    const res = await handleRequest(
      { type: 'translateLine', text: 'Hello' },
      deps({
        getCached: async () => 'CACHED',
        callAi: async () => {
          aiCalled = true;
          return 'AI_RESULT';
        },
      }),
    );
    expect(res).toEqual({ ok: true, text: 'CACHED' });
    expect(aiCalled).toBe(false);
  });

  it('maps an AiError to an error response with its code', async () => {
    const res = await handleRequest(
      { type: 'explainSelection', selection: 'x', context: 'y' },
      deps({
        callAi: async () => {
          throw new AiError('RATE_LIMIT', 'too many');
        },
      }),
    );
    expect(res).toEqual({ ok: false, code: 'RATE_LIMIT', error: 'too many' });
  });

  it('passes the selected phrase to the AI for explainSelection', async () => {
    let received: AnthropicParams | null = null;
    await handleRequest(
      { type: 'explainSelection', selection: 'break a leg', context: 'break a leg!' },
      deps({
        callAi: async (p: AnthropicParams) => {
          received = p;
          return 'ok';
        },
      }),
    );
    expect(received!.user).toContain('break a leg');
  });

  it('前後の字幕を解説プロンプトに渡す（explainSelection / explainSentence）', async () => {
    const users: string[] = [];
    const d = deps({
      callAi: async (p: AnthropicParams) => {
        users.push(p.user);
        return 'ok';
      },
    });
    await handleRequest({ type: 'explainSelection', selection: 'take', context: "I'm gonna take", after: ['a rain check.'] }, d);
    await handleRequest({ type: 'explainSentence', text: "I'm gonna take", before: ['So?'] }, d);
    expect(users[0]).toContain('次の字幕: "a rain check."');
    expect(users[1]).toContain('前の字幕: "So?"');
  });

  it('1単語の解説では辞書の品詞を引いてプロンプトに渡す', async () => {
    let system = '';
    const looked: string[] = [];
    await handleRequest(
      { type: 'explainSelection', selection: 'Incremental.', context: '$30 trillion a year incremental.' },
      deps({
        getWordInfo: async (w: string) => {
          looked.push(w);
          return { ipa: null, audioUrl: null, pos: ['adjective'] };
        },
        callAi: async (p: AnthropicParams) => {
          system = p.system;
          return 'ok';
        },
      }),
    );
    expect(looked).toEqual(['incremental']);
    expect(system).toContain('辞書に載っている品詞: adjective');
  });

  it('キャッシュがあれば辞書を引かない・フレーズでは辞書を引かない', async () => {
    const getWordInfo = vi.fn(async () => ({ ipa: null, audioUrl: null, pos: ['noun'] }));
    await handleRequest({ type: 'explainSelection', selection: 'x', context: 'y' }, deps({ getWordInfo, getCached: async () => 'cached' }));
    await handleRequest({ type: 'explainSelection', selection: 'break a leg', context: 'y' }, deps({ getWordInfo }));
    expect(getWordInfo).not.toHaveBeenCalled();
  });

  it('辞書が失敗しても解説は続ける', async () => {
    const res = await handleRequest(
      { type: 'explainSelection', selection: 'word', context: 'a word' },
      deps({ getWordInfo: async () => { throw new Error('offline'); } }),
    );
    expect(res).toEqual({ ok: true, text: 'AI_RESULT' });
  });

  it('辞書の応答が遅いときは待ちすぎずに解説を続ける', async () => {
    vi.useFakeTimers();
    try {
      let system = '';
      const pending = handleRequest(
        { type: 'explainSelection', selection: 'word', context: 'a word' },
        deps({
          getWordInfo: () => new Promise(() => {}),
          callAi: async (p: AnthropicParams) => {
            system = p.system;
            return 'ok';
          },
        }),
      );
      await vi.advanceTimersByTimeAsync(5000);
      expect(await pending).toEqual({ ok: true, text: 'ok' });
      expect(system).not.toContain('辞書に載っている品詞:');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Cambridge の定義の候補を渡し、応答の番号を原文にしてから保存して返す', async () => {
    let system = '';
    let stored = '';
    const res = await handleRequest(
      { type: 'explainSelection', selection: 'incremental', context: '$30 trillion a year incremental.' },
      deps({
        getWordInfo: async () => ({
          ipa: null,
          audioUrl: null,
          pos: ['adjective'],
          definitions: [{ pos: 'adjective', defs: ['in a series of amounts', 'happening gradually, in a series of small amounts'] }],
        }),
        callAi: async (p: AnthropicParams) => {
          system = p.system;
          return 'Adj.: 増分の・追加の | [2]\n説明: x';
        },
        setCached: async (_k: string, v: string) => {
          stored = v;
        },
      }),
    );
    expect(system).toContain('[2] (adjective) happening gradually, in a series of small amounts');
    const expected = 'Adj.: 増分の・追加の | happening gradually, in a series of small amounts\n説明: x';
    expect(res).toEqual({ ok: true, text: expected });
    expect(stored).toBe(expected);
  });

  it('辞書に定義が無ければ候補を渡さず、応答もそのまま', async () => {
    let system = '';
    const res = await handleRequest(
      { type: 'explainSelection', selection: 'word', context: 'a word' },
      deps({
        getWordInfo: async () => ({ ipa: null, audioUrl: null, pos: ['noun'] }),
        callAi: async (p: AnthropicParams) => {
          system = p.system;
          return 'N[C]: 語 | a unit of language';
        },
      }),
    );
    expect(system).not.toContain('Cambridge 辞書の英語の定義の候補');
    expect(res).toEqual({ ok: true, text: 'N[C]: 語 | a unit of language' });
  });

  it('handles lookupWord without an API key and returns word info', async () => {
    const res = await handleRequest(
      { type: 'lookupWord', text: 'resilient' },
      deps({
        getSettings: async () => DEFAULT_SETTINGS, // キーなし
        getWordInfo: async () => ({ ipa: '/rɪˈzɪliənt/', audioUrl: 'https://x/r-us.mp3' }),
      }),
    );
    expect(res).toEqual({
      ok: true,
      kind: 'word',
      ipa: '/rɪˈzɪliənt/',
      audioUrl: 'https://x/r-us.mp3',
    });
  });

  it('lookupWord returns nulls for a phrase without calling getWordInfo', async () => {
    let called = false;
    const res = await handleRequest(
      { type: 'lookupWord', text: 'break a leg' },
      deps({
        getWordInfo: async () => {
          called = true;
          return { ipa: 'x', audioUrl: 'y' };
        },
      }),
    );
    expect(res).toEqual({ ok: true, kind: 'word', ipa: null, audioUrl: null });
    expect(called).toBe(false);
  });

  it('playAudio plays via offscreen and reports played=true (no API key needed)', async () => {
    let playedUrl = '';
    const res = await handleRequest(
      { type: 'playAudio', url: 'https://x/a.mp3' },
      deps({
        getSettings: async () => DEFAULT_SETTINGS, // キーなし
        playOffscreenAudio: async (u: string) => {
          playedUrl = u;
        },
      }),
    );
    expect(res).toEqual({ ok: true, kind: 'audio', played: true });
    expect(playedUrl).toBe('https://x/a.mp3');
  });

  it('playAudio with empty url reports played=false', async () => {
    let called = false;
    const res = await handleRequest(
      { type: 'playAudio', url: '' },
      deps({
        playOffscreenAudio: async () => {
          called = true;
        },
      }),
    );
    expect(res).toEqual({ ok: true, kind: 'audio', played: false });
    expect(called).toBe(false);
  });

  it('explainSentence asks the AI about the whole sentence and stores it', async () => {
    let received: AnthropicParams | null = null;
    let stored: [string, string] | null = null;
    const res = await handleRequest(
      { type: 'explainSentence', text: 'I could eat a horse.' },
      deps({
        callAi: async (p: AnthropicParams) => {
          received = p;
          return 'AI_SENTENCE';
        },
        setCached: async (k: string, v: string) => {
          stored = [k, v];
        },
      }),
    );
    expect(res).toEqual({ ok: true, text: 'AI_SENTENCE' });
    expect(received!.user).toContain('I could eat a horse.');
    expect(received!.system).toContain('訳:');
    expect(stored![1]).toBe('AI_SENTENCE');
  });

  it('explainSentence returns the cached value without calling the AI', async () => {
    let aiCalled = false;
    const res = await handleRequest(
      { type: 'explainSentence', text: 'Hello' },
      deps({
        getCached: async () => 'CACHED_S',
        callAi: async () => {
          aiCalled = true;
          return 'x';
        },
      }),
    );
    expect(res).toEqual({ ok: true, text: 'CACHED_S' });
    expect(aiCalled).toBe(false);
  });
});

describe('subscription routing', () => {
  it.each(['ping', 'translateLine', 'explainSentence', 'explainSelection'] as const)('routes %s without API key and never passes it to native', async type => {
    const callAi = vi.fn();
    const callSubscription = vi.fn<HandlerDeps['callSubscription']>(async () => 'NATIVE');
    const res = await handleRequest(
      { type, text: 'Hi', selection: 'Hi', context: 'Hi' },
      deps({ getSettings: async () => ({ ...DEFAULT_SETTINGS, provider: 'claude-subscription' }), callAi, callSubscription }),
      { tabId: 42 },
    );
    expect(res).toEqual({ ok: true, text: 'NATIVE' });
    expect(callAi).not.toHaveBeenCalled();
    expect(callSubscription.mock.calls[0]![0]).not.toHaveProperty('apiKey');
    expect(callSubscription).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ tabId: 42, kind: type === 'translateLine' ? 'translation' : 'interactive' }));
  });
  it('does not dispatch or return cached data after context invalidation during async cache read', async () => {
    let current = true;
    const callSubscription = vi.fn();
    const res = await handleRequest({ type: 'translateLine', text: 'Hi' }, deps({
      getSettings: async () => ({ ...DEFAULT_SETTINGS, provider: 'claude-subscription' }),
      getCached: async () => { current = false; return 'STALE'; }, callSubscription,
    }), { isCurrent: () => current });
    expect(res).toMatchObject({ ok: false, code: 'CANCELED' });
    expect(callSubscription).not.toHaveBeenCalled();
  });
});

it('rejects an unsupported provider without falling back to paid API', async () => {
  const callAi = vi.fn();
  const result = await handleRequest({ type: 'ping' }, deps({ getSettings: async () => ({ ...DEFAULT_SETTINGS, apiKey: 'saved', provider: 'unknown' as never }), callAi }));
  expect(result).toMatchObject({ ok: false, code: 'UNKNOWN' });
  expect(callAi).not.toHaveBeenCalled();
});

it('does not cache an AI result after the context changes', async () => {
  let current = true;
  const setCached = vi.fn();
  const result = await handleRequest({ type: 'translateLine', text: 'hello' }, deps({ callAi: async () => { current = false; return 'stale'; }, setCached }), { isCurrent: () => current });
  expect(result).toMatchObject({ code: 'CANCELED' });
  expect(setCached).not.toHaveBeenCalled();
});
