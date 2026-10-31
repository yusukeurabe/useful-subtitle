import { lstatSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, parse, resolve } from 'node:path';

export function assertNoSymlinks(path) {
  if (!isAbsolute(path)) throw new Error('Absolute path required');
  let current = resolve(path);
  while (current !== parse(current).root) {
    try { if (lstatSync(current).isSymbolicLink()) throw new Error('Symlink is not allowed'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    current = dirname(current);
  }
}
export function ensureDirectory(path) {
  assertNoSymlinks(path);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (!lstatSync(path).isDirectory()) throw new Error('Directory required');
}
