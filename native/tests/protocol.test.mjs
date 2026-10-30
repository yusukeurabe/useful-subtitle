import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameDecoder, encodeFrame, validateRequest } from '../protocol.mjs';

test('fragmented and coalesced frames round trip', () => {
  const messages = [];
  const decoder = new FrameDecoder((value) => messages.push(value));
  const first = encodeFrame({ id: '日本語' });
  decoder.push(first.subarray(0, 2));
  decoder.push(first.subarray(2, 5));
  decoder.push(Buffer.concat([first.subarray(5), encodeFrame({ id: '2' })]));
  assert.deepEqual(messages, [{ id: '日本語' }, { id: '2' }]);
});
test('rejects oversized, invalid JSON and incomplete frames', () => {
  const size = Buffer.alloc(4); size.writeUInt32LE(128 * 1024 + 1);
  assert.throws(() => new FrameDecoder(() => {}).push(size));
  assert.throws(() => new FrameDecoder(() => {}).push(Buffer.from([1, 0, 0, 0, 120])));
  const decoder = new FrameDecoder(() => {}); decoder.push(Buffer.from([1]));
  assert.throws(() => decoder.end());
});
test('validates request limits before spawning', () => {
  const request = { id: '1', model: 'claude-haiku-5-5', system: 'Translate', user: 'Hello' };
  assert.equal(validateRequest(request), request);
  for (const change of [{ id: 'x'.repeat(129) }, { model: '--help' }, { model: 'a;ls' }, { system: 'a'.repeat(8193) }, { user: 'a'.repeat(16385) }, { maxTokens: -1 }]) {
    assert.throws(() => validateRequest({ ...request, ...change }));
  }
});
