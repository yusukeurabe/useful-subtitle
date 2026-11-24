import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { runClaude, runLogin, isolatedEnv, LOGIN_TIMEOUT_MS } from '../claude.mjs';

const request = { id: 'test', model: 'claude-haiku-5-5', system: 'Translate $(touch bad)', user: '`rm x`; $HOME' };
const auth = { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' };
const success = { type: 'result', subtype: 'success', is_error: false, result: 'こんにちは', total_cost_usd: 0.01 };
function fakeSpawn(outputs) {
  const calls = [];
  const spawn = (file, args, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = (signal) => { child.killedWith = signal; queueMicrotask(() => child.emit('close', null, signal)); return true; };
    const call = { file, args, options, child, input: '' }; calls.push(call);
    child.stdin.on('data', chunk => { call.input += chunk; });
    const output = outputs.shift();
    if (output !== null) queueMicrotask(() => {
      child.stdout.end(typeof output === 'string' ? output : JSON.stringify(output)); child.emit('close', 0);
    });
    return child;
  };
  return { spawn, calls };
}
const options = { claudePath: '/absolute/claude', cwd: '/empty', env: { HOME: '/home/test', PATH: '/bin' } };
test('subscription success uses isolated flags and literal stdin, no fallback or shell', async () => {
  const fake = fakeSpawn([auth, success]);
  const result = await runClaude(request, { ...options, spawn: fake.spawn });
  assert.deepEqual(result, { id: 'test', ok: true, text: 'こんにちは' });
  const [check, call] = fake.calls;
  for (const item of [check, call]) {
    assert.equal(item.options.shell, false);
    assert.ok(item.args.includes('--safe-mode'));
    assert.equal(item.args[item.args.indexOf('--setting-sources') + 1], '');
    assert.ok(!item.args.includes('--bare'));
  }
  assert.equal(call.input, request.user);
  assert.equal(call.args[call.args.indexOf('--system-prompt') + 1], request.system);
  for (const flag of ['--tools', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence', '--max-turns']) assert.ok(call.args.includes(flag));
  assert.equal(call.args[call.args.indexOf('--tools') + 1], '');
  assert.equal(call.args[call.args.indexOf('--mcp-config') + 1], '{"mcpServers":{}}');
  assert.ok(!call.args.includes('--fallback-model'));
});
test('allowlist removes all auth, provider and config injection variables', () => {
  assert.deepEqual(isolatedEnv({ HOME: '/h', USER: 'u', PATH: '/bin', LANG: 'en_US.UTF-8', ANTHROPIC_API_KEY: 'secret', CLAUDE_CODE_OAUTH_TOKEN: 'secret', ANTHROPIC_BASE_URL: 'bad', NODE_OPTIONS: 'bad', CLAUDE_CONFIG_DIR: 'bad', AWS_PROFILE: 'bad' }), { HOME: '/h', USER: 'u', PATH: '/bin', LANG: 'en_US.UTF-8' });
});
test('refuses non subscription auth before inference', async () => {
  for (const status of [{ ...auth, loggedIn: false }, { ...auth, authMethod: 'api_key' }, { ...auth, apiProvider: 'bedrock' }, {}]) {
    const fake = fakeSpawn([status]);
    assert.equal((await runClaude(request, { ...options, spawn: fake.spawn })).code, 'AUTH');
    assert.equal(fake.calls.length, 1);
  }
});
test('malformed/error/oversized results produce safe failures', async () => {
  for (const output of ['not-json SECRET', { ...success, is_error: true, result: 'SECRET' }, { ...success, result: 'a'.repeat(65537) }, 'a'.repeat(256 * 1024 + 1)]) {
    const fake = fakeSpawn([auth, output]);
    const result = await runClaude(request, { ...options, spawn: fake.spawn });
    assert.equal(result.ok, false); assert.ok(!result.error.includes('SECRET'));
  }
});
test('CLI API reachability errors are classified as NETWORK', async () => {
  for (const message of ["API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)", 'EAI_AGAIN', 'DNS lookup failed', 'unreachable API server', 'fetch failed']) {
    const fake = fakeSpawn([auth, { ...success, is_error: true, stop_reason: 'stop_sequence', result: message }]);
    const result = await runClaude(request, { ...options, spawn: fake.spawn });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'NETWORK');
    assert.ok(!result.error.includes(message));
  }
});
test('timeout and abort terminate child', async () => {
  const fake = fakeSpawn([null]);
  assert.equal((await runClaude(request, { ...options, spawn: fake.spawn, timeoutMs: 10 })).code, 'NETWORK');
  assert.equal(fake.calls[0].child.killedWith, 'SIGTERM');
  const aborted = fakeSpawn([null]); const controller = new AbortController();
  const result = runClaude(request, { ...options, spawn: aborted.spawn, signal: controller.signal });
  controller.abort(); await result;
  assert.equal(aborted.calls[0].child.killedWith, 'SIGTERM');
});
test('host-owned output budget and retries override injected values', async () => {
  const fake = fakeSpawn([auth, success]);
  await runClaude({ ...request, maxTokens: 16 }, { ...options, env: { ...options.env, CLAUDE_CODE_MAX_OUTPUT_TOKENS: '90000', CLAUDE_CODE_MAX_RETRIES: '99' }, spawn: fake.spawn });
  for (const call of fake.calls) {
    assert.equal(call.options.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, '1024');
    assert.equal(call.options.env.CLAUDE_CODE_MAX_RETRIES, '0');
    assert.equal(call.options.env.MAX_THINKING_TOKENS, undefined);
  }
  assert.equal(fake.calls[1].args[fake.calls[1].args.indexOf('--effort') + 1], 'low');
});
test('rejects managed policy presence and enterprise subscription', async () => {
  const fake = fakeSpawn([]);
  const result = await runClaude(request, { ...options, spawn: fake.spawn, policyExists: path => path.endsWith('managed-settings.d') });
  assert.equal(result.code, 'NATIVE_SETUP'); assert.equal(fake.calls.length, 0);
  const enterprise = fakeSpawn([{ ...auth, subscriptionType: 'enterprise' }]);
  assert.equal((await runClaude(request, { ...options, spawn: enterprise.spawn })).code, 'AUTH');
  assert.equal(enterprise.calls.length, 1);
});
test('refusal and token-truncated success results are rejected; absent metadata remains valid', async () => {
  for (const stop_reason of ['refusal', 'max_tokens']) {
    const fake = fakeSpawn([auth, { ...success, stop_reason }]);
    const result = await runClaude(request, { ...options, spawn: fake.spawn });
    assert.equal(result.ok, false); assert.equal(result.code, 'UNKNOWN');
  }
  for (const result of [success, { ...success, stop_reason: 'end_turn' }]) {
    const fake = fakeSpawn([auth, result]);
    assert.equal((await runClaude(request, { ...options, spawn: fake.spawn })).ok, true);
  }
});
test('persists spawning state before each child and aborts if persistence fails', async () => {
  const fake = fakeSpawn([auth, success]);
  const events = [];
  await runClaude(request, { ...options,
    beforeSpawn: () => events.push('spawning'),
    spawn: (...args) => { events.push('spawn'); return fake.spawn(...args); },
    onSpawn: () => events.push('running'),
  });
  assert.deepEqual(events, ['spawning', 'spawn', 'running', 'spawning', 'spawn', 'running']);
  const blocked = fakeSpawn([]);
  const result = await runClaude(request, { ...options, spawn: blocked.spawn, beforeSpawn: () => { throw new Error('disk failure'); } });
  assert.equal(result.code, 'NATIVE_SETUP'); assert.equal(blocked.calls.length, 0);
});
test('configured Node directory is first on child PATH even with minimal browser PATH', async t => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'subtitle-node-path-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cli = join(root, 'fake-claude');
  writeFileSync(cli, `#!/usr/bin/env node\nprocess.stdin.resume();\nprocess.stdin.on('end', () => console.log(JSON.stringify(process.argv.includes('auth') ? ${JSON.stringify(auth)} : ${JSON.stringify(success)})));\n`);
  chmodSync(cli, 0o700);
  const result = await runClaude(request, { claudePath: cli, nodePath: process.execPath, cwd: root, env: { HOME: root, PATH: '/nonexistent' } });
  assert.equal(result.ok, true);
  const fake = fakeSpawn([auth, success]);
  await runClaude(request, { ...options, nodePath: '/configured/bin/node', env: { HOME: root, PATH: '/usr/bin:/bin' }, spawn: fake.spawn });
  assert.equal(fake.calls[0].options.env.PATH, ['/configured/bin', '/usr/bin:/bin'].join(delimiter));
});
const login = { id: 'login', action: 'login' };
test('login runs the official subscription login with isolation, then verifies status', async () => {
  const fake = fakeSpawn(['Opening browser to sign in…\nLogin successful.', { ...auth, subscriptionType: 'pro' }]);
  const result = await runLogin(login, { ...options, spawn: fake.spawn });
  assert.deepEqual(result, { id: 'login', ok: true, text: 'OK' });
  const [call, check] = fake.calls;
  assert.deepEqual(call.args.slice(-3), ['auth', 'login', '--claudeai']);
  assert.ok(call.args.includes('--safe-mode'));
  assert.ok(!call.args.includes('--console'));
  assert.equal(call.options.shell, false);
  assert.equal(call.input, '');
  assert.equal(call.options.env.ANTHROPIC_API_KEY, undefined);
  assert.deepEqual(check.args.slice(-3), ['auth', 'status', '--json']);
});
test('login reports AUTH when status is not a subscription afterwards', async () => {
  for (const status of [{ ...auth, loggedIn: false }, { ...auth, authMethod: 'api_key' }, 'not-json']) {
    const fake = fakeSpawn(['Login successful.', status]);
    assert.equal((await runLogin(login, { ...options, spawn: fake.spawn })).code, 'AUTH');
  }
});
test('login failure exit code is AUTH and skips status', async () => {
  const calls = [];
  const spawn = (file, args, opts) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => true; calls.push(args);
    queueMicrotask(() => { child.stdout.end(''); child.emit('close', 1); });
    return child;
  };
  assert.equal((await runLogin(login, { ...options, spawn })).code, 'AUTH');
  assert.equal(calls.length, 1);
});
test('login times out and kills the child', async () => {
  const fake = fakeSpawn([null]);
  assert.equal((await runLogin(login, { ...options, spawn: fake.spawn, timeoutMs: 10 })).code, 'NETWORK');
  assert.equal(fake.calls[0].child.killedWith, 'SIGTERM');
});
test('login refuses managed policy and malformed requests before spawning', async () => {
  const fake = fakeSpawn([]);
  assert.equal((await runLogin(login, { ...options, spawn: fake.spawn, policyExists: () => true })).code, 'NATIVE_SETUP');
  assert.equal((await runLogin({ id: 'x', action: 'nope' }, { ...options, spawn: fake.spawn })).code, 'UNKNOWN');
  assert.equal(fake.calls.length, 0);
});
/** 呼び出しごとに、指定ミリ秒後に出力して終了する（null なら終了しない）偽の spawn。 */
function delayedSpawn(steps) {
  const calls = [];
  const spawn = (file, args) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = (signal) => { child.killedWith = signal; queueMicrotask(() => child.emit('close', null, signal)); return true; };
    calls.push({ args, child });
    const step = steps.shift();
    if (step.after !== null) setTimeout(() => { child.stdout.end(JSON.stringify(step.output)); child.emit('close', 0); }, step.after);
    return child;
  };
  return { spawn, calls };
}
test('login 後の auth status はログインの残り時間と別に 15 秒の持ち時間で確かめる', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  // ログインが持ち時間 1000ms のうち 990ms を使い切っても、status は 15 秒まで待つ。
  const fake = delayedSpawn([{ after: 990, output: 'Login successful.' }, { after: null }]);
  const result = runLogin(login, { ...options, spawn: fake.spawn, timeoutMs: 1000 });
  t.mock.timers.tick(990);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fake.calls.length, 2);
  t.mock.timers.tick(14_999);
  assert.equal(fake.calls[1].child.killedWith, undefined);
  t.mock.timers.tick(1);
  assert.equal(fake.calls[1].child.killedWith, 'SIGTERM');
  t.mock.timers.tick(500);
  assert.equal((await result).code, 'NETWORK');
});
test('login 直前に許可されても status 確認は成功する（ログインの締め切りを共有しない）', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const fake = delayedSpawn([{ after: 990, output: 'Login successful.' }, { after: 100, output: { ...auth, subscriptionType: 'max' } }]);
  const result = runLogin(login, { ...options, spawn: fake.spawn, timeoutMs: 1000 });
  t.mock.timers.tick(990);
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(100);
  assert.deepEqual(await result, { id: 'login', ok: true, text: 'OK' });
});
test('timeoutMs を渡さないログインは LOGIN_TIMEOUT_MS（225 秒）で打ち切る', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  assert.equal(LOGIN_TIMEOUT_MS, 225000);
  const fake = delayedSpawn([{ after: null }]);
  const result = runLogin(login, { ...options, spawn: fake.spawn });
  t.mock.timers.tick(224_999);
  assert.equal(fake.calls[0].child.killedWith, undefined);
  t.mock.timers.tick(1);
  assert.equal(fake.calls[0].child.killedWith, 'SIGTERM');
  t.mock.timers.tick(500);
  assert.equal((await result).code, 'NETWORK');
});
