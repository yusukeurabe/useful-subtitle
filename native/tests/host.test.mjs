import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, realpathSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHost } from '../host.mjs';
import { acquireLock } from '../lock.mjs';
import { FrameDecoder, encodeFrame } from '../protocol.mjs';

const request = { id: 'one', model: 'haiku', system: 'Translate', user: 'Hello' };
function temporary(t) {
  const path = mkdtempSync(join(realpathSync(tmpdir()), 'subtitle-host-'));
  t.after(() => rmSync(path, { force: true, recursive: true })); return path;
}
function streams() {
  const input = new PassThrough(), output = new PassThrough(), messages = [];
  const decoder = new FrameDecoder(value => messages.push(value));
  output.on('data', chunk => decoder.push(chunk)); return { input, output, messages };
}
test('exclusive claims reject concurrent owners and safely recover dead owner', t => {
  const dir = join(temporary(t), 'locks');
  const release = acquireLock(dir); assert.ok(release);
  assert.equal(acquireLock(dir), null);
  release();
  writeFileSync(join(dir, '999999999-dead.lock'), JSON.stringify({ state: 'idle' }));
  const recovered = acquireLock(dir); assert.ok(recovered); recovered();
  assert.deepEqual(readdirSync(dir), []);
});
test('hosts enforce shared concurrency, validate before spawn, abort on disconnect', async t => {
  const appDir = temporary(t), first = streams(), second = streams();
  let calls = 0, signal;
  const run = async (value, options) => {
    assert.equal(options.nodePath, '/configured/node');
    assert.equal(typeof options.beforeSpawn, 'function');
    calls++; signal = options.signal;
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    return { id: value.id, ok: true, text: 'unused' };
  };
  const config = { appDir, claudePath: '/fake/claude', nodePath: '/configured/node' };
  const host1 = createHost({ ...first, config, run });
  const host2 = createHost({ ...second, config, run });
  t.after(async () => { await host1.close(); await host2.close(); });
  first.input.write(encodeFrame({ ...request, model: 'bad;command' }));
  assert.equal(calls, 0);
  first.input.write(encodeFrame(request));
  first.input.write(encodeFrame({ ...request, id: 'two' }));
  second.input.write(encodeFrame({ ...request, id: 'three' }));
  assert.equal(calls, 1);
  assert.equal(first.messages.at(-1).code, 'BUSY');
  assert.equal(second.messages.at(-1).code, 'BUSY');
  first.input.end();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(signal.aborted, true);
  assert.deepEqual(readdirSync(join(appDir, 'locks')), []);
  assert.deepEqual(readdirSync(join(appDir, 'requests')), []);
});
test('idle connection closes without starting Claude', async t => {
  const streams1 = streams();
  await new Promise(resolve => {
    createHost({ ...streams1, config: { appDir: temporary(t) }, idleMs: 5, onExit: resolve, run: () => assert.fail('must not run') });
  });
});
test('dead host claim with live orphan child remains busy until child exits', t => {
  const dir = join(temporary(t), 'locks');
  const release = acquireLock(dir); release();
  const stale = join(dir, '999999999-dead.lock');
  writeFileSync(stale, JSON.stringify({ state: 'running', childPid: process.pid }));
  assert.equal(acquireLock(dir), null);
  writeFileSync(stale, JSON.stringify({ state: 'running', childPid: 999999998 }));
  const recovered = acquireLock(dir); assert.ok(recovered); recovered();
});
test('empty, invalid and spawning crash claims fail closed', t => {
  const dir = join(temporary(t), 'locks');
  const release = acquireLock(dir); release();
  const stale = join(dir, '999999999-dead.lock');
  for (const content of ['', '{', '{}', 'null', '{"state":"spawning"}', '{"state":"running"}']) {
    writeFileSync(stale, content);
    assert.equal(acquireLock(dir), null);
    assert.equal(existsSync(stale), true);
  }
});
test('atomic spawn transitions protect auth-to-inference crash window', t => {
  const dir = join(temporary(t), 'locks');
  const claim = acquireLock(dir, { pid: 999999999 });
  const path = join(dir, readdirSync(dir)[0]);
  claim.beforeSpawn();
  assert.deepEqual(JSON.parse(readFileSync(path)), { state: 'spawning' });
  assert.equal(acquireLock(dir), null);
  claim.trackChild(999999998);
  assert.deepEqual(JSON.parse(readFileSync(path)), { state: 'running', childPid: 999999998 });
  claim.beforeSpawn(); // Auth child exited; inference PID has not been persisted.
  assert.equal(acquireLock(dir), null);
  assert.deepEqual(readdirSync(dir), [path.split('/').at(-1)]);
  claim.trackChild(999999997);
  const recovered = acquireLock(dir); assert.ok(recovered); recovered();
});
