import { describe, it, expect } from 'vitest';
import { normalizeSendError } from '../src/shared/messages';

describe('normalizeSendError', () => {
  const REQUEST_RELOAD_MSG =
    '拡張機能が更新されました。このタブを再読み込み（F5）してください。';

  it('returns CONTEXT_INVALIDATED with a JP guidance message when runtimeId is undefined', () => {
    expect(normalizeSendError(new Error('whatever'), undefined)).toEqual({
      ok: false,
      code: 'CONTEXT_INVALIDATED',
      error: REQUEST_RELOAD_MSG,
    });
  });

  it('returns CONTEXT_INVALIDATED when the error message contains "context invalidated"', () => {
    expect(normalizeSendError(new Error('Extension context invalidated.'), 'ext-id')).toEqual({
      ok: false,
      code: 'CONTEXT_INVALIDATED',
      error: REQUEST_RELOAD_MSG,
    });
  });

  it('matches "context invalidated" case-insensitively', () => {
    expect(
      normalizeSendError(new Error('EXTENSION CONTEXT INVALIDATED'), 'ext-id').code,
    ).toBe('CONTEXT_INVALIDATED');
  });

  it('returns UNKNOWN with the original message for other errors', () => {
    expect(normalizeSendError(new Error('network down'), 'ext-id')).toEqual({
      ok: false,
      code: 'UNKNOWN',
      error: 'network down',
    });
  });

  it('returns UNKNOWN with a fallback message when error has no message', () => {
    expect(normalizeSendError({}, 'ext-id')).toEqual({
      ok: false,
      code: 'UNKNOWN',
      error: 'メッセージの送信に失敗しました',
    });
  });

  it('returns UNKNOWN with a fallback for null error', () => {
    expect(normalizeSendError(null, 'ext-id')).toEqual({
      ok: false,
      code: 'UNKNOWN',
      error: 'メッセージの送信に失敗しました',
    });
  });
});
