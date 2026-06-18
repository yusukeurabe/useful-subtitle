# 字幕ポップアップに「発音記号(IPA)・音声再生・Cambridge リンク」 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 字幕クリックで出る意味ポップアップに、その語の発音記号(IPA)・音声再生ボタン・Cambridge(英英)リンクを追加する。

**Architecture:** ポップアップを開いた時点で（単語のとき）無料辞書API `api.dictionaryapi.dev` から IPA と音源URLをまとめて先読みし IPA を表示。音源は MV3 offscreen document（拡張オリジン）で再生して Prime Video のページCSPを回避。音源が無い/フレーズは Web Speech API で読み上げ。辞書取得と offscreen 再生は service worker 側で行い、APIキー不要で処理する。Cambridge リンクは選択語から純関数で即時生成。

**Tech Stack:** TypeScript, esbuild(IIFE), Chrome MV3 (service worker, offscreen, content script, Shadow DOM), Vitest, 無料辞書API(api.dictionaryapi.dev), Web Speech API。

---

## File Structure

- `src/shared/dictionary.ts`（新規）— 純関数: `normalizeWord` / `isSingleWord` / `cambridgeUrl` / `extractWordInfo`、型 `WordInfo`
- `src/shared/types.ts`（変更）— リクエスト/レスポンス型を追加
- `src/shared/messages.ts`（変更）— `sendRequest` オーバーロード
- `src/background/handler.ts`（変更）— `lookupWord`/`playAudio` をAPIキー不要で処理、`HandlerDeps` 拡張
- `src/background/index.ts`（変更）— 実依存（辞書fetch・offscreen制御）配線、`target:'offscreen'` 無視
- `src/offscreen/offscreen.html`・`src/offscreen/index.ts`（新規）— 拡張オリジンで音声再生
- `build.mjs`（変更）— offscreen をビルド/コピー対象に
- `manifest.json`（変更）— `offscreen` 権限と辞書APIホスト追加
- `src/content/overlay.ts`（変更）— ポップアップを「安定ヘッダ＋更新本文」化、IPA行・操作列追加
- `src/content/word.ts`（新規）— 単語の IPA/音源 先読み
- `src/content/audio.ts`（新規）— 🔊 再生（offscreen依頼／TTSフォールバック）
- `src/content/interaction.ts`（変更）— 新 popup API に追従＋ word 先読み起動
- `src/content/index.ts`（変更）— `onPlayAudio` 配線
- `tests/dictionary.test.ts`（新規）・`tests/handler.test.ts`（変更）

---

## Task 1: 共通辞書ユーティリティ（純関数・TDD）

**Files:**
- Create: `src/shared/dictionary.ts`
- Test: `tests/dictionary.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/dictionary.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  normalizeWord,
  isSingleWord,
  cambridgeUrl,
  extractWordInfo,
} from '../src/shared/dictionary';

describe('normalizeWord', () => {
  it('trims and lowercases', () => {
    expect(normalizeWord('  Hello  ')).toBe('hello');
  });
  it('strips surrounding punctuation but keeps inner apostrophe', () => {
    expect(normalizeWord('"don\'t,"')).toBe("don't");
  });
  it('keeps inner hyphen', () => {
    expect(normalizeWord('well-known.')).toBe('well-known');
  });
  it('collapses inner whitespace for phrases', () => {
    expect(normalizeWord('break   a  leg')).toBe('break a leg');
  });
  it('returns empty string for punctuation only', () => {
    expect(normalizeWord('—')).toBe('');
  });
});

describe('isSingleWord', () => {
  it('true for a single word', () => {
    expect(isSingleWord('Resilient')).toBe(true);
  });
  it('true for hyphenated / contraction', () => {
    expect(isSingleWord("don't")).toBe(true);
    expect(isSingleWord('well-known')).toBe(true);
  });
  it('false for a phrase', () => {
    expect(isSingleWord('break a leg')).toBe(false);
  });
  it('false for empty / punctuation', () => {
    expect(isSingleWord('   ')).toBe(false);
    expect(isSingleWord('!!')).toBe(false);
  });
});

describe('cambridgeUrl (english monolingual)', () => {
  it('links directly to the entry for a single word', () => {
    expect(cambridgeUrl('Resilient')).toBe(
      'https://dictionary.cambridge.org/dictionary/english/resilient',
    );
  });
  it('uses the search endpoint for a phrase', () => {
    expect(cambridgeUrl('break a leg')).toBe(
      'https://dictionary.cambridge.org/search/direct/?datasetsearch=english&q=break%20a%20leg',
    );
  });
  it('encodes the query', () => {
    expect(cambridgeUrl("rock 'n' roll")).toContain('q=rock%20');
  });
});

describe('extractWordInfo', () => {
  it('prefers US audio and its IPA', () => {
    const json = [
      {
        phonetic: '/həˈloʊ/',
        phonetics: [
          { text: '/həˈləʊ/', audio: 'https://x/hello-uk.mp3' },
          { text: '/həˈloʊ/', audio: 'https://x/hello-us.mp3' },
        ],
      },
    ];
    expect(extractWordInfo(json)).toEqual({
      ipa: '/həˈloʊ/',
      audioUrl: 'https://x/hello-us.mp3',
    });
  });
  it('falls back to UK audio when no US', () => {
    const json = [{ phonetics: [{ text: '/uk/', audio: 'https://x/w-uk.mp3' }] }];
    expect(extractWordInfo(json)).toEqual({ ipa: '/uk/', audioUrl: 'https://x/w-uk.mp3' });
  });
  it('skips empty audio and uses first non-empty', () => {
    const json = [
      { phonetics: [{ text: '/a/', audio: '' }, { text: '/b/', audio: 'https://x/b.mp3' }] },
    ];
    expect(extractWordInfo(json)).toEqual({ ipa: '/b/', audioUrl: 'https://x/b.mp3' });
  });
  it('uses top-level phonetic when chosen audio entry has no text', () => {
    const json = [{ phonetic: '/top/', phonetics: [{ text: '', audio: 'https://x/x-us.mp3' }] }];
    expect(extractWordInfo(json)).toEqual({ ipa: '/top/', audioUrl: 'https://x/x-us.mp3' });
  });
  it('returns ipa with null audio when only text exists', () => {
    const json = [{ phonetics: [{ text: '/only/' }] }];
    expect(extractWordInfo(json)).toEqual({ ipa: '/only/', audioUrl: null });
  });
  it('returns nulls for empty / invalid json', () => {
    expect(extractWordInfo([])).toEqual({ ipa: null, audioUrl: null });
    expect(extractWordInfo(null)).toEqual({ ipa: null, audioUrl: null });
    expect(extractWordInfo({})).toEqual({ ipa: null, audioUrl: null });
    expect(extractWordInfo([{ title: 'No Definitions Found' }])).toEqual({
      ipa: null,
      audioUrl: null,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- dictionary`
Expected: FAIL（`Cannot find module '../src/shared/dictionary'` または各関数 undefined）

- [ ] **Step 3: Write the implementation**

Create `src/shared/dictionary.ts`:

```ts
/** 辞書から得る単語情報（発音記号と音源URL）。 */
export interface WordInfo {
  ipa: string | null;
  audioUrl: string | null;
}

// 許可する語の構成文字（英字・数字・内部アポストロフィ・ハイフン）。
const KEEP = "A-Za-z0-9'’\\-";

/**
 * 選択文字列を辞書照合・URL生成用に正規化する。
 * 前後の空白/記号を除去、連続空白を1つに、内部の `'`/`-` は保持、小文字化。
 */
export function normalizeWord(selection: string): string {
  return selection
    .trim()
    .replace(/\s+/g, ' ')
    .replace(new RegExp(`^[^${KEEP}]+`), '')
    .replace(new RegExp(`[^${KEEP}]+$`), '')
    .toLowerCase();
}

/** 正規化後に内部空白が無く、空でなければ「単語」とみなす。 */
export function isSingleWord(selection: string): boolean {
  const w = normalizeWord(selection);
  return w.length > 0 && !/\s/.test(w);
}

const CAMBRIDGE = 'https://dictionary.cambridge.org';

/** Cambridge（英英）の URL。単語は直接ページ、フレーズは検索エンドポイント。 */
export function cambridgeUrl(selection: string): string {
  const norm = normalizeWord(selection);
  if (isSingleWord(selection)) {
    return `${CAMBRIDGE}/dictionary/english/${encodeURIComponent(norm)}`;
  }
  return `${CAMBRIDGE}/search/direct/?datasetsearch=english&q=${encodeURIComponent(norm)}`;
}

interface RawPhonetic {
  text?: unknown;
  audio?: unknown;
}
interface RawEntry {
  phonetic?: unknown;
  phonetics?: unknown;
}

/**
 * 無料辞書API（api.dictionaryapi.dev）の応答から IPA と音源URLを取り出す。
 * 音源は US → UK → 最初の非空 の優先。IPA は選んだ音源の text → 最初の text → 代表 phonetic。
 * 不正/空入力でも例外を投げず {null,null}。
 */
export function extractWordInfo(json: unknown): WordInfo {
  const entries: RawEntry[] = Array.isArray(json) ? (json as RawEntry[]) : [];
  const phonetics: RawPhonetic[] = entries.flatMap((e) =>
    Array.isArray(e?.phonetics) ? (e.phonetics as RawPhonetic[]) : [],
  );

  const audios = phonetics.filter(
    (p): p is RawPhonetic & { audio: string } =>
      typeof p?.audio === 'string' && p.audio.length > 0,
  );
  const chosen =
    audios.find((p) => /-us\.\w+(\?.*)?$/i.test(p.audio)) ??
    audios.find((p) => /-uk\.\w+(\?.*)?$/i.test(p.audio)) ??
    audios[0] ??
    null;
  const audioUrl = chosen ? chosen.audio : null;

  const textOf = (p: RawPhonetic | null): string | null =>
    p && typeof p.text === 'string' && p.text.length > 0 ? p.text : null;
  const firstText = phonetics.map(textOf).find((t): t is string => t !== null) ?? null;
  const topPhonetic =
    entries
      .map((e) => (typeof e?.phonetic === 'string' && e.phonetic.length > 0 ? e.phonetic : null))
      .find((t): t is string => t !== null) ?? null;
  const ipa = textOf(chosen) ?? firstText ?? topPhonetic ?? null;

  return { ipa, audioUrl };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- dictionary`
Expected: PASS（全 describe グリーン）

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 6: Commit**

```bash
git add src/shared/dictionary.ts tests/dictionary.test.ts
git commit -m "feat: 辞書ユーティリティ（正規化/Cambridge URL/IPA・音源抽出）を追加"
```

---

## Task 2: メッセージ型とオーバーロード

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/messages.ts`

- [ ] **Step 1: 型を追加（types.ts）**

`src/shared/types.ts` の `ExplainSelectionRequest`（既存）の下に追加し、`RequestMessage` を差し替える:

```ts
export interface LookupWordRequest {
  type: 'lookupWord';
  text: string;
}
export interface PlayAudioRequest {
  type: 'playAudio';
  url: string;
}
```

`RequestMessage` を次に差し替え:

```ts
export type RequestMessage =
  | TranslateLineRequest
  | ExplainSelectionRequest
  | PingRequest
  | LookupWordRequest
  | PlayAudioRequest;
```

ファイル末尾（`ResponseMessage` 定義の後）に追加:

```ts
/** lookupWord の応答（APIキー不要）。発音記号と音源URL。 */
export interface WordInfoResponse {
  ok: true;
  kind: 'word';
  ipa: string | null;
  audioUrl: string | null;
}
/** playAudio の応答。played:true=offscreen でネイティブ音源を再生開始。 */
export interface AudioResponse {
  ok: true;
  kind: 'audio';
  played: boolean;
}
```

- [ ] **Step 2: オーバーロードを追加（messages.ts）**

`src/shared/messages.ts` を全置換:

```ts
import type {
  RequestMessage,
  ResponseMessage,
  TranslateLineRequest,
  ExplainSelectionRequest,
  PingRequest,
  LookupWordRequest,
  PlayAudioRequest,
  WordInfoResponse,
  AudioResponse,
  ErrorResponse,
} from './types';

/**
 * content script / options ページから service worker へリクエストを送り、
 * 型付きのレスポンスを受け取る。送信自体の失敗も ErrorResponse に正規化する。
 */
export function sendRequest(req: LookupWordRequest): Promise<WordInfoResponse | ErrorResponse>;
export function sendRequest(req: PlayAudioRequest): Promise<AudioResponse | ErrorResponse>;
export function sendRequest(
  req: TranslateLineRequest | ExplainSelectionRequest | PingRequest,
): Promise<ResponseMessage>;
export async function sendRequest(
  req: RequestMessage,
): Promise<ResponseMessage | WordInfoResponse | AudioResponse> {
  try {
    return (await chrome.runtime.sendMessage(req)) as
      | ResponseMessage
      | WordInfoResponse
      | AudioResponse;
  } catch (e) {
    return {
      ok: false,
      code: 'UNKNOWN',
      error: (e as Error)?.message ?? 'メッセージの送信に失敗しました',
    };
  }
}
```

- [ ] **Step 3: Typecheck & tests**

Run: `npm run typecheck && npm test`
Expected: いずれもグリーン（挙動変更なし・既存呼び出しの型は維持）

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts src/shared/messages.ts
git commit -m "feat: lookupWord/playAudio のメッセージ型と sendRequest オーバーロードを追加"
```

---

## Task 3: service worker 側の処理（APIキー不要）

**Files:**
- Modify: `src/background/handler.ts`
- Modify: `src/background/index.ts`
- Test: `tests/handler.test.ts`

- [ ] **Step 1: ハンドラのテストを追加（失敗確認用）**

`tests/handler.test.ts` の `deps()` を次に差し替え（新依存の既定を追加）:

```ts
function deps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    getSettings: async () => ({ ...DEFAULT_SETTINGS, apiKey: 'sk-ant' }),
    getCached: async () => undefined,
    setCached: async () => {},
    callAi: async () => 'AI_RESULT',
    getWordInfo: async () => ({ ipa: null, audioUrl: null }),
    playOffscreenAudio: async () => {},
    ...overrides,
  };
}
```

`describe('handleRequest', ...)` の末尾（最後の `it` の後）に追加:

```ts
  it('handles lookupWord without an API key and returns word info', async () => {
    const res = await handleRequest(
      { type: 'lookupWord', text: 'resilient' },
      deps({
        getSettings: async () => DEFAULT_SETTINGS, // キーなし
        getWordInfo: async () => ({ ipa: '/rɪˈzɪliənt/', audioUrl: 'https://x/r-us.mp3' }),
      }),
    );
    expect(res).toEqual({
      ok: true,
      kind: 'word',
      ipa: '/rɪˈzɪliənt/',
      audioUrl: 'https://x/r-us.mp3',
    });
  });

  it('lookupWord returns nulls for a phrase without calling getWordInfo', async () => {
    let called = false;
    const res = await handleRequest(
      { type: 'lookupWord', text: 'break a leg' },
      deps({
        getWordInfo: async () => {
          called = true;
          return { ipa: 'x', audioUrl: 'y' };
        },
      }),
    );
    expect(res).toEqual({ ok: true, kind: 'word', ipa: null, audioUrl: null });
    expect(called).toBe(false);
  });

  it('playAudio plays via offscreen and reports played=true (no API key needed)', async () => {
    let playedUrl = '';
    const res = await handleRequest(
      { type: 'playAudio', url: 'https://x/a.mp3' },
      deps({
        getSettings: async () => DEFAULT_SETTINGS, // キーなし
        playOffscreenAudio: async (u: string) => {
          playedUrl = u;
        },
      }),
    );
    expect(res).toEqual({ ok: true, kind: 'audio', played: true });
    expect(playedUrl).toBe('https://x/a.mp3');
  });

  it('playAudio with empty url reports played=false', async () => {
    let called = false;
    const res = await handleRequest(
      { type: 'playAudio', url: '' },
      deps({
        playOffscreenAudio: async () => {
          called = true;
        },
      }),
    );
    expect(res).toEqual({ ok: true, kind: 'audio', played: false });
    expect(called).toBe(false);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- handler`
Expected: FAIL（`getWordInfo`/`playOffscreenAudio` 不在で型/実行エラー、新 it が未対応）

- [ ] **Step 3: ハンドラを実装（handler.ts）**

`src/background/handler.ts` の import 群に追加:

```ts
import { normalizeWord, isSingleWord, type WordInfo } from '../shared/dictionary';
```

`import type { RequestMessage, ResponseMessage, Settings } from '../shared/types';` を次に差し替え:

```ts
import type {
  RequestMessage,
  ResponseMessage,
  WordInfoResponse,
  AudioResponse,
  Settings,
} from '../shared/types';
```

`HandlerDeps` に2つ追加:

```ts
export interface HandlerDeps {
  getSettings: () => Promise<Settings>;
  getCached: (key: string) => Promise<string | undefined>;
  setCached: (key: string, value: string) => Promise<void>;
  callAi: (params: AnthropicParams) => Promise<string>;
  /** 単語の発音情報（IPA＋音源URL）を取得する（辞書API）。 */
  getWordInfo: (word: string) => Promise<WordInfo>;
  /** 音源URLを offscreen で再生する。 */
  playOffscreenAudio: (url: string) => Promise<void>;
}
```

`handleRequest` のシグネチャと先頭を差し替え（`const settings = await deps.getSettings();` の直前に分岐を挿入）:

```ts
export async function handleRequest(
  req: RequestMessage,
  deps: HandlerDeps,
): Promise<ResponseMessage | WordInfoResponse | AudioResponse> {
  // 辞書情報・音声再生は APIキー不要。最初に分岐する。
  if (req.type === 'lookupWord') {
    if (!isSingleWord(req.text)) {
      return { ok: true, kind: 'word', ipa: null, audioUrl: null };
    }
    try {
      const info = await deps.getWordInfo(normalizeWord(req.text));
      return { ok: true, kind: 'word', ipa: info.ipa, audioUrl: info.audioUrl };
    } catch {
      return { ok: true, kind: 'word', ipa: null, audioUrl: null };
    }
  }
  if (req.type === 'playAudio') {
    if (!req.url) return { ok: true, kind: 'audio', played: false };
    try {
      await deps.playOffscreenAudio(req.url);
      return { ok: true, kind: 'audio', played: true };
    } catch {
      return { ok: true, kind: 'audio', played: false };
    }
  }

  const settings = await deps.getSettings();
```

（以降の既存コードはそのまま。`makeCacheKey(req, ...)` 到達時点で req は translateLine|explainSelection に絞り込まれるため型は通る。）

- [ ] **Step 4: 実依存を配線（index.ts）**

`src/background/index.ts` を全置換:

```ts
import { handleRequest, type HandlerDeps } from './handler';
import { getCached, setCached } from './cache';
import { callAnthropic } from './aiClient';
import { getSettings } from '../shared/settings';
import { extractWordInfo, type WordInfo } from '../shared/dictionary';
import type { RequestMessage } from '../shared/types';

const DICT_API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';

/** 無料辞書APIから単語の IPA＋音源URLを取得する。失敗時は {null,null}。 */
async function getWordInfo(word: string): Promise<WordInfo> {
  const res = await fetch(`${DICT_API}${encodeURIComponent(word)}`);
  if (!res.ok) return { ipa: null, audioUrl: null };
  const json = (await res.json().catch(() => null)) as unknown;
  return extractWordInfo(json);
}

// offscreen ドキュメントは1つだけ生成可。生成を直列化し、既存ならエラーを無視。
let offscreenReady: Promise<void> | null = null;
async function ensureOffscreen(): Promise<void> {
  if (!offscreenReady) {
    offscreenReady = chrome.offscreen
      .createDocument({
        url: 'offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: '単語の発音音声を再生するため',
      })
      .catch((e: unknown) => {
        // 既に存在していれば成功扱い。それ以外は次回再試行できるよう reset して再throw。
        if (!String(e).toLowerCase().includes('single offscreen')) {
          offscreenReady = null;
          throw e;
        }
      });
  }
  await offscreenReady;
}

/** offscreen に音源URLを渡して再生させる。 */
async function playOffscreenAudio(url: string): Promise<void> {
  await ensureOffscreen();
  await chrome.runtime.sendMessage({ target: 'offscreen', url });
}

const deps: HandlerDeps = {
  getSettings,
  getCached,
  setCached,
  callAi: callAnthropic,
  getWordInfo,
  playOffscreenAudio,
};

chrome.runtime.onMessage.addListener(
  (message: RequestMessage & { target?: string }, _sender, sendResponse) => {
    // offscreen 宛のメッセージは background では扱わない。
    if (message?.target === 'offscreen') return;
    handleRequest(message, deps).then(sendResponse);
    // 非同期で sendResponse を呼ぶためチャンネルを開いたままにする。
    return true;
  },
);

// ツールバーアイコンのクリックで設定画面を開く。
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
```

- [ ] **Step 5: Run tests & typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS / エラーなし

- [ ] **Step 6: Commit**

```bash
git add src/background/handler.ts src/background/index.ts tests/handler.test.ts
git commit -m "feat: lookupWord/playAudio を APIキー不要で処理（辞書取得・offscreen再生の配線）"
```

---

## Task 4: offscreen ドキュメント＋ビルド/マニフェスト配線

**Files:**
- Create: `src/offscreen/offscreen.html`
- Create: `src/offscreen/index.ts`
- Modify: `build.mjs`
- Modify: `manifest.json`

- [ ] **Step 1: offscreen の HTML を作成**

Create `src/offscreen/offscreen.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
  </head>
  <body>
    <script src="offscreen.js"></script>
  </body>
</html>
```

- [ ] **Step 2: offscreen のスクリプトを作成**

Create `src/offscreen/index.ts`:

```ts
// offscreen document: 拡張オリジンで音声を再生し、ページ(CSP)の影響を受けない。
interface OffscreenPlayMessage {
  target: 'offscreen';
  url: string;
}

function isPlayMessage(m: unknown): m is OffscreenPlayMessage {
  return (
    typeof m === 'object' &&
    m !== null &&
    (m as { target?: unknown }).target === 'offscreen' &&
    typeof (m as { url?: unknown }).url === 'string'
  );
}

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (!isPlayMessage(message)) return;
  const audio = new Audio(message.url);
  void audio.play().catch((e) => {
    console.warn('[Useful Subtitle] offscreen 再生に失敗', e);
  });
});
```

- [ ] **Step 3: ビルド対象に追加（build.mjs）**

`build.mjs` の `entryPoints` を差し替え:

```js
const entryPoints = {
  content: resolve(root, 'src/content/index.ts'),
  background: resolve(root, 'src/background/index.ts'),
  options: resolve(root, 'src/options/options.ts'),
  offscreen: resolve(root, 'src/offscreen/index.ts'),
};
```

`copyStatic()` 内、options.html のコピーの後に追加:

```js
  await copyFile(
    resolve(root, 'src/offscreen/offscreen.html'),
    resolve(outdir, 'offscreen.html'),
  );
```

- [ ] **Step 4: 権限を追加（manifest.json）**

`manifest.json` の `permissions` と `host_permissions` を差し替え:

```json
  "permissions": ["storage", "offscreen"],
  "host_permissions": [
    "https://api.anthropic.com/*",
    "https://api.dictionaryapi.dev/*"
  ],
```

- [ ] **Step 5: ビルド確認**

Run: `npm run build`
Expected: 成功。`dist/offscreen.js` と `dist/offscreen.html` が生成される。

確認: `ls dist/offscreen.js dist/offscreen.html`
Expected: 両方存在

- [ ] **Step 6: Commit**

```bash
git add src/offscreen/offscreen.html src/offscreen/index.ts build.mjs manifest.json
git commit -m "feat: offscreen で音声再生（ビルド・権限・offscreen文書を追加）"
```

---

## Task 5: content 層（IPA表示・🔊・Cambridge リンク）

**Files:**
- Modify: `src/content/overlay.ts`
- Create: `src/content/word.ts`
- Create: `src/content/audio.ts`
- Modify: `src/content/interaction.ts`
- Modify: `src/content/index.ts`

> 注: この層は相互依存（overlay の新APIに word/interaction/index が依存）するため1タスクにまとめ、最後にまとめて typecheck/build する。

- [ ] **Step 1: overlay.ts — import 追加**

`src/content/overlay.ts` 1行目の下に追加:

```ts
import { cambridgeUrl } from '../shared/dictionary';
```

- [ ] **Step 2: overlay.ts — OverlayCallbacks に onPlayAudio 追加**

既存:

```ts
export interface OverlayCallbacks {
  /** 単語クリック or フレーズ選択が確定したとき。anchor は対象語のビューポート座標。 */
  onLookup: (selection: string, sentence: string, anchor: DOMRect) => void;
}
```

を差し替え:

```ts
export interface OverlayCallbacks {
  /** 単語クリック or フレーズ選択が確定したとき。anchor は対象語のビューポート座標。 */
  onLookup: (selection: string, sentence: string, anchor: DOMRect) => void;
  /** ポップアップの🔊が押されたとき。audioUrl は先読み済みネイティブ音源（無ければ null）。 */
  onPlayAudio: (selection: string, audioUrl: string | null) => void;
}
```

- [ ] **Step 3: overlay.ts — Overlay インターフェースの popup メソッドを差し替え**

既存:

```ts
  showPopupLoading(anchor: DOMRect, selection: string): void;
  showPopupResult(anchor: DOMRect, selection: string, text: string): void;
  showPopupError(anchor: DOMRect, message: string): void;
  hidePopup(): void;
```

を差し替え:

```ts
  openPopup(anchor: DOMRect, selection: string): void;
  setPopupMeaning(text: string): void;
  setPopupError(message: string): void;
  setPopupWordInfo(ipa: string | null, audioUrl: string | null): void;
  hidePopup(): void;
```

- [ ] **Step 4: overlay.ts — CSS を追加**

`STYLES` 内、`.popup .close { ... }` ブロックの直後（`.pos-controls` の前）に追加:

```css
.popup .ipa {
  color: #b9c4d6; font-size: 13px; margin: 0 0 8px;
  font-family: "SF Mono", Menlo, Consolas, monospace;
}
.popup .actions { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
.popup .act-btn {
  border: 1px solid #3a3a3a; background: #2a2a2a; color: #f3f3f3;
  border-radius: 6px; padding: 4px 10px; font-size: 13px; cursor: pointer;
  font-family: inherit; line-height: 1.2;
}
.popup .act-btn:hover { background: #3a3a3a; }
.popup .act-btn:active { background: #4a4a4a; }
.popup .act-link {
  color: #8ab4ff; text-decoration: none; font-size: 13px; line-height: 1.2;
  border: 1px solid #2f3b52; border-radius: 6px; padding: 4px 10px;
}
.popup .act-link:hover { background: rgba(86, 156, 255, 0.15); }
```

- [ ] **Step 5: overlay.ts — popup の状態・関数を差し替え**

既存の popup 状態宣言:

```ts
  let popup: HTMLDivElement | null = null;
  let currentSentence = '';
  let wordRefs: WordRef[] = [];
```

を差し替え（currentSentence と wordRefs は残し、popup 周りを拡張）:

```ts
  let popup: HTMLDivElement | null = null;
  let popupBody: HTMLDivElement | null = null;
  let popupIpa: HTMLDivElement | null = null;
  let popupAnchor: DOMRect | null = null;
  let popupSelection = '';
  let popupAudioUrl: string | null = null;
  let currentSentence = '';
  let wordRefs: WordRef[] = [];
```

次に、既存の `ensurePopup` / `buildPopupShell` / `positionPopup` / `showPopupLoading` / `showPopupResult` / `showPopupError` / `hidePopup`（おおよそ「const ensurePopup = …」から「function hidePopup() { … }」まで）を、以下で全置換:

```ts
  const ensurePopup = (): HTMLDivElement => {
    if (popup) return popup;
    popup = document.createElement('div');
    popup.className = 'popup';
    shadow.appendChild(popup);
    return popup;
  };

  const positionPopup = (anchor: DOMRect): void => {
    if (!popup) return;
    const margin = 8;
    const pw = popup.offsetWidth;
    const ph = popup.offsetHeight;
    let left = anchor.left + anchor.width / 2 - pw / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - pw - margin));
    let top = anchor.top - ph - margin;
    if (top < margin) top = anchor.bottom + margin;
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  };

  // ヘッダ（×・選択語・IPA・操作列）は安定して残り、本文だけ「考え中…」→結果/エラーへ更新する。
  function openPopup(anchor: DOMRect, selection: string): void {
    const p = ensurePopup();
    p.replaceChildren();
    popupAnchor = anchor;
    popupSelection = selection;
    popupAudioUrl = null;

    const close = document.createElement('div');
    close.className = 'close';
    close.textContent = '×';
    close.addEventListener('click', hidePopup);
    p.appendChild(close);

    const sel = document.createElement('div');
    sel.className = 'sel';
    sel.textContent = selection;
    p.appendChild(sel);

    popupIpa = document.createElement('div');
    popupIpa.className = 'ipa';
    popupIpa.style.display = 'none';
    p.appendChild(popupIpa);

    const actions = document.createElement('div');
    actions.className = 'actions';

    const audioBtn = document.createElement('button');
    audioBtn.className = 'act-btn';
    audioBtn.textContent = '🔊 発音';
    audioBtn.title = '発音を再生';
    audioBtn.addEventListener('click', () => callbacks.onPlayAudio(popupSelection, popupAudioUrl));
    actions.appendChild(audioBtn);

    const link = document.createElement('a');
    link.className = 'act-link';
    link.textContent = 'Cambridge ↗';
    link.title = 'Cambridge 英英辞典で開く';
    link.href = cambridgeUrl(selection);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    actions.appendChild(link);

    p.appendChild(actions);

    popupBody = document.createElement('div');
    popupBody.className = 'body loading';
    popupBody.textContent = '考え中…';
    p.appendChild(popupBody);

    positionPopup(anchor);
  }

  function setPopupMeaning(text: string): void {
    if (!popupBody) return;
    popupBody.className = 'body';
    popupBody.textContent = text;
    if (popupAnchor) positionPopup(popupAnchor);
  }

  function setPopupError(message: string): void {
    if (!popupBody) return;
    popupBody.className = 'body err';
    popupBody.textContent = message;
    if (popupAnchor) positionPopup(popupAnchor);
  }

  function setPopupWordInfo(ipa: string | null, audioUrl: string | null): void {
    popupAudioUrl = audioUrl;
    if (!popupIpa) return;
    if (ipa) {
      popupIpa.textContent = ipa;
      popupIpa.style.display = '';
    } else {
      popupIpa.textContent = '';
      popupIpa.style.display = 'none';
    }
    if (popupAnchor) positionPopup(popupAnchor);
  }

  function hidePopup(): void {
    if (popup) {
      popup.remove();
      popup = null;
    }
    popupBody = null;
    popupIpa = null;
    popupAnchor = null;
    popupAudioUrl = null;
    clearHighlight();
  }
```

- [ ] **Step 6: overlay.ts — renderLine と return の整合**

`renderLine` 内の `hidePopup();` 呼び出しはそのまま（popup を閉じる）。
ファイル末尾の return オブジェクトの popup メソッド名を差し替え:

既存:

```ts
  return {
    renderLine,
    clearLine,
    setTranslation,
    showPopupLoading,
    showPopupResult,
    showPopupError,
    hidePopup,
    destroy,
  };
```

を差し替え:

```ts
  return {
    renderLine,
    clearLine,
    setTranslation,
    openPopup,
    setPopupMeaning,
    setPopupError,
    setPopupWordInfo,
    hidePopup,
    destroy,
  };
```

- [ ] **Step 7: content/word.ts を作成**

Create `src/content/word.ts`:

```ts
import type { Overlay } from './overlay';
import { isSingleWord } from '../shared/dictionary';
import { sendRequest } from '../shared/messages';

/**
 * 単語のとき辞書情報（IPA＋音源URL）を取得し、ポップアップに反映する。
 * フレーズ・取得失敗時は IPA なし／音源なしとして扱う（🔊 は TTS にフォールバック）。
 */
export async function loadWordInfo(overlay: Overlay, selection: string): Promise<void> {
  if (!isSingleWord(selection)) {
    overlay.setPopupWordInfo(null, null);
    return;
  }
  const res = await sendRequest({ type: 'lookupWord', text: selection });
  if (res.ok && res.kind === 'word') {
    overlay.setPopupWordInfo(res.ipa, res.audioUrl);
  } else {
    overlay.setPopupWordInfo(null, null);
  }
}
```

- [ ] **Step 8: content/audio.ts を作成**

Create `src/content/audio.ts`:

```ts
import { sendRequest } from '../shared/messages';

/**
 * 🔊 の再生。先読み済み音源URLがあれば offscreen でネイティブ音源を再生。
 * 無い／再生不可なら Web Speech API で読み上げる。
 */
export async function playPronunciation(
  selection: string,
  audioUrl: string | null,
): Promise<void> {
  if (audioUrl) {
    const res = await sendRequest({ type: 'playAudio', url: audioUrl });
    if (res.ok && res.kind === 'audio' && res.played) return;
  }
  speak(selection);
}

/** ブラウザ内蔵の読み上げ。非対応環境では静かに何もしない。 */
function speak(text: string): void {
  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
  try {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    const enVoice = synth.getVoices().find((v) => v.lang.startsWith('en'));
    if (enVoice) u.voice = enVoice;
    synth.speak(u);
  } catch {
    // 読み上げ非対応・失敗時は何もしない。
  }
}
```

- [ ] **Step 9: interaction.ts を更新**

`src/content/interaction.ts` を全置換:

```ts
import type { Overlay } from './overlay';
import type { Settings } from '../shared/types';
import { pauseVideo } from './videoControl';
import { sendRequest } from '../shared/messages';
import { loadWordInfo } from './word';

/**
 * 単語/フレーズの意味引きを実行する。
 * 自動一時停止 → ポップアップを開く → 発音情報の先読み（並行） → AI 解説の表示。
 */
export async function runLookup(
  overlay: Overlay,
  settings: Settings,
  selection: string,
  sentence: string,
  anchor: DOMRect,
): Promise<void> {
  if (!selection.trim()) return;
  if (settings.autoPauseOnClick) pauseVideo();
  overlay.openPopup(anchor, selection);
  // 発音記号・音源URLの先読み（意味取得と独立・並行）。
  void loadWordInfo(overlay, selection);
  const res = await sendRequest({ type: 'explainSelection', selection, context: sentence });
  if (res.ok) overlay.setPopupMeaning(res.text);
  else overlay.setPopupError(res.error);
}
```

- [ ] **Step 10: index.ts に onPlayAudio を配線**

`src/content/index.ts` の import 群に追加:

```ts
import { playPronunciation } from './audio';
```

`createOverlay(` の第1引数（callbacks）を差し替え:

既存:

```ts
    {
      onLookup: (selection, sentence, anchor) =>
        void runLookup(overlay, settings, selection, sentence, anchor),
    },
```

を差し替え:

```ts
    {
      onLookup: (selection, sentence, anchor) =>
        void runLookup(overlay, settings, selection, sentence, anchor),
      onPlayAudio: (selection, audioUrl) => void playPronunciation(selection, audioUrl),
    },
```

- [ ] **Step 11: Typecheck・build・全テスト**

Run: `npm run typecheck && npm run build && npm test`
Expected: すべてグリーン（`dist/` 再生成、テスト全通過）

- [ ] **Step 12: Commit**

```bash
git add src/content/overlay.ts src/content/word.ts src/content/audio.ts src/content/interaction.ts src/content/index.ts
git commit -m "feat: ポップアップに発音記号(IPA)・🔊発音・Cambridge(英英)リンクを表示"
```

---

## Task 6: 最終検証（自動＋実機）

**Files:** なし（検証のみ）

- [ ] **Step 1: 自動チェック一式**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck エラーなし / 全テスト PASS / build 成功（`dist/offscreen.js`・`dist/offscreen.html` 含む）

- [ ] **Step 2: 拡張を再読み込み**

Chrome の拡張機能ページで `dist/` を「更新」。`offscreen` 権限の追加に伴う再有効化が要る場合は再読み込み。

- [ ] **Step 3: 実機（Prime Video）チェックリスト**

- [ ] 字幕の**単語**をクリック → ポップアップに **IPA（例 `/.../`）** が表示される
- [ ] その **🔊 発音** → ネイティブ音源が鳴る（offscreen 再生・Prime の再生中でも鳴る）
- [ ] **Cambridge ↗** → 英英の該当ページが新規タブで開く（単語は直接ページ）
- [ ] 字幕を**ドラッグして複数語（フレーズ）**選択 → IPA は出ない／🔊 で読み上げ（TTS）／Cambridge は検索結果へ
- [ ] 音源が無さそうな語でも 🔊 で必ず読み上げにフォールバックする
- [ ] 🔊 やリンクをクリックしてもポップアップが**閉じない**、× や外側クリックで閉じる
- [ ] 既存機能（意味解説・デュアル字幕・履歴パネル）が従来どおり動く

- [ ] **Step 4: 必要なら微調整**

実機で位置ずれ・配色・Cambridge 検索URLのパラメータ（`datasetsearch=english` が最適か）を確認し、必要なら該当ファイルを修正して再ビルド・追試。

---

## Self-Review メモ（計画作成者による確認）

- **Spec カバレッジ**: IPA表示=Task5(overlay/word)＋Task3(lookupWord)、音声再生=Task3/4＋Task5(audio)、Cambridge=Task1(cambridgeUrl)＋Task5(overlay)。先読みデータフロー=interaction＋word。offscreen/CSP回避=Task3/4。すべて対応タスクあり。
- **型整合**: `setPopupWordInfo`/`openPopup`/`setPopupMeaning`/`setPopupError` は overlay 定義（Task5 S3/S5）と利用（word/interaction）で一致。`WordInfoResponse.kind='word'`・`AudioResponse.kind='audio'` を content の絞り込みと一致。`HandlerDeps.getWordInfo/playOffscreenAudio` は handler 定義と index 配線・test の deps で一致。
- **プレースホルダ**: なし（Cambridge 検索パラメータの実機確認は Task6 の明示的検証項目）。
