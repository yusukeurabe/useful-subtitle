import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, delimiter } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { validateRequest } from './protocol.mjs';

const OUTPUT_LIMIT = 256 * 1024;
const TEXT_LIMIT = 64 * 1024;
const MESSAGES = {
  AUTH: 'Claude Code で Claude の契約アカウントにログインしてください。API キー認証では利用できません。',
  RATE_LIMIT: 'Claude の利用上限に達しました。時間をおいて再度お試しください。',
  NETWORK: 'Claude との通信が中断されたか、時間内に完了しませんでした。接続を確認してください。',
  NATIVE_SETUP: 'Claude 接続の設定を確認し、必要ならセットアップをやり直してください。管理ポリシーがある環境はこの接続に対応していません。',
  BUSY: 'Claude が別のリクエストを処理しています。少し待ってからお試しください。',
  UNKNOWN: 'Claude の応答を取得できませんでした。選択したモデルが契約で利用可能か確認してください。',
};
export function failure(id, code) { return { id, ok: false, code, error: MESSAGES[code] }; }
export function isolatedEnv(source) {
  const allowed = ['HOME', 'USER', 'LOGNAME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'LC_MESSAGES'];
  return Object.fromEntries(allowed.filter(key => typeof source[key] === 'string').map(key => [key, source[key]]));
}
const isolation = ['--safe-mode', '--setting-sources', '', '--settings', '{"disableAllHooks":true}', '--tools', '', '--disallowedTools', 'mcp__*', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands', '--no-chrome'];
const managedFiles = ['/Library/Application Support/ClaudeCode/managed-settings.json', '/Library/Application Support/ClaudeCode/managed-settings.d', '/Library/Application Support/ClaudeCode/managed-mcp.json', '/Library/Managed Preferences/com.anthropic.claudecode.plist', '/etc/claude-code/managed-settings.json', '/etc/claude-code/managed-settings.d', '/etc/claude-code/managed-mcp.json'];

function execute(file, args, input, options, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject({ code: 'NETWORK' });
    let child;
    try {
      options.beforeSpawn?.();
      const env = { ...isolatedEnv(options.env), CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(options.maxTokens), CLAUDE_CODE_MAX_RETRIES: '0' };
      env.PATH = [dirname(options.nodePath), env.PATH].filter(Boolean).join(delimiter);
      child = options.spawn(file, args, { cwd: options.cwd, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    } catch { reject({ code: 'NATIVE_SETUP' }); return; }
    let stdout = '', stderr = '', bytes = 0, error, settled = false, killTimer;
    const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
    const kill = (signal) => {
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch { try { child.kill(signal); } catch {} }
    };
    const stop = (code) => {
      if (error) return;
      error = { code };
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 500);
    };
    const abort = () => stop('NETWORK');
    const timer = setTimeout(abort, timeoutMs);
    options.signal?.addEventListener('abort', abort, { once: true });
    const finish = (exitCode) => {
      if (settled) return; settled = true;
      stdout += decoders.stdout.end(); stderr += decoders.stderr.end();
      clearTimeout(timer); clearTimeout(killTimer);
      if (error && child.pid && process.platform !== 'win32') {
        try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      }
      options.signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve({ stdout, stderr, exitCode });
    };
    const collect = (kind, data) => {
      bytes += data.length;
      if (bytes > OUTPUT_LIMIT) { stop('UNKNOWN'); return; }
      if (kind === 'stdout') stdout += decoders.stdout.write(data); else stderr += decoders.stderr.write(data);
    };
    child.stdout.on('data', chunk => collect('stdout', chunk));
    child.stderr.on('data', chunk => collect('stderr', chunk));
    child.on('error', () => { error = { code: 'NATIVE_SETUP' }; finish(null); });
    child.on('close', finish);
    child.stdin.on('error', () => stop('NETWORK'));
    try { options.onSpawn?.(child.pid); } catch { stop('NATIVE_SETUP'); }
    child.stdin.end(input);
    if (options.signal?.aborted) abort();
  });
}
function classify(text) {
  if (/rate.?limit|usage.?limit|overloaded|429/i.test(text)) return 'RATE_LIMIT';
  if (/unauthorized|authentication|not logged in|401/i.test(text)) return 'AUTH';
  if (/network|connection|timed?.?out|ECONN|ENOTFOUND|EAI_AGAIN|\bDNS\b|(?:can't reach|cannot reach|unreachable).*API server|fetch failed/i.test(text)) return 'NETWORK';
  return 'UNKNOWN';
}
export async function runClaude(request, options = {}) {
  const id = typeof request?.id === 'string' && request.id.length <= 128 ? request.id : '';
  try {
    validateRequest(request);
    const config = { spawn: nodeSpawn, env: process.env, timeoutMs: 45000, nodePath: process.execPath, ...options, maxTokens: Math.max(1024, request.maxTokens ?? 1024) };
    const policyFiles = [...managedFiles];
    if (config.env.HOME) policyFiles.push(join(config.env.HOME, 'Library/Preferences/com.anthropic.claudecode.plist'), join(config.env.HOME, 'Library/Managed Preferences/com.anthropic.claudecode.plist'));
    if (config.env.USER && /^[a-zA-Z0-9._-]+$/.test(config.env.USER)) policyFiles.push(`/Library/Managed Preferences/${config.env.USER}/com.anthropic.claudecode.plist`);
    if (!isAbsolute(config.claudePath ?? '') || !isAbsolute(config.cwd ?? '') || !isAbsolute(config.nodePath ?? '') || policyFiles.some(file => (config.policyExists ?? existsSync)(file))) return failure(id, 'NATIVE_SETUP');
    const deadline = Date.now() + config.timeoutMs;
    const invoke = (args, input) => execute(config.claudePath, args, input, config, Math.max(1, deadline - Date.now()));
    const auth = await invoke([...isolation, 'auth', 'status', '--json'], '');
    let status;
    try { status = JSON.parse(auth.stdout); } catch { return failure(id, 'AUTH'); }
    if (auth.exitCode !== 0 || status.loggedIn !== true || status.authMethod !== 'claude.ai' || status.apiProvider !== 'firstParty' || (status.subscriptionType !== undefined && !['pro', 'max'].includes(status.subscriptionType))) return failure(id, 'AUTH');
    const response = await invoke(['-p', ...isolation, '--no-session-persistence', '--output-format', 'json', '--max-turns', '1', '--effort', 'low', '--model', request.model, '--system-prompt', request.system], request.user);
    let result;
    try { result = JSON.parse(response.stdout); } catch { return failure(id, classify(response.stderr)); }
    if (response.exitCode !== 0 || result.type !== 'result' || result.subtype !== 'success' || result.is_error !== false || ['refusal', 'max_tokens'].includes(result.stop_reason) || typeof result.result !== 'string' || !result.result.trim() || Buffer.byteLength(result.result, 'utf8') > TEXT_LIMIT) {
      return failure(id, classify(`${response.stderr} ${JSON.stringify(result)}`));
    }
    return { id, ok: true, text: result.result };
  } catch (error) { return failure(id, MESSAGES[error?.code] ? error.code : 'UNKNOWN'); }
}
