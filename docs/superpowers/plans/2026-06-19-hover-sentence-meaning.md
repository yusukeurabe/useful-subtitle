# 字幕履歴ホバーで文の意味を表示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 字幕履歴パネルの行に約500msホバーすると、その英文の和訳＋かんたん解説をポップアップ表示する（クリック不要）。

**Architecture:** 履歴パネル（Shadow DOM）内に専用ホバーポップアップを持たせ、意味取得は `onExplain` コールバックで content/index へ委譲。AIは新メッセージ `explainSentence` を1回呼び（`訳:`/`説明:` の2行形式）、既存のキャッシュ機構を再利用する。単語ポップアップ用の既存関数（`parseExplanation`/`buildExplanationPrompt`）は変更しない。

**Tech Stack:** TypeScript / Chrome MV3 / esbuild / Vitest (+ jsdom) / Anthropic Messages API

---

## ファイル構成

- `src/shared/explanation.ts`（追記）— `parseSentenceMeaning`（全文訳を保持）
- `src/shared/prompts.ts`（追記）— `buildSentenceMeaningPrompt`
- `src/shared/types.ts`（修正）— `ExplainSentenceRequest` 型と `RequestMessage` への追加
- `src/shared/messages.ts`（修正）— `sendRequest` オーバーロードに新型を追加
- `src/background/cache.ts`（修正）— `makeCacheKey` に `explainSentence` 分岐
- `src/background/handler.ts`（修正）— `explainSentence` のプロンプト分岐
- `src/content/transcriptPanel.ts`（修正）— ホバー検知＋ポップアップ＋`onExplain`
- `src/content/index.ts`（修正）— `onExplain` を messaging に配線
- 各 `tests/*.test.ts`（追記）

## タスク順序の注意（型の安全な積み増し）

`ExplainSentenceRequest` を `RequestMessage` ユニオンへ加えると、`handler.ts` 既存の
`makeCacheKey(req)` と `buildExplanationPrompt(req.selection, …)` が即座に型エラーになる
（新型に `selection`/`context` が無いため）。よって **ユニオンへの追加・`messages.ts` の
オーバーロード・handler のプロンプト分岐は 1 コミット（Task 4）にまとめて**、各コミットで
`typecheck` が緑のまま進む。先に独立した純粋関数（Task 1〜2）と、`makeCacheKey` 専用の型参照
（Task 3、ユニオン未追加）を済ませる。

---

## Task 1: `parseSentenceMeaning`（全文訳を保持して分解）

**Files:**
- Modify: `src/shared/explanation.ts`
- Test: `tests/explanation.test.ts`

**設計の肝:** 単語用 `parseExplanation` は訳語を「・」正規化・最大3件に丸めるが、文用は**全文訳をそのまま保持**する（読点を含む訳が壊れない）。

- [ ] **Step 1: 失敗するテストを書く**

`tests/explanation.test.ts` 先頭の import を次に変更:

```ts
import { parseExplanation, parseSentenceMeaning } from '../src/shared/explanation';
```

ファイル末尾（最後の `});` の後）に追記:

```ts
describe('parseSentenceMeaning', () => {
  it('splits 訳/説明 into translation and explanation', () => {
    const r = parseSentenceMeaning('訳: ずっと電話しようと思ってた\n説明: have been doing の継続。');
    expect(r.translation).toBe('ずっと電話しようと思ってた');
    expect(r.explanation).toBe('have been doing の継続。');
  });

  it('accepts full-width colons', () => {
    const r = parseSentenceMeaning('訳： こんにちは\n説明： あいさつ');
    expect(r.translation).toBe('こんにちは');
    expect(r.explanation).toBe('あいさつ');
  });

  it('keeps the full translation including 読点 (does not truncate like gloss)', () => {
    const r = parseSentenceMeaning('訳: 彼は、走って、逃げた\n説明: x');
    expect(r.translation).toBe('彼は、走って、逃げた');
  });

  it('keeps multi-line explanation', () => {
    expect(parseSentenceMeaning('訳: a\n説明: 行1\n行2').explanation).toBe('行1\n行2');
  });

  it('uses remainder as explanation when 説明 missing but 訳 present', () => {
    const r = parseSentenceMeaning('訳: 走る\nラベルなしの説明');
    expect(r.translation).toBe('走る');
    expect(r.explanation).toBe('ラベルなしの説明');
  });

  it('falls back to whole text when no labels', () => {
    const r = parseSentenceMeaning('ただの説明文。');
    expect(r.translation).toBe('');
    expect(r.explanation).toBe('ただの説明文。');
  });

  it('returns empty fields for blank input', () => {
    const r = parseSentenceMeaning('   ');
    expect(r.translation).toBe('');
    expect(r.explanation).toBe('');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/explanation.test.ts`
Expected: FAIL（`parseSentenceMeaning is not a function`）。

- [ ] **Step 3: 実装する**

`src/shared/explanation.ts` の末尾に追記:

```ts
/** 文まるごとの意味を「和訳(全文)」と「解説」に分解した結果。 */
export interface SentenceMeaning {
  /** 文全体の日本語訳（丸めず全文を保持）。無ければ ''。 */
  translation: string;
  /** イディオム・文法などの解説。 */
  explanation: string;
}

/**
 * 文用の構造化レスポンス（「訳: …」「説明: …」）を分解する。
 * 単語用 parseExplanation と違い、訳は正規化・件数丸めをせず全文を保持する。
 * ラベルが無い場合は translation='' とし全文を explanation に（安全に劣化）。
 */
export function parseSentenceMeaning(raw: string): SentenceMeaning {
  const text = (raw ?? '').trim();
  if (!text) return { translation: '', explanation: '' };

  const transMatch = text.match(/^訳(?:語)?[ \t]*[:：][ \t]*(.+?)[ \t]*$/m);
  const explMatch = text.match(/^説明[ \t]*[:：]\s*([\s\S]+)$/m);

  const translation = transMatch ? transMatch[1].trim() : '';

  let explanation: string;
  if (explMatch) {
    explanation = explMatch[1].trim();
  } else if (transMatch) {
    explanation = text.replace(transMatch[0], '').trim();
  } else {
    explanation = text;
  }

  return { translation, explanation };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/explanation.test.ts`
Expected: PASS（既存の parseExplanation テストも含め全件）。

- [ ] **Step 5: Commit**

```bash
git add src/shared/explanation.ts tests/explanation.test.ts
git commit -m "feat: 文の意味を訳(全文)と解説へ分解する parseSentenceMeaning を追加"
```

---

## Task 2: `buildSentenceMeaningPrompt`

**Files:**
- Modify: `src/shared/prompts.ts`
- Test: `tests/prompts.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`tests/prompts.test.ts` の import を変更:

```ts
import {
  buildTranslationPrompt,
  buildExplanationPrompt,
  buildSentenceMeaningPrompt,
} from '../src/shared/prompts';
```

末尾に追記:

```ts
describe('buildSentenceMeaningPrompt', () => {
  it('puts the whole sentence into the user message', () => {
    const { user } = buildSentenceMeaningPrompt('I could eat a horse.', 'ja');
    expect(user).toContain('I could eat a horse.');
  });

  it('asks for the structured 訳/説明 format with a full-sentence translation', () => {
    const { system } = buildSentenceMeaningPrompt('x', 'ja');
    expect(system).toContain('訳:');
    expect(system).toContain('説明:');
    expect(system).toMatch(/全文|1文/);
  });

  it('requests a Japanese explanation for "ja" and English for "en"', () => {
    expect(buildSentenceMeaningPrompt('x', 'ja').system).toMatch(/日本語/);
    expect(buildSentenceMeaningPrompt('x', 'en').system).toMatch(/英語|English/i);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/prompts.test.ts`
Expected: FAIL（`buildSentenceMeaningPrompt is not a function`）。

- [ ] **Step 3: 実装する**

`src/shared/prompts.ts` の末尾に追記（`LANGUAGE_LABEL` / `ExplanationLanguage` は既存を再利用）:

```ts
/**
 * 字幕一文（sentence）まるごとの意味を解説するためのプロンプト。
 * 訳は全文の自然な和訳、説明はイディオム・句動詞・文法・ニュアンスを補足する。
 */
export function buildSentenceMeaningPrompt(
  sentence: string,
  language: ExplanationLanguage,
): PromptParts {
  const label = LANGUAGE_LABEL[language];
  return {
    system:
      'あなたは日本語話者の英語学習を助けるチューターです。' +
      '字幕の一文について、次の厳密な2行形式で出力してください（前置き・引用符・装飾は付けない）。\n' +
      '訳: 文全体の自然な日本語訳を1文で。語句に分割せず全文を訳す。\n' +
      `説明: ${label}で、文に含まれるイディオム・句動詞・文法・ニュアンスを簡潔に（2〜4文）。`,
    user: `次の英文の意味を教えてください:\n"${sentence}"`,
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/prompts.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/shared/prompts.ts tests/prompts.test.ts
git commit -m "feat: 文まるごとの意味を問う buildSentenceMeaningPrompt を追加"
```

---

## Task 3: `ExplainSentenceRequest` 型（ユニオン未追加）＋ `makeCacheKey` 分岐

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/background/cache.ts`
- Test: `tests/cache.test.ts`

この段階では型を **`RequestMessage` ユニアンへは入れない**（入れると handler が壊れるため）。
`makeCacheKey` 専用に新型を参照させ、緑を保つ。

- [ ] **Step 1: 失敗するテストを書く**

`tests/cache.test.ts` の `describe('makeCacheKey', …)` 内の末尾に追記:

```ts
  it('differs between explainSentence and the others, prefixed with s', () => {
    const s = makeCacheKey({ type: 'explainSentence', text: 'run' }, model, 'ja');
    const t = makeCacheKey({ type: 'translateLine', text: 'run' }, model, 'ja');
    const e = makeCacheKey(
      { type: 'explainSelection', selection: 'run', context: 'run' },
      model,
      'ja',
    );
    expect(s).not.toBe(t);
    expect(s).not.toBe(e);
    expect(s.startsWith('s')).toBe(true);
  });

  it('explainSentence key differs when the language changes', () => {
    const ja = makeCacheKey({ type: 'explainSentence', text: 'run' }, model, 'ja');
    const en = makeCacheKey({ type: 'explainSentence', text: 'run' }, model, 'en');
    expect(ja).not.toBe(en);
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/cache.test.ts`
Expected: FAIL（現状 explainSentence は 'e' 経路へ落ち `s.startsWith('s')` が false）。

- [ ] **Step 3a: 型を定義（ユニオンには入れない）**

`src/shared/types.ts` の `ExplainSelectionRequest` 定義の直後に追加:

```ts
export interface ExplainSentenceRequest {
  type: 'explainSentence';
  text: string;
}
```

- [ ] **Step 3b: makeCacheKey を実装**

`src/background/cache.ts` の import に `ExplainSentenceRequest` を追加:

```ts
import type {
  ExplainSelectionRequest,
  ExplainSentenceRequest,
  ExplanationLanguage,
  TranslateLineRequest,
} from '../shared/types';
```

`makeCacheKey` を次に置き換え:

```ts
export function makeCacheKey(
  req: TranslateLineRequest | ExplainSelectionRequest | ExplainSentenceRequest,
  model: string,
  language: ExplanationLanguage,
): string {
  if (req.type === 'translateLine') {
    return ['t', model, req.text].join(SEP);
  }
  if (req.type === 'explainSentence') {
    return ['s', model, language, req.text].join(SEP);
  }
  return ['e', model, language, req.selection, req.context].join(SEP);
}
```

- [ ] **Step 4: テストと型チェックが通ることを確認**

Run: `npx vitest run tests/cache.test.ts && npm run typecheck`
Expected: テスト PASS かつ typecheck exit 0（新型はまだ未使用ユニオンだが、エクスポート型のため noUnusedLocals に抵触しない）。

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/background/cache.ts tests/cache.test.ts
git commit -m "feat: explainSentence 型とキャッシュキー(s接頭)を追加"
```

---

## Task 4: 有効化 — ユニオン追加＋ messages＋handler 分岐（1コミットで緑を保つ）

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/messages.ts`
- Modify: `src/background/handler.ts`
- Test: `tests/handler.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`tests/handler.test.ts` の `describe('handleRequest', …)` 内の末尾に追記:

```ts
  it('explainSentence asks the AI about the whole sentence and stores it', async () => {
    let received: AnthropicParams | null = null;
    let stored: [string, string] | null = null;
    const res = await handleRequest(
      { type: 'explainSentence', text: 'I could eat a horse.' },
      deps({
        callAi: async (p: AnthropicParams) => {
          received = p;
          return 'AI_SENTENCE';
        },
        setCached: async (k: string, v: string) => {
          stored = [k, v];
        },
      }),
    );
    expect(res).toEqual({ ok: true, text: 'AI_SENTENCE' });
    expect(received!.user).toContain('I could eat a horse.');
    expect(received!.system).toContain('訳:');
    expect(stored![1]).toBe('AI_SENTENCE');
  });

  it('explainSentence returns the cached value without calling the AI', async () => {
    let aiCalled = false;
    const res = await handleRequest(
      { type: 'explainSentence', text: 'Hello' },
      deps({
        getCached: async () => 'CACHED_S',
        callAi: async () => {
          aiCalled = true;
          return 'x';
        },
      }),
    );
    expect(res).toEqual({ ok: true, text: 'CACHED_S' });
    expect(aiCalled).toBe(false);
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/handler.test.ts`
Expected: FAIL（未実装のため `buildExplanationPrompt` 経由で `received.user` に sentence が入らず "undefined" になる）。

- [ ] **Step 3a: ユニオンに追加**

`src/shared/types.ts` の `RequestMessage` を次に置き換え:

```ts
export type RequestMessage =
  | TranslateLineRequest
  | ExplainSelectionRequest
  | ExplainSentenceRequest
  | PingRequest
  | LookupWordRequest
  | PlayAudioRequest;
```

- [ ] **Step 3b: sendRequest オーバーロードを更新**

`src/shared/messages.ts` の import に `ExplainSentenceRequest` を追加し、`ResponseMessage` を返すオーバーロードを更新:

```ts
import type {
  RequestMessage,
  ResponseMessage,
  TranslateLineRequest,
  ExplainSelectionRequest,
  ExplainSentenceRequest,
  PingRequest,
  LookupWordRequest,
  PlayAudioRequest,
  WordInfoResponse,
  AudioResponse,
  ErrorResponse,
} from './types';
```

```ts
export function sendRequest(
  req: TranslateLineRequest | ExplainSelectionRequest | ExplainSentenceRequest | PingRequest,
): Promise<ResponseMessage>;
```

- [ ] **Step 3c: handler にプロンプト分岐を追加**

`src/background/handler.ts` の import を更新:

```ts
import {
  buildTranslationPrompt,
  buildExplanationPrompt,
  buildSentenceMeaningPrompt,
} from '../shared/prompts';
```

プロンプト生成部（`const prompt = req.type === 'translateLine' ? … : buildExplanationPrompt(…)`）を次に置き換え:

```ts
    const prompt =
      req.type === 'translateLine'
        ? buildTranslationPrompt(req.text)
        : req.type === 'explainSentence'
          ? buildSentenceMeaningPrompt(req.text, settings.explanationLanguage)
          : buildExplanationPrompt(req.selection, req.context, settings.explanationLanguage);
```

（`makeCacheKey(req, …)` は Task 3 の型拡張によりそのまま通る。最終 else は `ExplainSelectionRequest` に絞られ `req.selection` が有効。）

- [ ] **Step 4: テストと型チェックが通ることを確認**

Run: `npx vitest run tests/handler.test.ts && npm run typecheck`
Expected: テスト PASS かつ typecheck exit 0。

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/shared/messages.ts src/background/handler.ts tests/handler.test.ts
git commit -m "feat: explainSentence を有効化（ユニオン/sendRequest/handler 分岐）"
```

---

## Task 5: 履歴パネルにホバーポップアップ

**Files:**
- Modify: `src/content/transcriptPanel.ts`
- Test: `tests/transcriptPanel.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`tests/transcriptPanel.test.ts` の先頭 import を変更:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createTranscriptPanel,
  nextFollowState,
  type TranscriptPanel,
  type TranscriptMeaning,
} from '../src/content/transcriptPanel';
```

ファイル末尾に新しい describe を追記:

```ts
describe('createTranscriptPanel — ホバーで文の意味', () => {
  let panel: TranscriptPanel | null = null;

  beforeEach(() => {
    document.body.replaceChildren();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    panel?.destroy();
    panel = null;
  });

  function rowsOf(): HTMLDivElement[] {
    const host = document.getElementById(HOST_ID);
    return Array.from(host!.shadowRoot!.querySelectorAll<HTMLDivElement>('.row'));
  }
  function popup(): HTMLDivElement | null {
    const host = document.getElementById(HOST_ID);
    return host!.shadowRoot!.querySelector<HTMLDivElement>('.hover-popup');
  }

  it('ドウェル時間が過ぎると onExplain が呼ばれ和訳・解説が出る', async () => {
    const calls: string[] = [];
    panel = createTranscriptPanel({
      onSeek: () => {},
      onExplain: async (s) => {
        calls.push(s);
        return { ok: true, translation: '和訳テキスト', explanation: '解説テキスト' };
      },
    });
    panel.append({ id: 1, english: 'Break a leg!', videoTime: 1 });
    const row = rowsOf()[0];

    row.dispatchEvent(new Event('mouseenter'));
    expect(popup()).toBeNull(); // ドウェル前は出ない
    await vi.advanceTimersByTimeAsync(500);

    expect(calls).toEqual(['Break a leg!']);
    const p = popup();
    expect(p).not.toBeNull();
    expect(p!.textContent).toContain('和訳テキスト');
    expect(p!.textContent).toContain('解説テキスト');
  });

  it('ドウェル前に離れると onExplain は呼ばれない', async () => {
    let called = 0;
    panel = createTranscriptPanel({
      onSeek: () => {},
      onExplain: async () => {
        called++;
        return { ok: true, translation: 'x', explanation: 'y' };
      },
    });
    panel.append({ id: 1, english: 'Hello there', videoTime: 1 });
    const row = rowsOf()[0];

    row.dispatchEvent(new Event('mouseenter'));
    await vi.advanceTimersByTimeAsync(200);
    row.dispatchEvent(new Event('mouseleave'));
    await vi.advanceTimersByTimeAsync(500);

    expect(called).toBe(0);
    expect(popup()).toBeNull();
  });

  it('エラー応答は赤字(.err)で表示する', async () => {
    panel = createTranscriptPanel({
      onSeek: () => {},
      onExplain: async () => ({ ok: false, error: 'APIキーが未設定です。' }),
    });
    panel.append({ id: 1, english: 'X', videoTime: 1 });
    rowsOf()[0].dispatchEvent(new Event('mouseenter'));
    await vi.advanceTimersByTimeAsync(500);

    const p = popup();
    expect(p!.textContent).toContain('APIキーが未設定です。');
    expect(p!.querySelector('.err')).not.toBeNull();
  });

  it('別の行へ移ると古い応答は無視され、最後の行の意味が残る', async () => {
    let resolveFirst: ((v: TranscriptMeaning) => void) | null = null;
    panel = createTranscriptPanel({
      onSeek: () => {},
      onExplain: (s) => {
        if (s === 'first') return new Promise<TranscriptMeaning>((r) => { resolveFirst = r; });
        return Promise.resolve({ ok: true, translation: 'SECOND', explanation: 'second expl' });
      },
    });
    panel.append({ id: 1, english: 'first', videoTime: 1 });
    panel.append({ id: 2, english: 'second', videoTime: 2 });
    const [r1, r2] = rowsOf();

    r1.dispatchEvent(new Event('mouseenter'));
    await vi.advanceTimersByTimeAsync(500); // first 要求中（未解決）
    r1.dispatchEvent(new Event('mouseleave'));
    r2.dispatchEvent(new Event('mouseenter')); // r1 の閉じる猶予をキャンセル
    await vi.advanceTimersByTimeAsync(500); // second 解決→描画

    resolveFirst?.({ ok: true, translation: 'FIRST', explanation: 'first expl' });
    await vi.advanceTimersByTimeAsync(0);

    const p = popup();
    expect(p!.textContent).toContain('SECOND');
    expect(p!.textContent).not.toContain('FIRST');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/transcriptPanel.test.ts`
Expected: FAIL（`TranscriptMeaning` 未エクスポート／`.hover-popup` が生成されない）。

- [ ] **Step 3a: コールバック型を追加**

`src/content/transcriptPanel.ts` の `TranscriptPanelCallbacks` を次に置き換え:

```ts
/** ホバーで取得する文の意味（成功＝和訳＋解説／失敗＝メッセージ）。 */
export type TranscriptMeaning =
  | { ok: true; translation: string; explanation: string }
  | { ok: false; error: string };

export interface TranscriptPanelCallbacks {
  /** 行クリックでその場面へシークする。 */
  onSeek: (videoTime: number) => void;
  /** 行に一定時間ホバーしたとき、その英文の意味（和訳＋解説）を取得する。 */
  onExplain?: (sentence: string) => Promise<TranscriptMeaning>;
}
```

- [ ] **Step 3b: ポップアップCSSを追加**

`STYLES` テンプレートリテラルの末尾（閉じバッククォートの直前、`.reopen { … }` の後）に追記:

```css
.hover-popup {
  position: fixed; max-width: 300px; min-width: 180px;
  background: #1e1e1e; color: #f3f3f3; border: 1px solid #444; border-radius: 10px;
  padding: 10px 12px; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
  font-size: 13px; line-height: 1.6; pointer-events: auto; z-index: 2147483001;
}
.hover-popup .hp-label { font-size: 11px; color: #8ab4ff; font-weight: 700; margin-bottom: 2px; }
.hover-popup .hp-trans { color: #ffe08a; margin-bottom: 4px; white-space: pre-wrap; }
.hover-popup .hp-divider { border-top: 1px solid #3a3a3a; margin: 8px 0; }
.hover-popup .hp-expl { white-space: pre-wrap; }
.hover-popup .hp-body.loading { opacity: 0.7; }
.hover-popup .hp-body.err { color: #ff8a8a; }
```

- [ ] **Step 3c: ホバー状態とヘルパーを追加**

`list.addEventListener('scroll', …)` ブロックの直後・`function append` の直前に挿入:

```ts
  // --- ホバーで文の意味を表示するポップアップ ---
  const DWELL_MS = 500; // 何ms乗せ続けたら出すか
  const CLOSE_GRACE_MS = 200; // 離れてから閉じるまでの猶予
  let hoverPopup: HTMLDivElement | null = null;
  let dwellTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  // 応答の競合ガード。開く/閉じるたびに増やし、古い応答を破棄する。
  let hoverSeq = 0;

  const clearDwell = (): void => {
    if (dwellTimer) {
      clearTimeout(dwellTimer);
      dwellTimer = undefined;
    }
  };
  const clearClose = (): void => {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = undefined;
    }
  };
  const hideHoverPopup = (): void => {
    clearDwell();
    clearClose();
    hoverSeq++; // 進行中の応答を無効化
    if (hoverPopup) {
      hoverPopup.remove();
      hoverPopup = null;
    }
  };
  const scheduleClose = (): void => {
    clearClose();
    closeTimer = setTimeout(hideHoverPopup, CLOSE_GRACE_MS);
  };

  const positionHoverPopup = (row: HTMLElement): void => {
    if (!hoverPopup) return;
    const r = row.getBoundingClientRect();
    const margin = 8;
    const pw = hoverPopup.offsetWidth || 280;
    const ph = hoverPopup.offsetHeight || 0;
    // パネルは右端なのでカードは行の左側へ開く。入らなければ左端にクランプ。
    let left = r.left - pw - margin;
    if (left < margin) left = margin;
    const top = Math.max(margin, Math.min(r.top, window.innerHeight - ph - margin));
    hoverPopup.style.left = `${left}px`;
    hoverPopup.style.top = `${top}px`;
  };

  const renderHoverResult = (res: TranscriptMeaning): void => {
    if (!hoverPopup) return;
    hoverPopup.replaceChildren();
    if (!res.ok) {
      const err = document.createElement('div');
      err.className = 'hp-body err';
      err.textContent = res.error;
      hoverPopup.appendChild(err);
      return;
    }
    if (res.translation) {
      const label = document.createElement('div');
      label.className = 'hp-label';
      label.textContent = '和訳';
      const val = document.createElement('div');
      val.className = 'hp-trans';
      val.textContent = res.translation;
      hoverPopup.append(label, val);
    }
    if (res.explanation) {
      if (res.translation) {
        const divider = document.createElement('div');
        divider.className = 'hp-divider';
        hoverPopup.appendChild(divider);
      }
      const label = document.createElement('div');
      label.className = 'hp-label';
      label.textContent = '解説';
      const val = document.createElement('div');
      val.className = 'hp-expl';
      val.textContent = res.explanation;
      hoverPopup.append(label, val);
    }
  };

  const openHoverPopup = (row: HTMLElement, sentence: string): void => {
    if (!cb.onExplain) return;
    clearClose();
    const seq = ++hoverSeq;
    if (!hoverPopup) {
      hoverPopup = document.createElement('div');
      hoverPopup.className = 'hover-popup';
      hoverPopup.addEventListener('mouseenter', clearClose);
      hoverPopup.addEventListener('mouseleave', scheduleClose);
      shadow.appendChild(hoverPopup);
    }
    hoverPopup.replaceChildren();
    const body = document.createElement('div');
    body.className = 'hp-body loading';
    body.textContent = '考え中…';
    hoverPopup.appendChild(body);
    positionHoverPopup(row);
    void cb.onExplain(sentence).then((res) => {
      if (seq !== hoverSeq || !hoverPopup) return; // 別の行へ移った/閉じた
      renderHoverResult(res);
      positionHoverPopup(row);
    });
  };

  const onHoverKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') hideHoverPopup();
  };
```

- [ ] **Step 3d: 行にホバーリスナーを追加**

`function append` 内の `row.addEventListener('click', () => cb.onSeek(entry.videoTime));` の直後に追記:

```ts
    row.addEventListener('mouseenter', () => {
      clearClose();
      clearDwell();
      dwellTimer = setTimeout(() => openHoverPopup(row, entry.english), DWELL_MS);
    });
    row.addEventListener('mouseleave', () => {
      clearDwell();
      scheduleClose();
    });
```

- [ ] **Step 3e: Escape 登録と後始末を追加**

ファイル下部の次のブロック:

```ts
  function destroy(): void {
    document.removeEventListener('fullscreenchange', onFullscreenChange, true);
    host.remove();
    jaById.clear();
  }

  document.addEventListener('fullscreenchange', onFullscreenChange, true);
  attach();
```

を次に置き換え:

```ts
  function destroy(): void {
    document.removeEventListener('fullscreenchange', onFullscreenChange, true);
    document.removeEventListener('keydown', onHoverKeyDown, true);
    hideHoverPopup();
    host.remove();
    jaById.clear();
  }

  document.addEventListener('fullscreenchange', onFullscreenChange, true);
  document.addEventListener('keydown', onHoverKeyDown, true);
  attach();
```

- [ ] **Step 4: テストと型チェックが通ることを確認**

Run: `npx vitest run tests/transcriptPanel.test.ts && npm run typecheck`
Expected: テスト PASS（既存の追従・z-index・ハイライトも含む）かつ typecheck exit 0。

- [ ] **Step 5: Commit**

```bash
git add src/content/transcriptPanel.ts tests/transcriptPanel.test.ts
git commit -m "feat: 履歴行ホバーで文の意味を出すポップアップを追加"
```

---

## Task 6: content/index に `onExplain` を配線

**Files:**
- Modify: `src/content/index.ts`

ユニットテストは無し（content の結線）。`typecheck` と Task 7 のビルド・手動確認で担保する。

- [ ] **Step 1: import を追加**

`src/content/index.ts` の import 群に追加:

```ts
import { parseSentenceMeaning } from '../shared/explanation';
```

- [ ] **Step 2: パネル生成に onExplain を渡す**

次の生成部:

```ts
  const panel: TranscriptPanel | null = settings.showTranscriptPanel
    ? createTranscriptPanel({ onSeek: seekVideo })
    : null;
```

を次に置き換え:

```ts
  const panel: TranscriptPanel | null = settings.showTranscriptPanel
    ? createTranscriptPanel({
        onSeek: seekVideo,
        onExplain: async (sentence) => {
          const res = await sendRequest({ type: 'explainSentence', text: sentence });
          if (!res.ok) return { ok: false, error: res.error };
          const { translation, explanation } = parseSentenceMeaning(res.text);
          return { ok: true, translation, explanation };
        },
      })
    : null;
```

- [ ] **Step 3: 型チェックが通ることを確認**

Run: `npm run typecheck`
Expected: exit 0。

- [ ] **Step 4: Commit**

```bash
git add src/content/index.ts
git commit -m "feat: 履歴ホバーの意味取得(onExplain)を content に配線"
```

---

## Task 7: 全体検証（typecheck・build・全テスト・手動）

**Files:** なし（検証とコミットのみ）

- [ ] **Step 1: 型チェック**

Run: `npm run typecheck`
Expected: exit 0。

- [ ] **Step 2: 全テスト**

Run: `npm test`
Expected: 全テスト PASS（既存104件＋新規分）。

- [ ] **Step 3: ビルド**

Run: `npm run build`
Expected: エラーなしで `dist/` が生成される。

- [ ] **Step 4: 手動確認（実機）**

この worktree の `dist/` を Chrome に「パッケージ化されていない拡張機能を読み込む」で読み込み、Prime Video で確認:
1. 字幕履歴パネルの行に約500msマウスを乗せ続ける → 行の左側にカードが開き「和訳」「解説」が出る。
2. サッと通り過ぎる → 出ない。
3. カードの上にマウスを移しても消えない。行とカード両方から離れると約200ms後に閉じる。
4. 行クリックは従来どおりその場面へシークする（ホバーが邪魔しない）。
5. 同じ行をもう一度ホバー → 即座に出る（キャッシュ）。
6. APIキー未設定だとカードに赤字でエラーが出る（クラッシュしない）。

※ worktree の `dist/` は普段使いの拡張とは別物。実機確認はこの worktree の `dist/` を読み込むか、main へマージ後に行う。

- [ ] **Step 5: 最終コミット（差分が残っていれば）**

```bash
git add -A
git commit -m "chore: ホバー文意味表示の検証完了" || echo "コミット不要"
```

---

## 完了の定義

- `npm run typecheck` / `npm test` / `npm run build` が成功。
- 履歴行ホバー（約500ms）で和訳＋解説のカードが表示され、クリックのシークは従来どおり。
- 既存テスト（104件）が壊れていない。
- 単語ポップアップ用の `parseExplanation` / `buildExplanationPrompt` は不変。
```
