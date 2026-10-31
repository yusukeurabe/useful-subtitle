import { accessSync, constants, existsSync, lstatSync, readFileSync, realpathSync, unlinkSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertNoSymlinks, ensureDirectory } from '../native/files.mjs';

export const HOST_NAME = 'com.useful_subtitle.claude';
const OWNER = 'useful-subtitle-native-v1';
export const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;
export function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run' || arg === '--uninstall') options[arg.slice(2)] = true;
    else if (['--browser', '--extension-id', '--claude-path'].includes(arg) && args[i + 1] && !args[i + 1].startsWith('--')) options[arg.slice(2)] = args[++i];
    else throw new Error('引数を確認してください。--browser brave|chrome --extension-id <32文字のID> を指定します。');
  }
  if (!['brave', 'chrome'].includes(options.browser) || !/^[a-p]{32}$/.test(options['extension-id'] ?? '')) throw new Error('ブラウザと拡張機能 ID（a〜p の32文字）を確認してください。');
  if (options['claude-path'] && !isAbsolute(options['claude-path'])) throw new Error('--claude-path には絶対パスを指定してください。');
  return options;
}
function executable(path) {
  if (!isAbsolute(path)) throw new Error('実行ファイルの絶対パスが必要です。');
  accessSync(path, constants.X_OK);
  const resolved = realpathSync(path);
  if (!lstatSync(resolved).isFile()) throw new Error('実行ファイルを確認してください。');
  return resolved;
}
function findClaude(env) {
  for (const directory of (env.PATH ?? '').split(':').filter(isAbsolute)) {
    try { return executable(join(directory, 'claude')); } catch {}
  }
  throw new Error('Claude Code が見つかりません。--claude-path に絶対パスを指定してください。');
}
export function setupNative(options, { home = process.env.HOME, env = process.env, nodePath = process.execPath, platform = process.platform } = {}) {
  if (platform !== 'darwin') throw new Error('現在は macOS の Brave / Chrome に対応しています。');
  if (!isAbsolute(home ?? '')) throw new Error('HOME の絶対パスを確認してください。');
  const appDir = join(home, 'Library', 'Application Support', 'UsefulSubtitle');
  const browserDir = join(appDir, options.browser);
  const registrationDir = join(home, 'Library', 'Application Support', options.browser === 'brave' ? 'BraveSoftware/Brave-Browser' : 'Google/Chrome', 'NativeMessagingHosts');
  const registrationPath = join(registrationDir, `${HOST_NAME}.json`);
  const launcherPath = join(browserDir, 'launch.sh');
  const configPath = join(browserDir, 'config.json');
  const modules = ['host.mjs', 'claude.mjs', 'protocol.mjs', 'lock.mjs', 'files.mjs'];
  const runtimeDir = join(appDir, 'runtime');
  const markerPath = join(runtimeDir, 'owner.json');
  const allowedOrigin = `chrome-extension://${options['extension-id']}/`;
  for (const path of [appDir, browserDir, registrationDir, registrationPath, launcherPath, configPath, markerPath, ...modules.map(name => join(runtimeDir, name))]) assertNoSymlinks(path);
  if (existsSync(markerPath)) {
    if (JSON.parse(readFileSync(markerPath, 'utf8')).owner !== OWNER) throw new Error('既存の実行プログラムと競合しています。');
  } else if (modules.some(name => existsSync(join(runtimeDir, name)))) throw new Error('所有者を確認できない実行プログラムが存在します。');
  const manifest = { name: HOST_NAME, description: 'Useful Subtitle Claude subscription connection', path: launcherPath, type: 'stdio', allowed_origins: [allowedOrigin] };
  if (existsSync(registrationPath)) {
    const existing = JSON.parse(readFileSync(registrationPath, 'utf8'));
    if (existing.name !== HOST_NAME || existing.path !== launcherPath || existing.type !== 'stdio' || JSON.stringify(existing.allowed_origins) !== JSON.stringify(manifest.allowed_origins)) throw new Error('同名の別の登録が存在します。上書きしません。');
  }
  if (existsSync(configPath)) {
    const existing = JSON.parse(readFileSync(configPath, 'utf8'));
    if (existing.owner !== OWNER || existing.appDir !== appDir || existing.allowedOrigin !== allowedOrigin) throw new Error('既存の接続設定と競合しています。');
  } else if (existsSync(launcherPath)) throw new Error('所有者を確認できない起動ファイルが存在します。');
  const paths = { appDir, registrationPath, launcherPath, configPath };
  if (options.uninstall) {
    if (!options['dry-run']) {
      if (existsSync(registrationPath)) unlinkSync(registrationPath);
      if (existsSync(configPath)) {
        if (existsSync(launcherPath)) unlinkSync(launcherPath);
        unlinkSync(configPath);
      }
    }
    return { action: 'uninstall', ...paths };
  }
  const config = { owner: OWNER, nodePath: executable(nodePath), claudePath: options['claude-path'] ? executable(options['claude-path']) : findClaude(env), appDir, allowedOrigin };
  if (!options['dry-run']) {
    for (const directory of [appDir, browserDir, registrationDir, runtimeDir]) ensureDirectory(directory);
    for (const name of modules) copyFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'native', name), join(runtimeDir, name));
    writeFileSync(markerPath, `${JSON.stringify({ owner: OWNER })}\n`, { mode: 0o600 });
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    writeFileSync(launcherPath, `#!/bin/sh\nexec ${shellQuote(config.nodePath)} ${shellQuote(join(runtimeDir, 'host.mjs'))} ${shellQuote(configPath)} "$@"\n`, { mode: 0o700 });
    writeFileSync(registrationPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  }
  return { action: options['dry-run'] ? 'dry-run' : 'install', ...paths };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(setupNative(parseArgs(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
