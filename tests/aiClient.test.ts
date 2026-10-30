import { describe, it, expect } from 'vitest';
import {
  buildAnthropicRequest,
  parseAnthropicResponse,
  callAnthropic,
} from '../src/background/aiClient';

const base = {
  apiKey: 'sk-ant-test',
  model: 'claude-haiku-5-5',
  system: 'sys',
  user: 'usr',
};

describe('buildAnthropicRequest', () => {
  it('targets the Anthropic messages endpoint with POST', () => {
    const { url, init } = buildAnthropicRequest(base);
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
  });

  it('sets the auth, version, and browser-access headers', () => {
    const { init } = buildAnthropicRequest(base);
    const h = init.headers as Record<string, string>;
    expect(h['x-api-key']).toBe('sk-ant-test');
    expect(h['anthropic-version']).toBeTruthy();
    expect(h['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(h['content-type']).toContain('application/json');
  });

  it('disables thinking for the exact Haiku 5.5 model', () => {
    const { init } = buildAnthropicRequest(base);
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('top_p');
    expect(body).not.toHaveProperty('top_k');
  });

  it.each(['custom-model', 'claude-haiku-4-5-20251001', 'claude-haiku-5-5-custom'])(
    'leaves thinking configuration untouched for %s', (model) => {
      const { init } = buildAnthropicRequest({ ...base, model });
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe(model);
      expect(body).not.toHaveProperty('thinking');
    },
  );

  it('encodes model, system, and a single user message in the body', () => {
    const { init } = buildAnthropicRequest(base);
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(base.model);
    expect(body.system).toBe('sys');
    expect(body.messages).toEqual([{ role: 'user', content: 'usr' }]);
    expect(body.max_tokens).toBeGreaterThan(0);
  });
});

describe('parseAnthropicResponse', () => {
  it('extracts and trims text from the content blocks', () => {
    const text = parseAnthropicResponse({ content: [{ type: 'text', text: '  こんにちは  ' }] });
    expect(text).toBe('こんにちは');
  });

  it('ignores thinking blocks and returns only answer text', () => {
    expect(parseAnthropicResponse({ content: [
      { type: 'thinking', thinking: 'Internal summary', text: 'Not answer text' },
      { type: 'text', text: '翻訳結果' },
    ] })).toBe('翻訳結果');
  });

  it('concatenates multiple text blocks', () => {
    const text = parseAnthropicResponse({
      content: [
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ],
    });
    expect(text).toBe('ab');
  });
});

describe('callAnthropic', () => {
  const okResponse = (text: string) =>
    new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status: 200 });

  it('returns the model text on success', async () => {
    const fakeFetch = async () => okResponse('翻訳結果');
    const out = await callAnthropic(base, fakeFetch as unknown as typeof fetch);
    expect(out).toBe('翻訳結果');
  });

  it('rejects a refusal even when it includes text', async () => {
    const fakeFetch = async () => new Response(JSON.stringify({
      stop_reason: 'refusal',
      content: [{ type: 'text', text: 'I cannot answer this request.' }],
    }), { status: 200 });
    await expect(callAnthropic(base, fakeFetch as typeof fetch)).rejects.toMatchObject({
      name: 'AiError', code: 'UNKNOWN', message: expect.stringContaining('拒否'),
    });
  });

  it('throws AUTH on 401', async () => {
    const fakeFetch = async () => new Response('unauthorized', { status: 401 });
    await expect(
      callAnthropic(base, fakeFetch as unknown as typeof fetch),
    ).rejects.toMatchObject({ code: 'AUTH' });
  });

  it('throws RATE_LIMIT on 429', async () => {
    const fakeFetch = async () => new Response('slow down', { status: 429 });
    await expect(
      callAnthropic(base, fakeFetch as unknown as typeof fetch),
    ).rejects.toMatchObject({ code: 'RATE_LIMIT' });
  });

  it('throws NETWORK when fetch rejects', async () => {
    const fakeFetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(
      callAnthropic(base, fakeFetch as unknown as typeof fetch),
    ).rejects.toMatchObject({ code: 'NETWORK' });
  });
});
