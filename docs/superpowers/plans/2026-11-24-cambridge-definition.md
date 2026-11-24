# 単語ポップアップの英語の意味を Cambridge の原文にする 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1単語の解説で、英語の意味を AI の作文ではなく Cambridge 辞書の定義の原文にする。

**Architecture:** 発音・品詞のために既に読んでいる Cambridge のページから、見出し語の定義を品詞ごとに取り出す。解説のプロンプトに番号付きの候補として渡し、AI は合う定義の番号（`[3]`）だけを書く。バックグラウンドで番号を原文に差し替えてからキャッシュに保存するので、ポップアップ側は変更しない。

**Tech Stack:** TypeScript（Chrome 拡張 MV3）、vitest（jsdom）、esbuild。

## Global Constraints

- 設計書: `docs/superpowers/specs/2026-11-24-cambridge-definition-design.md`
- 対象は1単語の解説（`explainSelection` で `isSingleWord(selection)` が真）だけ。フレーズ・文の解説・字幕翻訳は変えない。
- 出どころ（Cambridge の原文か AI の定義か）は画面で区別しない。`src/content/` は変更しない。
- 1つの品詞につき候補は8個まで。番号は品詞をまたいで 1 から通しで振る。
- 存在しない番号のときは `| [番号]` を取り除き、日本語訳だけ残す。
- 辞書が取れない・2.5 秒を超える場合は候補を渡さず、今までどおり AI の定義を出す。
- `EXPLANATION_PROMPT_VERSION` を `'v5'` から `'v6'` に上げる。
- バージョンは 0.15.1 → 0.16.0（`manifest.json`・`package.json`・`package-lock.json` の先頭2か所）。
- Service Worker では DOMParser を使わず、HTML は文字列のまま走査する（既存の方針）。
- コードのコメントは日本語。コミットメッセージの末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- テストの実行: `npx vitest run <ファイル>`。型チェック: `npx tsc --noEmit`。

---

### Task 1: Cambridge のページから見出し語の定義を取り出す

**Files:**
- Modify: `src/shared/dictionary.ts`
- Test: `tests/dictionary.test.ts`

**Interfaces:**
- Produces:
  - `export interface DefinitionGroup { pos: string; defs: string[] }`（`src/shared/dictionary.ts`）
  - `export function extractCambridgeDefinitions(html: string): DefinitionGroup[]`
  - `WordInfo` に `definitions?: DefinitionGroup[]` を追加（取れたときだけ付く）
  - `extractCambridgeWordInfo(html)` の戻り値に `definitions` が付く

- [ ] **Step 1: 失敗するテストを書く**

`tests/dictionary.test.ts` の import に `extractCambridgeDefinitions` を加え、ファイル末尾に追加する。

```ts
// Cambridge 実ページ（then・run）の構造を縮めたもの。
// 1つ目の見出しは品詞が2つ（adverb, adjective）。2つ目の見出しには成句（then and there）と、
// 末尾に派生語（runon。hw の無い pos-header）がある。
const CAMBRIDGE_DEFS = `
<div class="pr entry-body__el"><div class="pos-header dpos-h"><div class="di-title"><span class="headword hdb tw-bw dhw dpos-h_hw "><span class="hw dhw">then</span></span></div><div class="posgram dpos-g hdib lmr-5"><span class="pos dpos" title="x">adverb</span>, <span class="pos dpos" title="x">adjective</span></div></div>
<div class="pr dsense dsense-noh"><div class="sense-body dsense_b"><div class="def-block ddef_block "><div class="ddef_h"><div class="def ddef_d db">(at) that <a class="query" href="/x">time</a> (in the past or in the future): </div></div></div></div></div></div>
<div class="pr entry-body__el"><div class="pos-header dpos-h"><span class="hw dhw">then</span><span class="pos dpos">adverb</span></div>
<div class="pr dsense "><h3 class="dsense_h"><span class="hw dsense_hw">then</span> <span class="pos dsense_pos">adverb</span></h3><div class="sense-body dsense_b"><div class="def-block ddef_block "><div class="def ddef_d db">next or <a class="query">after</a> that: </div></div>
<div class="pr phrase-block dphrase-block lmb-25"><div class="phrase-head dphrase_h"><span class="phrase-title dphrase-title"><b>then and there</b></span></div><div class="phrase-body dphrase_b"><div class="def-block ddef_block "><div class="def ddef_d db">immediately: </div></div></div></div></div></div>
<div class="pr dsense "><div class="sense-body dsense_b"><div class="def-block ddef_block "><div class="def ddef_d db">in <a>addition</a>: </div></div></div></div>
<span class="runon-head"><span class="w dw">thenly</span></span><div class="pos-header dpos-h"><span class="pos dpos">adverb</span></div><div class="def ddef_d db">a runon definition: </div>
</div>`;

describe('extractCambridgeDefinitions', () => {
  it('見出し語の定義を品詞ごとに取り出し、成句と派生語の定義は除く', () => {
    expect(extractCambridgeDefinitions(CAMBRIDGE_DEFS)).toEqual([
      { pos: 'adverb, adjective', defs: ['(at) that time (in the past or in the future)'] },
      { pos: 'adverb', defs: ['next or after that', 'in addition'] },
    ]);
  });

  it('タグを外し、文字参照を戻し、括弧内の余分な空白と末尾のコロンを取る', () => {
    const html =
      '<div class="pos-header dpos-h"><span class="hw dhw">gauntlet</span><span class="pos dpos">noun</span></div>' +
      '<div class="pr dsense "><div class="def ddef_d db">a long, thick <a>glove</a> ( <a>hand</a> covering), it&#39;s &amp; worn: </div></div>';
    expect(extractCambridgeDefinitions(html)).toEqual([
      { pos: 'noun', defs: ["a long, thick glove (hand covering), it's & worn"] },
    ]);
  });

  it('同じ品詞の重複は省き、1つの品詞につき8個までにする', () => {
    const defs = Array.from({ length: 10 }, (_, i) => `<div class="def ddef_d db">sense ${i}: </div>`).join('');
    const html =
      '<div class="pos-header dpos-h"><span class="hw dhw">run</span><span class="pos dpos">verb</span></div>' +
      `<div class="pr dsense "><div class="def ddef_d db">sense 0: </div>${defs}</div>`;
    const groups = extractCambridgeDefinitions(html);
    expect(groups).toHaveLength(1);
    expect(groups[0].defs).toEqual(['sense 0', 'sense 1', 'sense 2', 'sense 3', 'sense 4', 'sense 5', 'sense 6', 'sense 7']);
  });

  it('定義が無い・空の HTML では空配列', () => {
    expect(extractCambridgeDefinitions('')).toEqual([]);
    expect(extractCambridgeDefinitions('<html>no entry</html>')).toEqual([]);
  });

  it('extractCambridgeWordInfo は定義も返す', () => {
    expect(extractCambridgeWordInfo(CAMBRIDGE_DEFS)).toEqual({
      ipa: null,
      audioUrl: null,
      pos: ['adverb', 'adjective'],
      definitions: [
        { pos: 'adverb, adjective', defs: ['(at) that time (in the past or in the future)'] },
        { pos: 'adverb', defs: ['next or after that', 'in addition'] },
      ],
    });
  });
});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `npx vitest run tests/dictionary.test.ts`
Expected: FAIL（`extractCambridgeDefinitions is not a function` など）

- [ ] **Step 3: 実装する**

`src/shared/dictionary.ts` を次のように変える。

(a) `WordInfo` の定義と `withPos` を置き換える。

```ts
/** Cambridge の見出し語の定義（品詞ごと）。 */
export interface DefinitionGroup {
  /** その見出しの品詞（"adjective"。1つの見出しに品詞が複数あれば "adverb, adjective"）。 */
  pos: string;
  /** 定義の原文（ページに出てくる順・重複なし・最大8個）。 */
  defs: string[];
}

/** 辞書から得る単語情報（発音記号と音源URL、見出し語の品詞と定義）。 */
export interface WordInfo {
  ipa: string | null;
  audioUrl: string | null;
  /** 辞書に載っている見出し語の品詞（"adjective" など英語・出現順・重複なし）。取れなければ省略。 */
  pos?: string[];
  /** Cambridge の見出し語の定義（品詞ごと）。取れなければ省略。 */
  definitions?: DefinitionGroup[];
}

/** 品詞が1つ以上あるときだけ pos を付ける（空配列は持たない）。 */
function withPos(info: WordInfo, pos: string[]): WordInfo {
  return pos.length > 0 ? { ...info, pos } : info;
}

/** 定義が1つ以上あるときだけ definitions を付ける（空配列は持たない）。 */
function withDefinitions(info: WordInfo, definitions: DefinitionGroup[]): WordInfo {
  return definitions.length > 0 ? { ...info, definitions } : info;
}
```

(b) `extractCambridgePartsOfSpeech` の直前に、品詞の span の正規表現を共有の定数として置き、`extractCambridgePartsOfSpeech` の `html.matchAll(...)` をこの定数に替える。

```ts
/** 見出し・派生語の品詞の span（語義ごとの "pos dsense_pos" は含めない）。 */
const POS_SPAN = /<span\s+class="pos\s+dpos"[^>]*>([^<]*)<\/span>/gi;
```

```ts
  for (const m of html.matchAll(POS_SPAN)) {
```

(c) `extractCambridgePartsOfSpeech` の後ろに追加する。

```ts
/** 1つの品詞につき AI に渡す定義の候補の上限。 */
const MAX_DEFINITIONS_PER_POS = 8;

/**
 * Cambridge 英英ページ HTML から見出し語の定義を品詞ごとに取り出す。
 * 品詞の判定は extractCambridgePartsOfSpeech と同じく、pos-header の品詞の前に
 * 見出し語（class="hw"）があるものだけ（派生語 runon の定義は除く）。
 * 成句（phrase-block。then and there など）の定義も除く: 語義（dsense）の始まりより後に
 * 成句が始まっていれば、その定義は成句のもの。
 */
export function extractCambridgeDefinitions(html: string): DefinitionGroup[] {
  if (!html) return [];
  const groups: DefinitionGroup[] = [];
  for (const m of html.matchAll(/<div\s+class="def\s+ddef_d[^"]*"[^>]*>/gi)) {
    const header = html.lastIndexOf('pos-header', m.index);
    if (header < 0) continue;
    if (html.lastIndexOf('phrase-block', m.index) > html.lastIndexOf('dsense', m.index)) continue;
    const pos = headwordPos(html.slice(header, m.index));
    if (!pos) continue;
    const start = m.index + m[0].length;
    const end = html.indexOf('</div>', start);
    if (end < 0) continue;
    const text = cleanDefinition(html.slice(start, end));
    if (!text) continue;
    let group = groups.find((g) => g.pos === pos);
    if (!group) {
      group = { pos, defs: [] };
      groups.push(group);
    }
    if (group.defs.length < MAX_DEFINITIONS_PER_POS && !group.defs.includes(text)) group.defs.push(text);
  }
  return groups;
}

/** pos-header から定義までの範囲で、見出し語の品詞を "adverb, adjective" の形で返す。派生語なら null。 */
function headwordPos(segment: string): string | null {
  const spans = [...segment.matchAll(POS_SPAN)];
  if (spans.length === 0) return null;
  if (!/class="hw[\s"]/.test(segment.slice(0, spans[0].index))) return null;
  return unique(spans.map((s) => s[1])).join(', ') || null;
}

/** 定義の HTML を1行の文にする（タグ・文字参照・余分な空白・末尾のコロンを処理）。 */
function cleanDefinition(raw: string): string {
  return decodeEntities(raw.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s+,/g, ',')
    .trim()
    .replace(/\s*:$/, '')
    .trim();
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** HTML 文字参照（&#39; &#x27; &amp; など）を文字に戻す。知らないものはそのまま残す。 */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    const c = code.toLowerCase();
    if (c.startsWith('#')) {
      const n = c.startsWith('#x') ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    }
    return NAMED_ENTITIES[c] ?? all;
  });
}
```

(d) `extractCambridgeWordInfo` で定義も返す。

```ts
export function extractCambridgeWordInfo(html: string): WordInfo {
  if (!html) return { ipa: null, audioUrl: null };
  try {
    const pos = extractCambridgePartsOfSpeech(html);
    const definitions = extractCambridgeDefinitions(html);
    const extras = (info: WordInfo): WordInfo => withDefinitions(withPos(info, pos), definitions);
    const us = extractSpanContents(html, ['us', 'dpron-i']);
    if (!us) return extras({ ipa: null, audioUrl: null });

    const ipa = extractSpanContents(us, ['ipa', 'dipa'])?.replace(/<[^>]*>/g, '').trim() || null;
    const src = extractCambridgeMp3Src(us);
    const audioUrl = src ? absolutizeCambridgeUrl(src) : null;

    return extras({ ipa, audioUrl });
  } catch {
    return { ipa: null, audioUrl: null };
  }
}
```

関数の説明コメント（「US 発音セクションの IPA と mp3 URL を抽出する」）の後ろに「見出し語の品詞と定義も返す。」を1行足す。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npx vitest run tests/dictionary.test.ts`
Expected: PASS（既存のテストも含めてすべて）

- [ ] **Step 5: コミット**

```bash
git add src/shared/dictionary.ts tests/dictionary.test.ts
git commit -m "feat: Cambridge のページから見出し語の定義を品詞ごとに取り出す

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 単語情報の取得で定義も返す

**Files:**
- Modify: `src/background/wordInfo.ts`
- Test: `tests/wordInfo.test.ts`

**Interfaces:**
- Consumes: `WordInfo.definitions`、`extractCambridgeWordInfo`（Task 1）
- Produces: `createWordInfoFetcher(fetchFn)(word)` の戻り値に、Cambridge から取れたときだけ `definitions` が付く。定義だけ取れた結果もメモリに覚える。

- [ ] **Step 1: 失敗するテストを書く**

`tests/wordInfo.test.ts` の `describe('createWordInfoFetcher', ...)` の最後（閉じ括弧の前）に追加する。

```ts
  it('Cambridge の見出し語の定義を返す（予備APIで補うときも残す）', async () => {
    const html =
      '<div class="pos-header dpos-h"><span class="hw dhw">run</span><span class="pos dpos">verb</span></div>' +
      `<div class="pr dsense "><div class="def ddef_d db">to move fast: </div></div>${CAMBRIDGE_IPA_ONLY}`;
    const f = fetcher(response(html), response(DICT_API_JSON));
    const info = await createWordInfoFetcher(f)('run');
    expect(info.definitions).toEqual([{ pos: 'verb', defs: ['to move fast'] }]);
    expect(info.audioUrl).toBe('https://api.dictionaryapi.dev/media/pronunciations/en/run-us.mp3');
  });

  it('品詞と定義が取れた結果は覚えておく', async () => {
    const html =
      '<div class="pos-header dpos-h"><span class="hw dhw">run</span><span class="pos dpos">verb</span></div>' +
      '<div class="pr dsense "><div class="def ddef_d db">to move fast: </div></div>';
    const f = fetcher(response(html), response([]));
    const get = createWordInfoFetcher(f);
    await get('run');
    const calls = f.mock.calls.length;
    expect((await get('run')).definitions).toEqual([{ pos: 'verb', defs: ['to move fast'] }]);
    expect(f).toHaveBeenCalledTimes(calls);
  });
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `npx vitest run tests/wordInfo.test.ts`
Expected: FAIL（`definitions` が undefined）

- [ ] **Step 3: 実装する**

`src/background/wordInfo.ts` の `lookup` と最後の `return` を次にする。

```ts
  async function lookup(word: string): Promise<WordInfo> {
    const cam = await tryCambridge(word);
    if (cam.ipa && cam.audioUrl) return cam;
    const dict = await tryDictionaryApi(word);
    const info: WordInfo = { ipa: cam.ipa ?? dict.ipa, audioUrl: cam.audioUrl ?? dict.audioUrl };
    const pos = cam.pos ?? dict.pos;
    if (pos) info.pos = pos;
    // 定義の原文は Cambridge だけから取る（予備APIの定義は使わない）。
    if (cam.definitions) info.definitions = cam.definitions;
    return info;
  }
```

`load` の中の保存条件を次にする。

```ts
      if (info.ipa || info.audioUrl || info.pos || info.definitions) {
```

最後の返す関数を次にする。

```ts
  return async (word: string): Promise<WordInfo> => {
    const info = await load(word);
    const result: WordInfo = { ipa: info.ipa ?? IPA_FALLBACK.get(word) ?? null, audioUrl: info.audioUrl };
    if (info.pos) result.pos = info.pos;
    if (info.definitions) result.definitions = info.definitions;
    return result;
  };
```

ファイル冒頭の関数説明「単語の IPA＋音源 URL＋見出し語の品詞を取得する関数を作る」を「単語の IPA＋音源 URL＋見出し語の品詞と定義を取得する関数を作る」に変える。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npx vitest run tests/wordInfo.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/background/wordInfo.ts tests/wordInfo.test.ts
git commit -m "feat: 単語情報の取得で Cambridge の定義も返す

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 定義の番号付けと、応答の番号を原文に差し替える処理

**Files:**
- Create: `src/shared/definitionRefs.ts`
- Test: `tests/definitionRefs.test.ts`

**Interfaces:**
- Consumes: `DefinitionGroup`（Task 1）
- Produces:
  - `export interface NumberedDefinition { n: number; pos: string; text: string }`
  - `export function numberDefinitions(groups: DefinitionGroup[] | undefined): NumberedDefinition[]`
  - `export function resolveDefinitionRefs(raw: string, candidates: NumberedDefinition[]): string`

- [ ] **Step 1: 失敗するテストを書く**

`tests/definitionRefs.test.ts` を作る。

```ts
import { describe, it, expect } from 'vitest';
import { numberDefinitions, resolveDefinitionRefs } from '../src/shared/definitionRefs';

const GROUPS = [
  { pos: 'adjective', defs: ['in a series of amounts', 'happening gradually, in a series of small amounts'] },
  { pos: 'noun', defs: ['an amount added'] },
];

describe('numberDefinitions', () => {
  it('品詞をまたいで 1 から通し番号を振る', () => {
    expect(numberDefinitions(GROUPS)).toEqual([
      { n: 1, pos: 'adjective', text: 'in a series of amounts' },
      { n: 2, pos: 'adjective', text: 'happening gradually, in a series of small amounts' },
      { n: 3, pos: 'noun', text: 'an amount added' },
    ]);
  });

  it('定義が無ければ空配列', () => {
    expect(numberDefinitions(undefined)).toEqual([]);
    expect(numberDefinitions([])).toEqual([]);
  });
});

describe('resolveDefinitionRefs', () => {
  const candidates = numberDefinitions(GROUPS);

  it('品詞行の [番号] を候補の原文に置き換える', () => {
    expect(resolveDefinitionRefs('Adj.: 増分の・追加の | [2]\n説明: x', candidates)).toBe(
      'Adj.: 増分の・追加の | happening gradually, in a series of small amounts\n説明: x',
    );
  });

  it('全角の縦棒・全角の括弧・括弧内の空白も受け付ける', () => {
    expect(resolveDefinitionRefs('N[C]: 増分｜［ 3 ］', candidates)).toBe('N[C]: 増分 | an amount added');
  });

  it('番号の後ろに AI が文を書き足していても原文にそろえる', () => {
    expect(resolveDefinitionRefs('Adj.: 増分の | [2] happening gradually', candidates)).toBe(
      'Adj.: 増分の | happening gradually, in a series of small amounts',
    );
  });

  it('存在しない番号なら英語の部分を取り除いて日本語訳だけ残す', () => {
    expect(resolveDefinitionRefs('Adj.: 増分の | [9]\n説明: x', candidates)).toBe('Adj.: 増分の\n説明: x');
  });

  it('存在しない番号でも後ろに文があればその文を残す', () => {
    expect(resolveDefinitionRefs('Adj.: 増分の | [9] added bit by bit', candidates)).toBe(
      'Adj.: 増分の | added bit by bit',
    );
  });

  it('AI が自分で書いた定義と、番号の無い行はそのまま残す', () => {
    const raw = 'Adj.: 増分の | increasing little by little\n説明: [2] は使わない';
    expect(resolveDefinitionRefs(raw, candidates)).toBe(raw);
  });

  it('候補が無ければ何もしない', () => {
    expect(resolveDefinitionRefs('Adj.: 増分の | [2]', [])).toBe('Adj.: 増分の | [2]');
  });
});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `npx vitest run tests/definitionRefs.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装する**

`src/shared/definitionRefs.ts` を作る。

```ts
import type { DefinitionGroup } from './dictionary';

/** AI に渡す定義の候補（番号付き）。 */
export interface NumberedDefinition {
  /** 通し番号（1 から。品詞をまたいで振る）。 */
  n: number;
  /** その定義の見出しの品詞（"adjective" など）。 */
  pos: string;
  /** Cambridge の定義の原文。 */
  text: string;
}

/** 品詞ごとの定義に、品詞をまたいで 1 から通し番号を振る。 */
export function numberDefinitions(groups: DefinitionGroup[] | undefined): NumberedDefinition[] {
  const out: NumberedDefinition[] = [];
  for (const g of groups ?? []) {
    for (const text of g.defs) out.push({ n: out.length + 1, pos: g.pos, text });
  }
  return out;
}

/** 縦棒の後ろが「[番号]」で始まる部分（全角の ｜ ［ ］ も可）。番号の後ろの書き足しも拾う。 */
const DEFINITION_REF = /\s*[|｜]\s*[[［]\s*(\d+)\s*[\]］](.*)$/;

/**
 * AI の応答の「訳 | [番号]」を「訳 | Cambridge の原文」に置き換える。
 * 存在しない番号なら、番号の後ろに書き足された文があればそれを、無ければ英語の部分ごと取り除く。
 * 縦棒の後ろが番号で始まらない行（AI 自身の定義・説明の行）は変えない。
 */
export function resolveDefinitionRefs(raw: string, candidates: NumberedDefinition[]): string {
  if (candidates.length === 0) return raw;
  return raw
    .split('\n')
    .map((line) => {
      const m = line.match(DEFINITION_REF);
      if (!m || m.index === undefined) return line;
      const head = line.slice(0, m.index);
      const found = candidates.find((c) => c.n === Number(m[1]));
      if (found) return `${head} | ${found.text}`;
      const rest = m[2].trim();
      return rest ? `${head} | ${rest}` : head;
    })
    .join('\n');
}
```

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npx vitest run tests/definitionRefs.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/shared/definitionRefs.ts tests/definitionRefs.test.ts
git commit -m "feat: 定義の候補に番号を振り、AI の応答の番号を原文に差し替える処理を追加

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 解説のプロンプトに定義の候補を渡す

**Files:**
- Modify: `src/shared/prompts.ts`
- Test: `tests/prompts.test.ts`

**Interfaces:**
- Consumes: `NumberedDefinition`（Task 3）
- Produces: `buildExplanationPrompt(selection, context, language, neighbors?, dictionaryPos?, definitionCandidates?: NumberedDefinition[])`。1単語のときだけ候補を system に入れる。

- [ ] **Step 1: 失敗するテストを書く**

`tests/prompts.test.ts` の `describe('buildExplanationPrompt の辞書の品詞', ...)` の後ろに追加する。

```ts
describe('buildExplanationPrompt の定義の候補', () => {
  const candidates = [
    { n: 1, pos: 'adjective', text: 'in a series of amounts' },
    { n: 2, pos: 'adjective', text: 'happening gradually, in a series of small amounts' },
  ];

  it('候補を番号付きで渡し、番号だけを書くよう指示する', () => {
    const { system } = buildExplanationPrompt('incremental', 'a', 'ja', undefined, ['adjective'], candidates);
    expect(system).toContain('[1] (adjective) in a series of amounts');
    expect(system).toContain('[2] (adjective) happening gradually, in a series of small amounts');
    expect(system).toMatch(/番号だけを \[番号\] の形で書く/);
  });

  it('前後の字幕を渡すときも候補を残す', () => {
    const { system } = buildExplanationPrompt('incremental', 'a', 'ja', { before: ['b'] }, ['adjective'], candidates);
    expect(system).toContain('[1] (adjective) in a series of amounts');
  });

  it('候補が無ければ入れない', () => {
    expect(buildExplanationPrompt('incremental', 'a', 'ja', undefined, ['adjective'], []).system).not.toContain('Cambridge 辞書の英語の定義の候補');
    expect(buildExplanationPrompt('incremental', 'a', 'ja').system).not.toContain('Cambridge 辞書の英語の定義の候補');
  });

  it('フレーズには候補を入れない', () => {
    const { system } = buildExplanationPrompt('break a leg', 'a', 'ja', undefined, undefined, candidates);
    expect(system).not.toContain('Cambridge 辞書の英語の定義の候補');
  });
});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `npx vitest run tests/prompts.test.ts`
Expected: FAIL（候補の文が system に無い）

- [ ] **Step 3: 実装する**

`src/shared/prompts.ts` を次のように変える。

(a) import を追加する。

```ts
import type { NumberedDefinition } from './definitionRefs';
```

(b) `buildExplanationPrompt` の引数と呼び出しを変える。

```ts
export function buildExplanationPrompt(
  selection: string,
  context: string,
  language: ExplanationLanguage,
  neighbors?: CaptionNeighbors,
  dictionaryPos?: string[],
  definitionCandidates?: NumberedDefinition[],
): PromptParts {
  const label = LANGUAGE_LABEL[language];
  const prompt = isSingleWord(selection)
    ? buildWordExplanationPrompt(selection, context, label, dictionaryPos, definitionCandidates)
    : buildPhraseExplanationPrompt(selection, context, label);
```

(c) `partOfSpeechRule` の後ろに追加する。

```ts
/**
 * 英語の定義を Cambridge の原文にするため、定義の候補を番号付きで渡し、番号だけを書かせる。
 * 番号はバックグラウンドで原文に差し替える（resolveDefinitionRefs）。候補が無ければ何も足さない。
 */
function definitionCandidatesRule(candidates: NumberedDefinition[] | undefined): string {
  if (!candidates || candidates.length === 0) return '';
  return (
    'Cambridge 辞書の英語の定義の候補:\n' +
    candidates.map((c) => `[${c.n}] (${c.pos}) ${c.text}`).join('\n') +
    '\n' +
    '英語の定義は、その品詞行の日本語訳と同じ意味の候補があれば、定義の文は書かずに番号だけを [番号] の形で書く' +
    '（例: Adj.: 増分の・追加の | [2]）。品詞の合わない候補は選ばない。' +
    '合う候補が無いときだけ、自分で英語の定義を書く。\n'
  );
}
```

(d) `buildWordExplanationPrompt` に引数を足し、`partOfSpeechRule(dictionaryPos) +` の直後に `definitionCandidatesRule(definitionCandidates) +` を入れる。

```ts
function buildWordExplanationPrompt(
  selection: string,
  context: string,
  label: string,
  dictionaryPos?: string[],
  definitionCandidates?: NumberedDefinition[],
): PromptParts {
```

```ts
      partOfSpeechRule(dictionaryPos) +
      definitionCandidatesRule(definitionCandidates) +
```

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npx vitest run tests/prompts.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/shared/prompts.ts tests/prompts.test.ts
git commit -m "feat: 単語の解説のプロンプトに Cambridge の定義の候補を番号付きで渡す

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: ハンドラで候補を渡し、応答の番号を原文にしてから保存する

**Files:**
- Modify: `src/background/handler.ts`、`src/background/cache.ts`
- Test: `tests/handler.test.ts`

**Interfaces:**
- Consumes: `WordInfo.definitions`（Task 1・2）、`numberDefinitions`・`resolveDefinitionRefs`（Task 3）、`buildExplanationPrompt` の第6引数（Task 4）
- Produces: `explainSelection`（1単語）の応答とキャッシュが、番号を Cambridge の原文に差し替えた文になる。

- [ ] **Step 1: 失敗するテストを書く**

`tests/handler.test.ts` の「辞書の応答が遅いときは待ちすぎずに解説を続ける」テストの後ろに追加する。

```ts
  it('Cambridge の定義の候補を渡し、応答の番号を原文にしてから保存して返す', async () => {
    let system = '';
    let stored = '';
    const res = await handleRequest(
      { type: 'explainSelection', selection: 'incremental', context: '$30 trillion a year incremental.' },
      deps({
        getWordInfo: async () => ({
          ipa: null,
          audioUrl: null,
          pos: ['adjective'],
          definitions: [{ pos: 'adjective', defs: ['in a series of amounts', 'happening gradually, in a series of small amounts'] }],
        }),
        callAi: async (p: AnthropicParams) => {
          system = p.system;
          return 'Adj.: 増分の・追加の | [2]\n説明: x';
        },
        setCached: async (_k: string, v: string) => {
          stored = v;
        },
      }),
    );
    expect(system).toContain('[2] (adjective) happening gradually, in a series of small amounts');
    const expected = 'Adj.: 増分の・追加の | happening gradually, in a series of small amounts\n説明: x';
    expect(res).toEqual({ ok: true, text: expected });
    expect(stored).toBe(expected);
  });

  it('辞書に定義が無ければ候補を渡さず、応答もそのまま', async () => {
    let system = '';
    const res = await handleRequest(
      { type: 'explainSelection', selection: 'word', context: 'a word' },
      deps({
        getWordInfo: async () => ({ ipa: null, audioUrl: null, pos: ['noun'] }),
        callAi: async (p: AnthropicParams) => {
          system = p.system;
          return 'N[C]: 語 | a unit of language';
        },
      }),
    );
    expect(system).not.toContain('Cambridge 辞書の英語の定義の候補');
    expect(res).toEqual({ ok: true, text: 'N[C]: 語 | a unit of language' });
  });
```

`tests/cache.test.ts` にキャッシュのバージョンを直接見ているテストがあれば、`v5` を `v6` に合わせる（`grep -n "v5" tests/cache.test.ts` で確認。無ければ何もしない）。

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `npx vitest run tests/handler.test.ts`
Expected: FAIL（候補が system に無い・番号が差し替わらない）

- [ ] **Step 3: 実装する**

`src/background/handler.ts` を次のように変える。

(a) import を追加する（`WordInfo` は既存の `../shared/dictionary` の import に入っている）。

```ts
import { numberDefinitions, resolveDefinitionRefs } from '../shared/definitionRefs';
```

(b) `DICTIONARY_POS_TIMEOUT_MS` と `lookupPartsOfSpeech` を次に置き換える。

```ts
/** 辞書（品詞・定義）を待つ上限。辞書が遅いときは辞書なしで解説を進める（解説を止めない）。 */
const DICTIONARY_TIMEOUT_MS = 2500;

/**
 * 解説の前に、辞書に載っている見出し語の品詞と定義を引く。品詞は AI が文脈から辞書に無い品詞を
 * 作るのを防ぐため、定義は英語の意味を Cambridge の原文にするために使う。
 * 取得は発音表示と共有のキャッシュ・同時取得まとめを通るので、多くは既に取得中か取得済み。
 */
async function lookupDictionary(deps: HandlerDeps, word: string): Promise<WordInfo | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), DICTIONARY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([deps.getWordInfo(word), timeout]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
```

(c) `handleRequest` の辞書の取得から AI 呼び出しまでを次に置き換える。

```ts
    const dictionary =
      req.type === 'explainSelection' && isSingleWord(req.selection)
        ? await lookupDictionary(deps, normalizeWord(req.selection))
        : undefined;
    ensureCurrent();
    const candidates = numberDefinitions(dictionary?.definitions);

    const prompt =
      req.type === 'translateLine'
        ? buildTranslationPrompt(req.text)
        : req.type === 'explainSentence'
          ? buildSentenceMeaningPrompt(req.text, settings.explanationLanguage, req)
          : buildExplanationPrompt(req.selection, req.context, settings.explanationLanguage, req, dictionary?.pos, candidates);

    const raw = await call({
      model: settings.model,
      system: prompt.system,
      user: prompt.user,
    });
    ensureCurrent();
    // AI が選んだ定義の番号を Cambridge の原文に差し替えてから保存する（候補が無ければそのまま）。
    const text = resolveDefinitionRefs(raw, candidates);
    await deps.setCached(key, text);
```

（その後の `ensureCurrent(); return { ok: true, text };` は今のまま。）

(d) `HandlerDeps.getWordInfo` のコメントを「単語の発音情報（IPA＋音源URL）と見出し語の品詞・定義を取得する（辞書）。」にする。

(e) `src/background/cache.ts` の `const EXPLANATION_PROMPT_VERSION = 'v5';` を `'v6'` にする。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npx vitest run tests/handler.test.ts tests/cache.test.ts`
Expected: PASS（既存の「辞書の応答が遅いとき」「辞書が失敗しても」のテストも通る）

- [ ] **Step 5: コミット**

```bash
git add src/background/handler.ts src/background/cache.ts tests/handler.test.ts tests/cache.test.ts
git commit -m "feat: 単語の解説で英語の意味を Cambridge の定義の原文にする

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: バージョンを 0.16.0 に上げ、全体を確かめる

**Files:**
- Modify: `manifest.json`、`package.json`、`package-lock.json`

**Interfaces:**
- Consumes: Task 1〜5 のすべて

- [ ] **Step 1: バージョンを上げる**

`manifest.json` と `package.json` の `"version": "0.15.1"` を `"version": "0.16.0"` にする。`package-lock.json` は先頭の `"version"`（3行目）と `packages[""]` の `"version"`（9行目）の2か所だけを `0.16.0` にする（依存パッケージの version は触らない）。

```bash
grep -n '"version"' manifest.json package.json; sed -n '3p;9p' package-lock.json
```
Expected: 4行とも `0.16.0`

- [ ] **Step 2: 全体のテスト・型チェック・ビルド**

Run: `npx vitest run && npx tsc --noEmit && node build.mjs`
Expected: すべてのテストが PASS、型エラーなし、`build complete`

- [ ] **Step 3: コミット**

```bash
git add manifest.json package.json package-lock.json
git commit -m "chore: バージョンを 0.16.0 に上げる（単語ポップアップの英語の意味を Cambridge の原文に）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
