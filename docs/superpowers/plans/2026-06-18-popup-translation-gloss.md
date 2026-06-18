# ポップアップ訳語(一般訳)表示 + 🔊アイコン化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 字幕クリックのポップアップに選択語句の一般訳を単語の横へ表示し、🔊ボタンをアイコンのみにする。

**Architecture:** 既存の `explainSelection`（AI 1回呼び出し）を構造化出力（`訳:`/`説明:`）に拡張。content 側で純粋関数 `parseExplanation` が分解し、訳語を `.sel` 横へ、説明を本文へ表示する。追加API呼び出しなし。

**Tech Stack:** TypeScript(strict), esbuild, Vitest, Chrome Extension MV3, Shadow DOM。

---

## File Structure

- `src/shared/explanation.ts`（新規）— レスポンス分解の純粋関数。
- `src/shared/prompts.ts`（修正）— 構造化プロンプト。
- `src/content/overlay.ts`（修正）— 訳語表示 + 🔊アイコン化。
- `src/content/interaction.ts`（修正）— 分解して overlay へ受け渡し。
- `tests/explanation.test.ts`（新規）, `tests/prompts.test.ts`（追記）。

---

### Task 1: parseExplanation 純粋関数

**Files:**
- Create: `src/shared/explanation.ts`
- Test: `tests/explanation.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/explanation.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseExplanation } from '../src/shared/explanation';

describe('parseExplanation', () => {
  it('splits 訳/説明 labels into gloss and explanation', () => {
    const r = parseExplanation('訳: 言語・言葉・国語\n説明: 文脈ではこう。');
    expect(r.gloss).toBe('言語・言葉・国語');
    expect(r.explanation).toBe('文脈ではこう。');
  });

  it('accepts full-width colons', () => {
    const r = parseExplanation('訳： 言語\n説明： 説明文');
    expect(r.gloss).toBe('言語');
    expect(r.explanation).toBe('説明文');
  });

  it('accepts the 訳語 label variant', () => {
    expect(parseExplanation('訳語: 言語\n説明: x').gloss).toBe('言語');
  });

  it('normalizes separators to ・ and caps at 3', () => {
    expect(parseExplanation('訳: a、b,c／d\n説明: x').gloss).toBe('a・b・c');
  });

  it('keeps multi-line explanation', () => {
    expect(parseExplanation('訳: 言語\n説明: 行1\n行2').explanation).toBe('行1\n行2');
  });

  it('returns null gloss when 訳 label is missing', () => {
    const r = parseExplanation('説明: ただの説明');
    expect(r.gloss).toBeNull();
    expect(r.explanation).toBe('ただの説明');
  });

  it('falls back to whole text when no labels (old cache)', () => {
    const r = parseExplanation('これは普通の説明文です。');
    expect(r.gloss).toBeNull();
    expect(r.explanation).toBe('これは普通の説明文です。');
  });

  it('uses remainder as explanation when 説明 missing but 訳 present', () => {
    const r = parseExplanation('訳: 言語\nラベルなしの説明');
    expect(r.gloss).toBe('言語');
    expect(r.explanation).toBe('ラベルなしの説明');
  });

  it('treats empty gloss value as null', () => {
    const r = parseExplanation('訳:\n説明: x');
    expect(r.gloss).toBeNull();
    expect(r.explanation).toBe('x');
  });

  it('returns empty explanation for blank input', () => {
    const r = parseExplanation('   ');
    expect(r.gloss).toBeNull();
    expect(r.explanation).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/explanation.test.ts`
Expected: FAIL（`parseExplanation` 未定義 / モジュール解決エラー）

- [ ] **Step 3: Write the implementation**

`src/shared/explanation.ts`:
```ts
/** AI 解説レスポンスを「一般訳(gloss)」と「文脈依存の説明(explanation)」に分解した結果。 */
export interface ParsedExplanation {
  /** 一般的な訳語（最大3つ・中黒区切り）。無ければ null。 */
  gloss: string | null;
  /** 文脈に沿った説明文。 */
  explanation: string;
}

/** 訳語の区切り（、 , ・ ／ /）を「・」に正規化し、最大3つに丸める。空なら ''。 */
function normalizeGloss(raw: string): string {
  return raw
    .split(/[、,・／/]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join('・');
}

/**
 * AI の構造化レスポンス（「訳: …」「説明: …」）を分解する。
 * ラベルが無い場合（旧キャッシュ・形式逸脱）は gloss=null・全文を explanation とし、安全に劣化する。
 */
export function parseExplanation(raw: string): ParsedExplanation {
  const text = (raw ?? '').trim();
  if (!text) return { gloss: null, explanation: '' };

  const glossMatch = text.match(/^訳(?:語)?\s*[:：]\s*(.+?)\s*$/m);
  const explMatch = text.match(/^説明\s*[:：]\s*([\s\S]+)$/m);

  const gloss = glossMatch ? normalizeGloss(glossMatch[1]) : '';

  let explanation: string;
  if (explMatch) {
    explanation = explMatch[1].trim();
  } else if (glossMatch) {
    explanation = text.replace(glossMatch[0], '').trim();
  } else {
    explanation = text;
  }

  return { gloss: gloss || null, explanation };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/explanation.test.ts`
Expected: PASS（10 tests）

- [ ] **Step 5: Typecheck & commit**

Run: `npm run typecheck`（エラーなし）
```bash
git add src/shared/explanation.ts tests/explanation.test.ts
git commit -m "feat: AI解説を一般訳と説明に分解する純粋関数を追加"
```

---

### Task 2: 構造化プロンプト（訳: / 説明:）

**Files:**
- Modify: `src/shared/prompts.ts`（`buildExplanationPrompt`）
- Test: `tests/prompts.test.ts`（追記）

- [ ] **Step 1: Add failing tests**

`tests/prompts.test.ts` の `describe('buildExplanationPrompt', ...)` 内末尾に追記:
```ts
  it('asks for the structured 訳/説明 format', () => {
    const { system } = buildExplanationPrompt('word', 'a sentence', 'ja');
    expect(system).toContain('訳:');
    expect(system).toContain('説明:');
  });

  it('asks for up to 3 general translations separated by ・', () => {
    const { system } = buildExplanationPrompt('word', 'a sentence', 'ja');
    expect(system).toMatch(/3つ/);
    expect(system).toContain('・');
  });
```

- [ ] **Step 2: Run test to verify the new ones fail**

Run: `npx vitest run tests/prompts.test.ts`
Expected: FAIL（新規2件。既存3件は PASS）

- [ ] **Step 3: Update `buildExplanationPrompt`**

`src/shared/prompts.ts` の `buildExplanationPrompt` を置き換え（`LANGUAGE_LABEL` と user 行は維持）:
```ts
export function buildExplanationPrompt(
  selection: string,
  context: string,
  language: ExplanationLanguage,
): PromptParts {
  const label = LANGUAGE_LABEL[language];
  return {
    system:
      'あなたは日本語話者の英語学習を助けるチューターです。' +
      '次の厳密な2行形式で出力してください（前置き・引用符・装飾は付けない）。\n' +
      '訳: 選択語句の一般的な日本語訳を最大3つ、中黒(・)区切りで。文脈に依存しない代表的な訳にする。\n' +
      `説明: ${label}で、文脈に沿った意味を簡潔に（2〜4文）。イディオム・句動詞・スラングならその点も補足する。`,
    user: `文: "${context}"\nこの文の中の "${selection}" の意味を教えてください。`,
  };
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run tests/prompts.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: Typecheck & commit**

Run: `npm run typecheck`（エラーなし）
```bash
git add src/shared/prompts.ts tests/prompts.test.ts
git commit -m "feat: 解説プロンプトを訳語+説明の構造化出力に変更"
```

---

### Task 3: ポップアップ表示（訳語横並び + 🔊アイコン化 + 配線）

**Files:**
- Modify: `src/content/overlay.ts`
- Modify: `src/content/interaction.ts`

`overlay.ts` と `interaction.ts` は `setPopupMeaning` の引数変更で結合するため、同一コミットで行い型を常に整合させる。

- [ ] **Step 1: overlay.ts — インターフェース変更**

`setPopupMeaning(text: string): void;` を:
```ts
  setPopupMeaning(text: string, gloss: string | null): void;
```

- [ ] **Step 2: overlay.ts — CSS（`.popup .sel` 行を置換）**

```css
.popup .sel { margin-bottom: 4px; }
.popup .sel .sel-word { font-weight: 700; color: #8ab4ff; }
.popup .sel .gloss { margin-left: 8px; color: #d8d8d8; font-weight: 400; font-size: 13px; }
```

- [ ] **Step 3: overlay.ts — 状態変数を追加**

`let popupIpa: HTMLDivElement | null = null;` の直後に:
```ts
  let popupGloss: HTMLSpanElement | null = null;
```

- [ ] **Step 4: overlay.ts — openPopup の `.sel` 構築を置換**

```ts
    const sel = document.createElement('div');
    sel.className = 'sel';
    const selWord = document.createElement('span');
    selWord.className = 'sel-word';
    selWord.textContent = selection;
    popupGloss = document.createElement('span');
    popupGloss.className = 'gloss';
    popupGloss.style.display = 'none';
    sel.append(selWord, popupGloss);
    p.appendChild(sel);
```

- [ ] **Step 5: overlay.ts — 🔊 ボタンをアイコンのみに**

`audioBtn.textContent = '🔊 発音';` を:
```ts
    audioBtn.textContent = '🔊';
```
（`audioBtn.title = '発音を再生';` は維持）

- [ ] **Step 6: overlay.ts — setPopupMeaning を置換**

```ts
  function setPopupMeaning(text: string, gloss: string | null): void {
    if (popupBody) {
      popupBody.className = 'body';
      popupBody.textContent = text;
    }
    if (popupGloss) {
      if (gloss) {
        popupGloss.textContent = gloss;
        popupGloss.style.display = '';
      } else {
        popupGloss.textContent = '';
        popupGloss.style.display = 'none';
      }
    }
    if (popupAnchor) positionPopup(popupAnchor);
  }
```

- [ ] **Step 7: overlay.ts — hidePopup でリセット**

`popupIpa = null;` の直後に:
```ts
    popupGloss = null;
```

- [ ] **Step 8: interaction.ts — import 追加**

`import { loadWordInfo } from './word';` の直後に:
```ts
import { parseExplanation } from '../shared/explanation';
```

- [ ] **Step 9: interaction.ts — 応答処理を置換**

```ts
  const res = await sendRequest({ type: 'explainSelection', selection, context: sentence });
  if (res.ok) {
    const { gloss, explanation } = parseExplanation(res.text);
    overlay.setPopupMeaning(explanation, gloss);
  } else {
    overlay.setPopupError(res.error);
  }
```

- [ ] **Step 10: Typecheck / test / build**

Run: `npm run typecheck`（エラーなし）
Run: `npm test`（全テスト PASS）
Run: `npm run build`（成功、`dist/` 生成）

- [ ] **Step 11: Commit**

```bash
git add src/content/overlay.ts src/content/interaction.ts
git commit -m "feat: ポップアップに一般訳を横並び表示し🔊をアイコンのみに変更"
```

---

### Task 4: 最終確認とドキュメント

**Files:**
- Modify: docs（spec/plan は本タスクでコミット）

- [ ] **Step 1: フル検証**

Run: `npm run typecheck`（エラーなし）
Run: `npm test`（全 PASS）
Run: `npm run build`（成功）

- [ ] **Step 2: 旧参照が残っていないか確認**

Run: `grep -rn "🔊 発音" src/` → 期待: 0 件
Run: `grep -rn "setPopupMeaning(res.text)" src/` → 期待: 0 件

- [ ] **Step 3: ドキュメントをコミット**

```bash
git add docs/superpowers/specs/2026-06-18-popup-translation-gloss-design.md docs/superpowers/plans/2026-06-18-popup-translation-gloss.md
git commit -m "docs: 一般訳表示と🔊アイコン化の設計・実装計画を追加"
```

- [ ] **Step 4: 手動確認チェックリストをユーザーへ提示**

Prime Video で:
- 単語クリック → 単語の横に一般訳（最大3・中黒区切り）、本文に文脈説明。
- 🔊 がアイコンのみで、押すと発音が鳴る。
- フレーズ選択でも訳語が出る。
- APIキー未設定時は訳語・本文ともに出ない（IPA/🔊/Cambridge は動作）。
- 既存機能（IPA・Cambridge・履歴・デュアル字幕）が従来どおり。

---

## Self-Review

**Spec coverage:** 一般訳取得(Task 2) / 分解(Task 1) / 横並び表示(Task 3) / 🔊アイコン化(Task 3 Step 5) / 安全な劣化(Task 1) / テスト(Task 1,2) / 手動確認(Task 4) — 全て対応。
**Placeholder scan:** なし（全コード提示済み）。
**Type consistency:** `setPopupMeaning(text, gloss)` を interface(Task3 S1)・実装(S6)・呼び出し(interaction S9) で一致。`parseExplanation` の戻り `{ gloss, explanation }` が S9 の分割代入と一致。
