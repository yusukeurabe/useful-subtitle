import { closeSync, openSync, readdirSync, unlinkSync, readFileSync, writeFileSync, lstatSync, renameSync, fsyncSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureDirectory } from './files.mjs';

// Publish a unique exclusive claim before inspecting other claims. Any overlap
// rejects admission; stale claims name a dead owner and can be removed safely.
export function acquireLock(directory, { pid = process.pid, isAlive = (owner) => {
  try { process.kill(owner, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
} } = {}) {
  ensureDirectory(directory);
  const name = `${pid}-${randomUUID()}.lock`;
  const path = join(directory, name);
  closeSync(openSync(path, 'wx', 0o600));
  const release = () => { try { unlinkSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; } };
  const update = (metadata) => {
    const temporary = `${path}.tmp`;
    const fd = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify(metadata)); fsyncSync(fd); }
    finally { closeSync(fd); }
    renameSync(temporary, path);
  };
  release.beforeSpawn = () => update({ state: 'spawning' });
  release.trackChild = (childPid) => {
    if (!Number.isInteger(childPid) || childPid < 1) throw new Error('Child PID required');
    update({ state: 'running', childPid });
  };
  try {
    update({ state: 'idle' });
    for (const entry of readdirSync(directory)) {
      if (entry === name) continue;
      const match = /^(\d+)-[a-f0-9-]+\.lock$/.exec(entry);
      if (!match || isAlive(Number(match[1]))) { release(); return null; }
      try {
        const stalePath = join(directory, entry);
        if (!lstatSync(stalePath).isFile()) { release(); return null; }
        const content = readFileSync(stalePath, 'utf8');
        const metadata = JSON.parse(content);
        const recoverable = metadata?.state === 'idle'
          || (metadata?.state === 'running' && Number.isInteger(metadata.childPid) && metadata.childPid > 0 && !isAlive(metadata.childPid));
        if (!recoverable) { release(); return null; }
        unlinkSync(stalePath);
      } catch (error) { if (error.code !== 'ENOENT') { release(); return null; } }
    }
    return release;
  } catch (error) { release(); throw error; }
}
