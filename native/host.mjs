import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FrameDecoder, encodeFrame, validateRequest } from './protocol.mjs';
import { runClaude, failure } from './claude.mjs';
import { acquireLock } from './lock.mjs';
import { assertNoSymlinks, ensureDirectory } from './files.mjs';

export function createHost({ input, output, config, run = runClaude, idleMs = 60000, onExit = () => {} }) {
  let active, closed = false, idle;
  const send = value => { if (!closed) output.write(encodeFrame(value)); };
  const resetIdle = () => { clearTimeout(idle); idle = setTimeout(() => { void close(); }, idleMs); };
  const close = async () => {
    if (closed) return;
    closed = true; clearTimeout(idle);
    input.removeListener('data', onData); input.pause();
    active?.controller.abort();
    await active?.promise;
    onExit();
  };
  const decoder = new FrameDecoder(request => {
    const id = typeof request?.id === 'string' && request.id.length <= 128 ? request.id : '';
    try { validateRequest(request); } catch { send(failure(id, 'UNKNOWN')); return; }
    if (active) { send(failure(id, 'BUSY')); return; }
    let release;
    try { release = acquireLock(join(config.appDir, 'locks')); }
    catch { send(failure(id, 'NATIVE_SETUP')); return; }
    if (!release) { send(failure(id, 'BUSY')); return; }
    clearTimeout(idle);
    const controller = new AbortController();
    active = { controller, promise: null };
    active.promise = (async () => {
      let cwd;
      try {
        ensureDirectory(join(config.appDir, 'requests'));
        cwd = mkdtempSync(join(config.appDir, 'requests', 'request-'));
        send(await run(request, { claudePath: config.claudePath, nodePath: config.nodePath, cwd, signal: controller.signal, beforeSpawn: release.beforeSpawn, onSpawn: release.trackChild }));
      } catch { send(failure(id, 'NATIVE_SETUP')); }
      finally {
        if (cwd) rmSync(cwd, { recursive: true, force: true });
        release(); active = undefined;
        if (!closed) resetIdle();
      }
    })();
  });
  const onData = chunk => { try { resetIdle(); decoder.push(chunk); } catch { void close(); } };
  input.on('data', onData);
  input.once('end', () => { void close(); });
  input.once('error', () => { void close(); });
  output.once('error', () => { void close(); });
  resetIdle();
  return { close };
}

function main() {
  try {
    const configPath = process.argv[2];
    assertNoSymlinks(configPath);
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    if (config.owner !== 'useful-subtitle-native-v1' || !isAbsolute(config.appDir ?? '') || !isAbsolute(config.claudePath ?? '') || !isAbsolute(config.nodePath ?? '') || !/^chrome-extension:\/\/[a-p]{32}\/$/.test(config.allowedOrigin) || process.argv[3] !== config.allowedOrigin) throw new Error('Invalid config or origin');
    assertNoSymlinks(config.appDir);
    const host = createHost({ input: process.stdin, output: process.stdout, config, onExit: () => { process.exitCode = 0; process.stdout.end(); } });
    process.once('SIGINT', () => { void host.close(); });
    process.once('SIGTERM', () => { void host.close(); });
  } catch { process.exitCode = 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
