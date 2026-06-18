import { describe, it, expect } from 'vitest';
import { handleRequest, type HandlerDeps } from '../src/background/handler';
import { AiError, type AnthropicParams } from '../src/background/aiClient';
import { DEFAULT_SETTINGS } from '../src/shared/settings';

function deps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    getSettings: async () => ({ ...DEFAULT_SETTINGS, apiKey: 'sk-ant' }),
    getCached: async () => undefined,
    setCached: async () => {},
    callAi: async () => 'AI_RESULT',
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
});
