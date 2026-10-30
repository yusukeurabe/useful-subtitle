# Claude Subscription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Tasks are executed sequentially; the user approved implementation and PR creation on 2026-10-30.

**Goal:** Claude Pro のログインで自動和訳・語句解説を行い、API へ自動切替しない。

**Architecture:** MV3 background に単一の Native Messaging クライアントと優先キューを置く。Node.js の専用ホストが制限した環境・ツールなしの `claude -p` を実行する。登録用スクリプトを提供し、ホストは非使用時に終了する。

**Tech Stack:** 既存 TypeScript / esbuild / Vitest、Node.js 標準モジュール（新規依存なし）。

**Spec:** `docs/superpowers/specs/2026-10-30-claude-subscription-design.md`

## Global Constraints

- Mac / Brave を第一対象。CLI は Pro / Max の claude.ai 認証のみ。API key / console 認証を拒否。
- `.env` / 認証ファイルを読まない。OAuth を拡張へ渡さない。CLI の正式な認証だけを使う。
- ツール、hooks、skills、plugins、MCP、CLAUDE.md を無効化。`--bare` は使わない。
- 同時 Claude 実行 1 件。API へのフォールバックなし。常駐サーバーなし。
- 既存設定を保持。方式は明示的に切り替える。キャッシュは方式別。
- 原文字幕は従来どおり。遅い和訳は最新字幕へ上書きしない。
- 開発サーバー禁止、テスト単一 worker、ローカルビルドは最終時に 1 回のみ。
- Git commit / push / PR は親エージェント担当。変更は専用ブランチで行う。

## Review Focus

1. 継承環境・個人設定によって API 課金や外部ツールが有効化されない（Task 1）。
2. タブ切替・連続字幕・同一文の重複要求で古い結果や待機 promise が残らない（Task 2）。
3. タイムアウト・ブラウザ切断・壊れた JSON で Claude 子プロセスを残さない（Task 1 / 2）。
4. 空白やクォートを含むインストールパス、無効な ID、既存登録の誤上書き（Task 1）。
5. API キーなしでサブスク利用可能、API 選択時の従来ガード、秘密キー非転送（Task 2）。

## Task 1: Native host とセットアップ

**Files:** Create `native/host.mjs`, `native/claude.mjs`, `native/protocol.mjs`, `scripts/setup-native.mjs`, `native/tests/*.test.mjs`. 必要なら単責任の小さな native module を追加する。Modify `package.json` に `setup:native` / `test:native` を追加。

**Interfaces:**
- Host name: `com.useful_subtitle.claude`。
- stdin/stdout: little-endian UInt32 length + UTF-8 JSON。
- Request: `{ id: string, model: string, system: string, user: string, maxTokens?: number }`。
- Response: `{ id: string, ok: true, text: string }` または `{ id: string, ok: false, code: 'AUTH'|'RATE_LIMIT'|'NETWORK'|'NATIVE_SETUP'|'BUSY'|'UNKNOWN', error: string }`。
- Export testable `runClaude(request, options)` from `native/claude.mjs`; inject spawn / env / timeout where useful. Runtime config holds absolute node/claude paths and exact allowed extension origin; no credentials。
- CLI request id max 128 chars、model `/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/`、system max 8192 chars、user max 16384 chars、frame max 128 KiB、CLI stdout/stderr bounded max 256 KiB、response text max 64 KiB。

- [x] Write native tests for fragmented/coalesced framing, oversized/bad JSON, shell metacharacters in prompts, authentication refusal, subscription success, key/env isolation, tool-less flags, malformed/error result, process timeout/disconnect cleanup, concurrency lock, installer ID validation and quoted paths.
- [x] Run `node --test native/tests/*.test.mjs` to see missing implementation fail.
- [x] Implement protocol and host. Validate before spawn; stdout only protocol. Native host permits one active request; reject excess with BUSY. Enforce across native-host instances using an exclusive lock in the app data directory with safe stale-lock recovery. Process cleanup on EOF/signals; timeout 45 seconds; no retry loop.
- [x] Implement runClaude: create allowlisted child env (HOME, USER, LOGNAME, PATH, TMPDIR, LANG/LC values only as needed), strip all provider/auth/config injection envs. Dedicated empty cwd. First call auth status under same isolated flags; require loggedIn + authMethod claude.ai + firstParty. Then `-p --safe-mode --setting-sources '' --tools '' --strict-mcp-config --mcp-config '{"mcpServers":{}}' --disable-slash-commands --no-session-persistence --output-format json --max-turns 1 --model <model> --system-prompt <system>` with user prompt over stdin. Verify required flags against local CLI help. Never use shell:true, bare, permission bypass, API envs, or an automatic fallback model. Parse only successful non-error result. Error messages are safe Japanese guidance, not raw CLI output containing local context. Do not assume usage-cost metadata implies API authentication.
- [x] Implement setup script: `npm run setup:native -- --browser brave --extension-id <id>`; chrome also supported. `--dry-run`, `--uninstall`, optional absolute `--claude-path`. Enforce `/^[a-p]{32}$/`. Register user-level NativeMessagingHosts and app-owned launcher/config under `~/Library/Application Support/UsefulSubtitle`; preserve unrelated files and reject conflicting existing registrations. Absolute exec paths, proper shell quoting, no symlinks into unintended files. `--dry-run` reports proposed paths without writes. No changes to browser Preferences or auth. Test using a temporary HOME without running real Claude.
- [x] Run native tests and report coverage/results. No live Claude request, no installation into user's browser, no build, no git commit.

## Task 2: Extension integration と利用案内

**Files:** Create `src/background/nativeClient.ts`, `tests/nativeClient.test.ts`, `tests/options.test.ts`. Modify `src/shared/types.ts`, `src/background/handler.ts`, `src/background/index.ts`, `src/background/cache.ts`, `src/options/options.ts`, `src/options/options.html`, `manifest.json`, relevant tests, `README.md`.

**Interfaces:**
- AiProvider adds `'claude-subscription'`; legacy/default `'anthropic'` retained to avoid silent account changes. Model remains existing setting (default Haiku 5.5).
- Native client calls `chrome.runtime.connectNative('com.useful_subtitle.claude')`; protocol is Task 1's request/response shape. API key is never part of native messages.
- Handler dispatch selects provider explicitly, with native function separate from existing `callAi` API function. Sender tab id is passed from index as separate optional context, never trusted from content payload.
- Native scheduler takes `{model,system,user,maxTokens?}` and `{kind:'translation'|'interactive',tabId?:number}`. Use one port and one active request; pending translations map per tab (max 8), interactive FIFO max 8. Interactive next before translations. Same active/queued identical requests share result; replaced/rejected requests settle with a typed safe error. Idle disconnect 30 seconds, per request timeout 55 seconds. Drop pending requests for closed/navigated tabs; ignore late responses after disconnect. Rate limit trips a cooldown and stops auto-spam (at least 60 seconds; visible error and explicit test can retry). Never retry with API.

- [x] Write tests for subscription-without-key routing, explicit API missing-key guard, provider cache separation, no apiKey in native payload, same-request dedupe, latest pending caption replacement, interactive priority, queue bounds, failed/malformed replies, timeout/disconnect cleanup, idle close, rate-limit cooldown, tab close/navigation.
- [x] Run focused tests with `npx vitest run tests/nativeClient.test.ts tests/handler.test.ts tests/cache.test.ts tests/settings.test.ts --maxWorkers=1` and observe failures.
- [x] Implement native client and provider routing. Add `nativeMessaging` permission. Validate request types/senders at runtime boundary; service worker itself remains the only native caller. Preserve existing stale-result guards; canceled translations should not show disruptive popup errors. Prevent stale model/provider requests starting after settings changes (disconnect/clear pending).
- [x] Add options provider selector; API key area hidden in subscription mode but stored value preserved. Add short Japanese setup instructions, runtime extension ID and copyable command `npm run setup:native -- --browser brave --extension-id <id>` to run from repo root. Connection test uses selected provider; no API-key requirement for subscription. Explain Pro shared limits, extra usage off for fixed cost, CLI delays and automatic translation toggle. Defaults/feature switches remain as saved. Do not label CLI auth's subscriptionType as definitive plan.
- [x] Test options persistence/provider visibility/ping validation without a real browser. Add README setup/uninstall/troubleshooting, minimum required Claude flags, one-time install + reload and Pro subscription login, no guarantee of translation real time or fixed cost with extra usage enabled. Explain runtime is local but inference remote; API mode remains explicit option.
- [x] Run focused affected tests and `npm run typecheck`; no build or real external calls yet. Report new paths and remaining manual setup steps.

## Final verification / PR

- [x] Independent full-diff review; fix actionable findings and rerun only relevant tests.
- [x] Run one `npm run build`, verify dist provider/manifest matches source.
- [x] Run isolated short subscription ping using host's exported function if feasible; distinguish tool permission/network limitations from app failure, never bypass them. Do not assume CLI Max text proves Pro account billing; document mismatch and any untested browser setup.
- [ ] Inspect all public diff for credentials, personal machine paths, unnecessary personal account metadata. Keep documentation generic; do not publish local auth status or account identity. Commit approved changes and push feature branch. Create Japanese PR with behavior, setup, test evidence and honest outstanding manual checks. No merge.

検証結果: Native 25件、全Vitest 302件、最終修正の対象39件が成功。型チェック・ビルド成功。実推論は実行環境の通信・認証制約で未確認。Brave接続・モデル利用可否・速度は手動確認が必要。
