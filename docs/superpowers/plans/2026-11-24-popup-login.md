# ポップアップから Claude に再ログイン Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 解説ポップアップの AUTH エラーに「ブラウザでログイン」ボタンを出し、押すと接続プログラム経由で `claude auth login --claudeai` を起動してブラウザでログイン、成功したら意味引きを自動でやり直す。

**Architecture:** 接続プログラム（native/、Node ESM）に `{ id, action: 'login' }` という依頼を1種類追加し `runLogin` で処理する。拡張の service worker 側 `nativeClient` に `login()` を足し、content script から `{ type: 'login' }` メッセージで呼ぶ。ポップアップ（overlay）はエラー文の下に任意のボタンを描けるようにし、interaction がボタンの動作と再試行を担う。

**Tech Stack:** TypeScript（Chrome 拡張 MV3, esbuild）、vitest + jsdom、Node `node:test`（native/）。

## Global Constraints

- 認証情報・トークンを拡張・接続プログラムで読まない・保存しない。ログインは公式 CLI とブラウザに任せる。
- ログインは `--claudeai` 固定。`--console` は使わない。
- 子プロセスの環境変数は既存の `isolatedEnv` の許可リストのみ。`shell: false`。
- ログインの制限時間: 接続プログラム側 240 秒（4 分）、拡張側 250 秒。MV3 service worker の 5 分制限より短くする。
- UI 文言（そのまま使う）:
  - ボタン: `ブラウザでログイン`
  - ログイン待ちのボタン（押せない状態）: `ブラウザでログインを完了してください…`
  - 失敗時のメッセージ: `ログインできませんでした。もう一度お試しください。`
- コメント・UI 文言は日本語、コミットメッセージは既存に合わせて `feat:` / `test:` / `chore:` ＋日本語。各コミット末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- PC に負荷をかけない: 開発サーバー・`npm run dev` は起動しない。テストは対象ファイルを絞って実行し、全件は最後に1回。

---

### Task 1: 接続プログラムのログイン依頼（native/）

**Files:**
- Modify: `native/protocol.mjs`（`validateRequest`）
- Modify: `native/claude.mjs`（`runLogin` 追加、事前検査の共通化）
- Modify: `native/host.mjs`（`createHost` に `login` 注入、振り分け）
- Test: `native/tests/protocol.test.mjs`, `native/tests/claude.test.mjs`, `native/tests/host.test.mjs`

**Interfaces:**
- Produces: 依頼 `{ id: string, action: 'login' }`（キーはこの2つだけ）→ 応答 `{ id, ok: true, text: 'OK' }` または `failure(id, code)`。`export async function runLogin(request, options)`（options は `runClaude` と同じ形）。`export const LOGIN_TIMEOUT_MS = 240000`。`createHost({ ..., run, login })`。

- [ ] **Step 1: 失敗するテストを書く**

`native/tests/protocol.test.mjs` の末尾に追加:

```js
test('accepts only the exact login action shape', () => {
  const login = { id: '1', action: 'login' };
  assert.equal(validateRequest(login), login);
  for (const bad of [{ id: '1', action: 'logout' }, { id: '1', action: 'login', model: 'x' }, { action: 'login' }, { id: '1', action: 'login', extra: true }]) {
    assert.throws(() => validateRequest(bad));
  }
  const request = { id: '1', model: 'claude-haiku-5-5', system: 'Translate', user: 'Hello' };
  assert.throws(() => validateRequest({ ...request, action: 'login' }));
});
```

`native/tests/claude.test.mjs` の import を `import { runClaude, runLogin, isolatedEnv } from '../claude.mjs';` に変え、末尾に追加:

```js
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
```

`native/tests/host.test.mjs` の末尾に追加:

```js
test('login requests go to the login runner with the same lock and options', async t => {
  const appDir = temporary(t), io = streams();
  const run = async () => { throw new Error('must not run inference'); };
  const login = async (value, options) => {
    assert.equal(options.claudePath, '/fake/claude');
    assert.equal(typeof options.onSpawn, 'function');
    return { id: value.id, ok: true, text: 'OK' };
  };
  const host = createHost({ ...io, config: { appDir, claudePath: '/fake/claude', nodePath: '/configured/node' }, run, login });
  t.after(() => host.close());
  io.input.write(encodeFrame({ id: 'l1', action: 'login' }));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(io.messages.at(-1), { id: 'l1', ok: true, text: 'OK' });
  assert.deepEqual(readdirSync(join(appDir, 'locks')), []);
});
```

- [ ] **Step 2: 失敗を確認**

Run: `node --test --test-concurrency=1 native/tests/protocol.test.mjs native/tests/claude.test.mjs native/tests/host.test.mjs`
Expected: 新しいテストが FAIL（`runLogin` が無い、login 形を拒否する など）。

- [ ] **Step 3: 実装**

`native/protocol.mjs` の `validateRequest` を置き換え:

```js
export function validateRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.id !== 'string' || !value.id.length || value.id.length > 128) {
    throw new Error('Invalid native request');
  }
  if (value.action !== undefined) {
    // ログイン依頼は id と action だけ。余計な値は受け取らない。
    if (value.action !== 'login' || Object.keys(value).length !== 2) throw new Error('Invalid native request');
    return value;
  }
  if (typeof value.model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value.model)
    || typeof value.system !== 'string' || value.system.length > 8192
    || typeof value.user !== 'string' || !value.user.length || value.user.length > 16384
    || (value.maxTokens !== undefined && (!Number.isInteger(value.maxTokens) || value.maxTokens < 1 || value.maxTokens > 4096))) {
    throw new Error('Invalid native request');
  }
  return value;
}
```

`native/claude.mjs`: `runClaude` 内の設定組み立て・ポリシー検査・`auth status` 判定を関数に切り出し、`runLogin` を追加する。`runClaude` の振る舞いは変えない。

```js
export const LOGIN_TIMEOUT_MS = 240000;

function prepare(request, options, timeoutMs) {
  validateRequest(request);
  const config = { spawn: nodeSpawn, env: process.env, timeoutMs, nodePath: process.execPath, ...options, maxTokens: Math.max(1024, request.maxTokens ?? 1024) };
  const policyFiles = [...managedFiles];
  if (config.env.HOME) policyFiles.push(join(config.env.HOME, 'Library/Preferences/com.anthropic.claudecode.plist'), join(config.env.HOME, 'Library/Managed Preferences/com.anthropic.claudecode.plist'));
  if (config.env.USER && /^[a-zA-Z0-9._-]+$/.test(config.env.USER)) policyFiles.push(`/Library/Managed Preferences/${config.env.USER}/com.anthropic.claudecode.plist`);
  if (!isAbsolute(config.claudePath ?? '') || !isAbsolute(config.cwd ?? '') || !isAbsolute(config.nodePath ?? '') || policyFiles.some(file => (config.policyExists ?? existsSync)(file))) return null;
  const deadline = Date.now() + config.timeoutMs;
  const invoke = (args, input) => execute(config.claudePath, args, input, config, Math.max(1, deadline - Date.now()));
  return { config, invoke };
}
async function isSubscribed(invoke) {
  const auth = await invoke([...isolation, 'auth', 'status', '--json'], '');
  let status;
  try { status = JSON.parse(auth.stdout); } catch { return false; }
  return auth.exitCode === 0 && status.loggedIn === true && status.authMethod === 'claude.ai' && status.apiProvider === 'firstParty'
    && (status.subscriptionType === undefined || ['pro', 'max'].includes(status.subscriptionType));
}
const requestId = request => typeof request?.id === 'string' && request.id.length <= 128 ? request.id : '';

export async function runClaude(request, options = {}) {
  const id = requestId(request);
  try {
    const prepared = prepare(request, options, options.timeoutMs ?? 45000);
    if (!prepared) return failure(id, 'NATIVE_SETUP');
    const { invoke } = prepared;
    if (!(await isSubscribed(invoke))) return failure(id, 'AUTH');
    // ...以降（response = await invoke(['-p', ...]) から return まで）は現行のまま
  } catch (error) { return failure(id, MESSAGES[error?.code] ? error.code : 'UNKNOWN'); }
}

/** 公式 CLI の Claude サブスクログインを起動する。ブラウザが開き、許可されると CLI が自ら終了する。 */
export async function runLogin(request, options = {}) {
  const id = requestId(request);
  try {
    if (request?.action !== 'login') return failure(id, 'UNKNOWN');
    const prepared = prepare(request, options, options.timeoutMs ?? LOGIN_TIMEOUT_MS);
    if (!prepared) return failure(id, 'NATIVE_SETUP');
    const { invoke } = prepared;
    const login = await invoke([...isolation, 'auth', 'login', '--claudeai'], '');
    if (login.exitCode !== 0) return failure(id, 'AUTH');
    if (!(await isSubscribed(invoke))) return failure(id, 'AUTH');
    return { id, ok: true, text: 'OK' };
  } catch (error) { return failure(id, MESSAGES[error?.code] ? error.code : 'UNKNOWN'); }
}
```

注意: `runClaude` は従来どおり `validateRequest` を通るが、`action` 付きの依頼は推論に進めないこと（`prepare` 後に `if (request.action !== undefined) return failure(id, 'UNKNOWN');` を `runClaude` に入れる）。`options.timeoutMs` は従来 `config` の既定値 45000 として扱われていたので、既存テスト（`timeoutMs: 10`）が通ることを確認する。

`native/host.mjs`: import を `import { runClaude, runLogin, failure } from './claude.mjs';` にし、`createHost({ input, output, config, run = runClaude, login = runLogin, idleMs = 60000, onExit = () => {} })` とする。`send(await run(request, {...}))` を次に変える:

```js
const handler = request.action === 'login' ? login : run;
send(await handler(request, { claudePath: config.claudePath, nodePath: config.nodePath, cwd, signal: controller.signal, beforeSpawn: release.beforeSpawn, onSpawn: release.trackChild }));
```

- [ ] **Step 4: 合格を確認**

Run: `npm run test:native`
Expected: 全件 PASS。

- [ ] **Step 5: コミット**

```bash
git add native/
git commit -m "feat: 接続プログラムに Claude サブスクのログイン依頼を追加"
```

---

### Task 2: nativeClient の `login()`

**Files:**
- Modify: `src/background/nativeClient.ts`
- Test: `tests/nativeClient.test.ts`

**Interfaces:**
- Consumes: Task 1 の依頼形 `{ id, action: 'login' }` と応答。
- Produces: `createNativeClient(...)` の戻り値に `login: () => Promise<void>` を追加。失敗時は `AiError('AUTH', 'ログインできませんでした。もう一度お試しください。')`（設定変更などによる取り消しは `CANCELED`）。

- [ ] **Step 1: 失敗するテストを書く**

`tests/nativeClient.test.ts` の `describe('native scheduler', ...)` 内に追加:

```ts
  it('login sends only the login action, runs before queued work and lifts the cooldown', async () => {
    const h = harness();
    const failed = h.send('first', 1, 'interactive');
    h.ports[0]!.reply({ id: h.ports[0]!.postMessage.mock.lastCall![0].id, ok: false, code: 'AUTH' });
    await expect(failed).rejects.toMatchObject({ code: 'AUTH' });
    await expect(h.send('blocked', 1, 'interactive')).rejects.toMatchObject({ code: 'AUTH' });
    const login = h.client.login();
    expect(h.client.login()).toBe(login);
    const sent = h.ports[0]!.postMessage.mock.lastCall![0];
    expect(sent).toEqual({ id: expect.any(String), action: 'login' });
    h.ports[0]!.reply({ id: sent.id, ok: true, text: 'OK' });
    await expect(login).resolves.toBeUndefined();
    const after = h.send('after', 1, 'interactive');
    expect(h.ports.at(-1)!.postMessage.mock.lastCall![0].user).toBe('after');
    h.finish(); await after;
  });
  it('login failure uses the login message and does not start a cooldown', async () => {
    const h = harness();
    const login = h.client.login();
    const sent = h.ports[0]!.postMessage.mock.lastCall![0];
    h.ports[0]!.reply({ id: sent.id, ok: false, code: 'NETWORK' });
    await expect(login).rejects.toMatchObject({ code: 'AUTH', message: 'ログインできませんでした。もう一度お試しください。' });
    const next = h.send('next', 1, 'interactive');
    h.finish(); await expect(next).resolves.toBe('ok');
  });
  it('login waits for the active request and times out after 250 seconds without cooldown', async () => {
    const h = harness();
    const active = h.send('active', 1, 'interactive');
    const login = h.client.login();
    void login.catch(() => {});
    expect(h.ports[0]!.postMessage).toHaveBeenCalledTimes(1);
    h.finish(); await active;
    expect(h.ports[0]!.postMessage.mock.lastCall![0]).toMatchObject({ action: 'login' });
    vi.advanceTimersByTime(60_000);
    expect(h.ports[0]!.disconnect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(190_000);
    await expect(login).rejects.toMatchObject({ code: 'AUTH' });
    expect(h.ports[0]!.disconnect).toHaveBeenCalled();
    vi.advanceTimersByTime(750);
    const next = h.send('next', 1, 'interactive');
    h.finish(); await expect(next).resolves.toBe('ok');
  });
  it('login is not canceled when its tab closes', async () => {
    const h = harness();
    const login = h.client.login();
    h.client.dropTab(1);
    const sent = h.ports[0]!.postMessage.mock.lastCall![0];
    h.ports[0]!.reply({ id: sent.id, ok: true, text: 'OK' });
    await expect(login).resolves.toBeUndefined();
  });
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run tests/nativeClient.test.ts`
Expected: 新しい4件が FAIL（`login` が無い）。

- [ ] **Step 3: 実装**

`src/background/nativeClient.ts`:

1. 定数を追加:
```ts
const LOGIN_FAILED = 'ログインできませんでした。もう一度お試しください。';
const LOGIN_TIMEOUT_MS = 250_000;
const REQUEST_TIMEOUT_MS = 55_000;
```
2. `NativeContext['kind']` に `'login'` を加える: `kind: 'translation' | 'interactive' | 'login';`
3. `pump` 内:
   - タイムアウト: `timeout = setTimeout(() => job.context.kind === 'login' ? expireLogin() : reset('TIMEOUT'), job.context.kind === 'login' ? LOGIN_TIMEOUT_MS : REQUEST_TIMEOUT_MS);`
   - 送信: `if (job.context.kind === 'login') port.postMessage({ id: job.id, action: 'login' }); else { const { model, system, user, maxTokens } = job.params; port.postMessage({ ... 現行 ... }); }`
   - 応答（`onMessage`）で `value.ok` が false のとき、`done.context.kind === 'login'` なら `coolDown`/`clearPending` をせず `done.reject(new AiError('AUTH', LOGIN_FAILED))`。成功時、`done.context.kind === 'login'` なら `cooldownUntil = 0`（既存の `retry` と同じ）。
4. `expireLogin` を追加（cooldown を掛けずにポートを閉じて次へ）:
```ts
const expireLogin = (): void => {
  const job = active;
  close();
  active = undefined;
  job?.reject(new AiError('AUTH', LOGIN_FAILED));
  pump();
};
```
5. `login` を追加し戻り値に含める:
```ts
const login = (): Promise<void> => {
  const existing = [active, ...interactive].find(job => job?.context.kind === 'login');
  if (existing) return existing.promise.then(() => undefined);
  let resolve!: Job['resolve'];
  let reject!: Job['reject'];
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  const job: Job = { id: String(++sequence), key: 'login', params: { model: '', system: '', user: '' }, context: { kind: 'login' }, promise, resolve, reject };
  interactive.unshift(job);
  pump();
  return promise.then(() => undefined);
};
return { request, reset, dropTab, retireTranslation, login };
```
   重複呼び出しで同じ Promise を返すため、`login` 用の `then` 済み Promise を `job` と別に保持する（例: `Job` に `done?: Promise<void>` を足し、`existing.done` を返す）。テスト `expect(h.client.login()).toBe(login)` が通る形にすること。
6. `request()` の重複判定 `find(job => job?.key === key)` が login job に当たらないことを確認（key が JSON 文字列なので衝突しない）。

- [ ] **Step 4: 合格を確認**

Run: `npx vitest run tests/nativeClient.test.ts && npx tsc --noEmit`
Expected: PASS、型エラーなし。

- [ ] **Step 5: コミット**

```bash
git add src/background/nativeClient.ts tests/nativeClient.test.ts
git commit -m "feat: ネイティブクライアントにログイン依頼を追加（成功で利用停止を解除）"
```

---

### Task 3: content → service worker の `login` メッセージ

**Files:**
- Modify: `src/shared/types.ts`（`LoginRequest`）
- Modify: `src/shared/messages.ts`（`sendRequest` のオーバーロード）
- Modify: `src/background/requestBoundary.ts`（`isRequest`）
- Modify: `src/background/handler.ts`（`HandlerDeps.loginSubscription`、`login` 処理）
- Modify: `src/background/index.ts`（`loginSubscription: native.login`）
- Test: `tests/requestBoundary.test.ts`, `tests/handler.test.ts`, `tests/nativeBoundary.test.ts`（deps に `loginSubscription` を追加するだけ）

**Interfaces:**
- Consumes: Task 2 の `native.login(): Promise<void>`。
- Produces: `interface LoginRequest { type: 'login' }`（`RequestMessage` に追加）。`sendRequest({ type: 'login' }): Promise<ResponseMessage>`。成功時 `{ ok: true, text: 'OK' }`。`HandlerDeps.loginSubscription: () => Promise<void>`。

- [ ] **Step 1: 失敗するテストを書く**

`tests/requestBoundary.test.ts`: `harness` の deps に `loginSubscription: vi.fn(async () => {}),` を追加し、`describe` 内に追加:

```ts
  it('accepts login only from a video page and only for the subscription provider', async () => {
    expect(isRequest({ type: 'login' })).toBe(true);
    const h = harness();
    expect(await h.boundary.dispatch({ type: 'login' }, video)).toEqual({ ok: true, text: 'OK' });
    expect(h.deps.loginSubscription).toHaveBeenCalledTimes(1);
    expect(h.boundary.dispatch({ type: 'login' }, { id, url: chrome.runtime.getURL('options.html') })).toBeUndefined();
    const api = harness({ getSettings: async () => ({ ...DEFAULT_SETTINGS, provider: 'anthropic', apiKey: 'k' }) });
    expect(await api.boundary.dispatch({ type: 'login' }, video)).toMatchObject({ ok: false, code: 'UNKNOWN' });
    expect(api.deps.loginSubscription).not.toHaveBeenCalled();
  });
  it('returns the login failure as an error response', async () => {
    const { AiError } = await import('../src/background/aiClient');
    const h = harness({ loginSubscription: vi.fn(async () => { throw new AiError('AUTH', 'ログインできませんでした。もう一度お試しください。'); }) });
    expect(await h.boundary.dispatch({ type: 'login' }, video)).toEqual({ ok: false, code: 'AUTH', error: 'ログインできませんでした。もう一度お試しください。' });
  });
```

`tests/handler.test.ts` と `tests/nativeBoundary.test.ts` の deps 生成箇所に `loginSubscription: async () => {},` を追加（型合わせのみ）。

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run tests/requestBoundary.test.ts`
Expected: 新しい2件が FAIL。

- [ ] **Step 3: 実装**

`src/shared/types.ts`:
```ts
/** 解説ポップアップの「ブラウザでログイン」。Claude サブスク接続の再ログインを起動する。 */
export interface LoginRequest {
  type: 'login';
}
```
`RequestMessage` のユニオンに `| LoginRequest` を追加。

`src/shared/messages.ts`: import に `LoginRequest` を加え、3つ目のオーバーロードを
`req: TranslateLineRequest | ExplainSelectionRequest | ExplainSentenceRequest | PingRequest | LoginRequest,` にする。

`src/background/requestBoundary.ts` の `isRequest` の switch に `case 'login': return true;` を追加（options ページからは既存の「options は ping のみ」で弾かれる）。

`src/background/handler.ts`:
- `HandlerDeps` に追加:
```ts
  /** Claude サブスク接続の再ログイン（公式 CLI の auth login）。 */
  loginSubscription: () => Promise<void>;
```
- `try` 内、`settings.provider` の検査（`anthropic` / `claude-subscription` 以外のエラー）の直後、`NO_API_KEY` 判定より前に:
```ts
    if (req.type === 'login') {
      if (settings.provider !== 'claude-subscription') {
        throw new AiError('UNKNOWN', 'ログインは Claude サブスク接続のときだけ使えます。');
      }
      await deps.loginSubscription();
      return { ok: true, text: 'OK' };
    }
```
  （`ensureCurrent()` は呼ばない: ログインはタブ遷移で取り消さない。）

`src/background/index.ts` の deps に `loginSubscription: native.login,` を追加。

- [ ] **Step 4: 合格を確認**

Run: `npx vitest run tests/requestBoundary.test.ts tests/handler.test.ts tests/nativeBoundary.test.ts && npx tsc --noEmit`
Expected: PASS、型エラーなし。

- [ ] **Step 5: コミット**

```bash
git add src/shared/types.ts src/shared/messages.ts src/background/ tests/requestBoundary.test.ts tests/handler.test.ts tests/nativeBoundary.test.ts
git commit -m "feat: 動画ページから Claude の再ログインを依頼できるようにする"
```

---

### Task 4: ポップアップのログインボタンと自動やり直し

**Files:**
- Modify: `src/content/overlay.ts`（`PopupAction`、`setPopupError` / `setPopupSentence` のボタン、スタイル）
- Modify: `src/content/interaction.ts`（AUTH 時のボタン、ログイン、再試行）
- Test: `tests/overlay.test.ts`, `tests/interaction.test.ts`

**Interfaces:**
- Consumes: Task 3 の `sendRequest({ type: 'login' })`、`ErrorResponse.code`。
- Produces: `export interface PopupAction { label: string; onClick?: () => void }`（`onClick` が無ければ押せないボタン）。`setPopupError(message: string, action?: PopupAction): void`。`PopupSentenceMeaning` の失敗形を `{ ok: false; error: string; action?: PopupAction }` に。ボタンは `button.popup-action`。

- [ ] **Step 1: 失敗するテストを書く**

`tests/overlay.test.ts` の末尾に追加:

```ts
describe('createOverlay — エラー時の操作ボタン', () => {
  let overlay: Overlay | null = null;
  beforeEach(() => {
    document.body.replaceChildren();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    overlay = createOverlay(noopCallbacks(), { bottomPercent: 10, onBottomChange: () => {} });
    overlay.openPopup(new DOMRect(10, 10, 10, 10), 'word');
  });
  afterEach(() => { overlay?.destroy(); overlay = null; });
  it('上段のエラーにボタンを出し、押すと onClick を呼ぶ', () => {
    let clicked = 0;
    overlay!.setPopupError('ログインし直してください', { label: 'ブラウザでログイン', onClick: () => { clicked++; } });
    const btn = shadow().querySelector<HTMLButtonElement>('.body .popup-action')!;
    expect(btn.textContent).toBe('ブラウザでログイン');
    expect(btn.disabled).toBe(false);
    btn.click();
    expect(clicked).toBe(1);
    expect(shadow().querySelector('.body')!.textContent).toContain('ログインし直してください');
  });
  it('onClick が無いボタンは押せない', () => {
    overlay!.setPopupError('x', { label: '待機中' });
    expect(shadow().querySelector<HTMLButtonElement>('.body .popup-action')!.disabled).toBe(true);
  });
  it('ボタン無しのエラーにはボタンを出さない', () => {
    overlay!.setPopupError('x');
    expect(shadow().querySelector('.popup-action')).toBeNull();
  });
  it('下段のエラーにもボタンを出せる', () => {
    overlay!.setPopupSentence({ ok: false, error: 'ログインし直してください', action: { label: 'ブラウザでログイン', onClick: () => {} } });
    expect(shadow().querySelector('.sentence .popup-action')!.textContent).toBe('ブラウザでログイン');
  });
});
```

`tests/interaction.test.ts` の末尾に追加（このファイルの `request` モックは呼び出し順に `pending` へ resolve を積む。`runLookup` は 0=lookupWord, 1=explainSelection, 2=explainSentence を送る）:

```ts
const AUTH = { ok: false, code: 'AUTH', error: 'Claude Code で利用する Claude Pro アカウントにログインし直してください。' };
const popup = () => document.getElementById('useful-subtitle-overlay')!.shadowRoot!;
async function flush(): Promise<void> { for (let i = 0; i < 5; i++) await Promise.resolve(); }

it('AUTH エラーでログインボタンを出し、ログイン成功後に意味引きをやり直す', async () => {
  const lookup = runLookup(overlay, settings, 'word', 'Video A', anchor());
  pending[0]({ ok: true, kind: 'word', ipa: null, audioUrl: null });
  pending[1](AUTH);
  pending[2](AUTH);
  await lookup; await flush();
  const btn = popup().querySelector<HTMLButtonElement>('.body .popup-action')!;
  expect(btn.textContent).toBe('ブラウザでログイン');
  expect(popup().querySelector('.sentence .popup-action')).not.toBeNull();
  btn.click();
  expect(request).toHaveBeenLastCalledWith({ type: 'login' });
  const waiting = popup().querySelector<HTMLButtonElement>('.body .popup-action')!;
  expect(waiting.textContent).toBe('ブラウザでログインを完了してください…');
  expect(waiting.disabled).toBe(true);
  pending[3]({ ok: true, text: 'OK' });
  await flush();
  // やり直し: lookupWord / explainSelection / explainSentence をもう一度送る。
  expect(request.mock.calls.slice(4).map(([req]) => req.type)).toEqual(['lookupWord', 'explainSelection', 'explainSentence']);
  pending[4]({ ok: true, kind: 'word', ipa: null, audioUrl: null });
  pending[5]({ ok: true, text: 'Fresh explanation' });
  pending[6]({ ok: true, text: '訳: 新しい和訳' });
  await flush();
  expect(popup().querySelector('.body')!.textContent).toContain('Fresh explanation');
});

it('ログイン失敗でメッセージとボタンを出し直す', async () => {
  const lookup = runLookup(overlay, settings, 'word', 'Video A', anchor());
  pending[0]({ ok: true, kind: 'word', ipa: null, audioUrl: null });
  pending[1](AUTH);
  pending[2]({ ok: true, text: '訳: 和訳' });
  await lookup; await flush();
  popup().querySelector<HTMLButtonElement>('.body .popup-action')!.click();
  pending[3]({ ok: false, code: 'AUTH', error: 'ログインできませんでした。もう一度お試しください。' });
  await flush();
  expect(popup().querySelector('.body')!.textContent).toContain('ログインできませんでした。もう一度お試しください。');
  const again = popup().querySelector<HTMLButtonElement>('.body .popup-action')!;
  expect(again.textContent).toBe('ブラウザでログイン');
  expect(again.disabled).toBe(false);
  expect(request).toHaveBeenCalledTimes(4);
});

it('ログイン中にポップアップを閉じたら、成功してもやり直さない', async () => {
  const lookup = runLookup(overlay, settings, 'word', 'Video A', anchor());
  pending[0]({ ok: true, kind: 'word', ipa: null, audioUrl: null });
  pending[1](AUTH);
  pending[2](AUTH);
  await lookup; await flush();
  popup().querySelector<HTMLButtonElement>('.body .popup-action')!.click();
  overlay.hidePopup();
  pending[3]({ ok: true, text: 'OK' });
  await flush();
  expect(request).toHaveBeenCalledTimes(4);
});

it('AUTH 以外のエラーにはボタンを出さない', async () => {
  const lookup = runLookup(overlay, settings, 'word', 'Video A', anchor());
  pending[0]({ ok: true, kind: 'word', ipa: null, audioUrl: null });
  pending[1]({ ok: false, code: 'NETWORK', error: '接続が切れました' });
  pending[2]({ ok: false, code: 'NETWORK', error: '接続が切れました' });
  await lookup; await flush();
  expect(popup().querySelector('.popup-action')).toBeNull();
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run tests/overlay.test.ts tests/interaction.test.ts`
Expected: 新しいテストが FAIL。

- [ ] **Step 3: 実装**

`src/content/overlay.ts`:
```ts
/** ポップアップのエラー表示に添える操作ボタン。onClick が無い間は押せない（処理中の表示）。 */
export interface PopupAction {
  label: string;
  onClick?: () => void;
}
export type PopupSentenceMeaning =
  | { ok: true; translation: string; explanation: string }
  | { ok: false; error: string; action?: PopupAction }
  | null;
```
`Overlay` インターフェースの `setPopupError(message: string, action?: PopupAction): void;` に変更。ボタン生成関数を追加:
```ts
function createPopupActionButton(action: PopupAction): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'popup-action';
  btn.textContent = action.label;
  btn.disabled = !action.onClick;
  // 字幕側の選択・ドラッグ処理に拾われないよう、押下でフォーカス移動もさせない。
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  if (action.onClick) btn.addEventListener('click', action.onClick);
  return btn;
}
```
`setPopupError(message, action?)`: `popupBody.textContent = message;` の後に `if (action) { popupBody.appendChild(document.createElement('br')); popupBody.appendChild(createPopupActionButton(action)); }`。
`setPopupSentence` の `!meaning.ok` 分岐: `err.textContent = meaning.error;` の後に同様に `if (meaning.action) { err.appendChild(document.createElement('br')); err.appendChild(createPopupActionButton(meaning.action)); }`。
`STYLES` の `.popup .body.err { ... }` の次に追加:
```css
.popup .popup-action { margin-top: 8px; padding: 4px 10px; border: 1px solid #8ab4ff; border-radius: 6px; background: transparent; color: #cfe0ff; font: inherit; font-size: 13px; cursor: pointer; }
.popup .popup-action:hover:not(:disabled) { background: rgba(138, 180, 255, 0.15); }
.popup .popup-action:disabled { opacity: 0.7; cursor: default; }
```

`src/content/interaction.ts`:
```ts
import type { Overlay, PopupAction } from './overlay';
import type { ErrorResponse } from '../shared/types';

const LOGIN_LABEL = 'ブラウザでログイン';
const LOGIN_WAITING = 'ブラウザでログインを完了してください…';

/**
 * AUTH エラーのときだけ「ブラウザでログイン」ボタンを作る。押すと公式 CLI のログインを起動し、
 * 成功してポップアップがまだ同じなら retry（意味引きのやり直し）を呼ぶ。show はボタンを出す場所（上段/下段）。
 */
function loginAction(
  res: ErrorResponse,
  overlay: Overlay,
  popupToken: number,
  show: (message: string, action?: PopupAction) => void,
  retry: () => void,
): PopupAction | undefined {
  if (res.code !== 'AUTH') return undefined;
  const action: PopupAction = {
    label: LOGIN_LABEL,
    onClick: () => {
      show(res.error, { label: LOGIN_WAITING });
      void sendRequest({ type: 'login' }).then((login) => {
        if (!overlay.isPopupCurrent(popupToken)) return;
        if (login.ok) retry();
        else show(login.error, loginAction({ ...login, code: 'AUTH' }, overlay, popupToken, show, retry));
      });
    },
  };
  return action;
}
```
`loadSentenceMeaning` に `retry: () => void` 引数を追加し、失敗時:
```ts
    const show = (error: string, action?: PopupAction): void => overlay.setPopupSentence({ ok: false, error, action });
    show(res.error, loginAction(res, overlay, popupToken, show, retry));
```
`runLookup` で:
```ts
  const retry = (): void => { void runLookup(overlay, settings, selection, sentence, anchor, neighbors); };
  void loadSentenceMeaning(overlay, sentence, neighbors, popupToken, retry);
  ...
  } else {
    const show = (error: string, action?: PopupAction): void => overlay.setPopupError(error, action);
    show(res.error, loginAction(res, overlay, popupToken, show, retry));
  }
```
（`res` が `ErrorResponse` に絞られていることを TypeScript で確認。ログイン失敗は code が何であってもボタンを出し直すため `{ ...login, code: 'AUTH' }` で渡す。）

- [ ] **Step 4: 合格を確認**

Run: `npx vitest run tests/overlay.test.ts tests/interaction.test.ts && npx tsc --noEmit`
Expected: PASS、型エラーなし。

- [ ] **Step 5: コミット**

```bash
git add src/content/overlay.ts src/content/interaction.ts tests/overlay.test.ts tests/interaction.test.ts
git commit -m "feat: 解説ポップアップのログインエラーに「ブラウザでログイン」ボタンを追加"
```

---

### Task 5: ドキュメント・バージョン・全体確認

**Files:**
- Modify: `README.md:74`
- Modify: `docs/superpowers/specs/2026-11-24-popup-login-design.md`（5 分 → 4 分の表記合わせ）
- Modify: `manifest.json`, `package.json`（0.14.0 → 0.15.0）

- [ ] **Step 1: README の認証エラー行を更新**

```markdown
- **認証エラー**: 解説ポップアップの「ブラウザでログイン」を押すと Claude のログイン画面が開きます。許可すると自動で解説を取り直します。ターミナルで `claude auth login` を実行しても同じです。API 認証からサブスクに無断で切り替えることはありません。
```

- [ ] **Step 2: 仕様書の制限時間を 4 分に合わせる**（「5分経過時」→「4分経過時」、「制限時間 5 分」→「制限時間 4 分（拡張側 250 秒）。MV3 service worker の 5 分制限より短くする」、「5 分 10 秒」→「250 秒」）

- [ ] **Step 3: バージョンを 0.15.0 に**（`manifest.json` と `package.json` の `"version"`）

- [ ] **Step 4: 全体の確認（1回ずつ）**

Run: `npx tsc --noEmit && npm test && npm run test:native && npm run build`
Expected: すべて成功。

- [ ] **Step 5: コミット**

```bash
git add README.md docs/superpowers/specs/2026-11-24-popup-login-design.md manifest.json package.json
git commit -m "chore: バージョンを 0.15.0 に上げる（ポップアップから Claude に再ログイン）"
```
