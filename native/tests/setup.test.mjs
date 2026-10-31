import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { parseArgs, setupNative, shellQuote } from '../../scripts/setup-native.mjs';
const extension = 'abcdefghijklmnopabcdefghijklmnop';
function fixture(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "subtitle setup's-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home'); mkdirSync(home);
  const cli = join(root, 'fake claude'); writeFileSync(cli, '#!/bin/sh\nexit 0\n'); chmodSync(cli, 0o700);
  const options = parseArgs(['--browser', 'brave', '--extension-id', extension, '--claude-path', cli]);
  return { root, home, cli, options, runtime: { home, platform: 'darwin' } };
}
test('rejects invalid extension ids, browsers, paths and unknown flags', () => {
  for (const id of ['a'.repeat(31), 'q'.repeat(32), `${extension};`]) assert.throws(() => parseArgs(['--browser', 'brave', '--extension-id', id]));
  assert.throws(() => parseArgs(['--browser', 'firefox', '--extension-id', extension]));
  assert.throws(() => parseArgs(['--browser', 'brave', '--extension-id', extension, '--claude-path', './cli']));
  assert.throws(() => parseArgs(['--unknown']));
});
test('dry run reports paths without writing and installer quotes paths', t => {
  const { home, cli, options, runtime } = fixture(t);
  const dry = setupNative({ ...options, 'dry-run': true }, runtime);
  assert.equal(existsSync(join(home, 'Library')), false);
  const result = setupNative(options, runtime);
  assert.equal(result.registrationPath, dry.registrationPath);
  const manifest = JSON.parse(readFileSync(result.registrationPath));
  assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${extension}/`]);
  const config = JSON.parse(readFileSync(result.configPath));
  assert.equal(config.claudePath, cli);
  assert.ok(readFileSync(result.launcherPath, 'utf8').includes(shellQuote(result.configPath)));
  assert.equal(spawnSync('/bin/sh', ['-n', result.launcherPath]).status, 0);
  // Invalid origin exits before Claude can run.
  assert.equal(spawnSync(result.launcherPath, ['chrome-extension://wrong/'], { timeout: 2000 }).status, 1);
});
test('preserves unrelated files and refuses conflicting registration or symlink', t => {
  const { options, runtime, root } = fixture(t);
  const result = setupNative(options, runtime);
  const unrelated = join(result.appDir, 'keep.txt'); writeFileSync(unrelated, 'keep');
  writeFileSync(result.registrationPath, JSON.stringify({ name: 'another' }));
  assert.throws(() => setupNative(options, runtime));
  rmSync(result.registrationPath);
  symlinkSync(join(root, 'target'), result.registrationPath);
  assert.throws(() => setupNative(options, runtime));
  assert.equal(readFileSync(unrelated, 'utf8'), 'keep');
});
test('chrome support and uninstall preserve unrelated files', t => {
  const { options, runtime } = fixture(t);
  const result = setupNative({ ...options, browser: 'chrome' }, runtime);
  assert.ok(result.registrationPath.includes('Google/Chrome/NativeMessagingHosts'));
  const unrelated = join(result.appDir, 'keep.txt'); writeFileSync(unrelated, 'keep');
  setupNative({ ...options, browser: 'chrome', uninstall: true }, runtime);
  assert.equal(existsSync(result.registrationPath), false);
  assert.equal(existsSync(result.configPath), false);
  assert.equal(existsSync(result.launcherPath), false);
  assert.equal(readFileSync(unrelated, 'utf8'), 'keep');
});
test('refuses unowned runtime files without overwriting them', t => {
  const { options, runtime, home } = fixture(t);
  const dir = join(home, 'Library/Application Support/UsefulSubtitle/runtime');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'host.mjs'); writeFileSync(file, 'unrelated');
  assert.throws(() => setupNative(options, runtime));
  assert.equal(readFileSync(file, 'utf8'), 'unrelated');
});
