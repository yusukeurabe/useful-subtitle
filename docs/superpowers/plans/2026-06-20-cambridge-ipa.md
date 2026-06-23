# Cambridge IPA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 単語ポップアップに表示する IPA と音源 mp3 の取得元を、無料辞書 API（`api.dictionaryapi.dev`）から Cambridge Dictionary 英英ページ（US 発音セクション）に切り替え、Cambridge に無い語のみ既存の dictionaryapi.dev へフォールバックする。

**Architecture:** 新しい純関数 `extractCambridgeWordInfo(html)` を `src/shared/dictionary.ts` に追加し、Cambridge ページ HTML から `DOMParser` で US セクションの IPA テキストと mp3 URL を抽出する。`src/background/index.ts` の `getWordInfo` を「`tryCambridge` → 取れなければ `tryDictionaryApi`」の直列フォールバック構造にリファクタする。ハンドラ層・content 層・メッセージ型は変更しない。

**Tech Stack:** TypeScript / Chrome MV3 Service Worker / `DOMParser`（Chrome 124+）/ vitest（jsdom 環境）/ esbuild

仕様: `docs/superpowers/specs/2026-06-20-cambridge-ipa-design.md`

---

## File Structure

| ファイル | 役割 | 状態 |
|---|---|---|
| `src/shared/dictionary.ts` | 辞書まわりの純関数群。Cambridge 抽出関数を追加 | 既存に追記 |
| `src/background/index.ts` | service worker。`getWordInfo` を Cambridge→dictionaryapi の直列に | 既存を修正 |
| `tests/dictionary.test.ts` | 純関数のユニットテスト。Cambridge 抽出のテストを追加。jsdom 環境にする | 既存に追記＋環境指定 |
| `manifest.json` | `host_permissions` に Cambridge を追加 | 既存を修正 |

`src/background/handler.ts` / `src/content/*` / `src/shared/types.ts` / offscreen 関連は触らない（`HandlerDeps.getWordInfo` のシグネチャ不変・メッセージ型不変・UI不変のため）。

---

## Task 1: テストファイル環境を jsdom に切り替える

**Files:**
- Modify: `tests/dictionary.test.ts:1`

これまで純関数だけだった `dictionary.test.ts` に DOMParser を使うテストを足すため、ファイル冒頭にディレクティブを足す。既存テストは jsdom 下でも問題なく動く。

- [ ] **Step 1: 環境ディレクティブを追加**

`tests/dictionary.test.ts` の最初の行に追加:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  normalizeWord,
  isSingleWord,
  cambridgeUrl,
  extractWordInfo,
} from '../src/shared/dictionary';
```

- [ ] **Step 2: 既存テストが緑のまま動くか確認**

Run: `npm test -- dictionary`
Expected: 既存テスト全部 PASS（normalizeWord / isSingleWord / cambridgeUrl / extractWordInfo）

- [ ] **Step 3: コミット**

```bash
git add tests/dictionary.test.ts
git commit -m "test: dictionary テストを jsdom 環境に切り替え（Cambridge HTML 抽出の準備）"
```

---

## Task 2: `extractCambridgeWordInfo` happy path（IPA＋音源あり）

**Files:**
- Modify: `tests/dictionary.test.ts`（テスト追記）
- Modify: `src/shared/dictionary.ts`（関数追加）

Cambridge 英英ページの US 発音セクションから IPA テキストと mp3 URL を抽出する関数を TDD で作る。

### Cambridge HTML の対象構造

Cambridge 英英ページの US 発音は概ねこの形（`resilient` の場合）:

```html
<span class="us dpron-i">
  <span class="daud">
    <audio controls>
      <source type="audio/mpeg" src="/media/english/us_pron/r/res/resil/resilient.mp3">
      <source type="audio/ogg"  src="/media/english/us_pron/r/res/resil/resilient.ogg">
    </audio>
  </span>
  <span class="pron dpron">
    <span class="ipa dipa lpr-2 lpl-1">rɪˈzɪl.i.ənt</span>
  </span>
</span>
```

- US ブロック: `span.us.dpron-i`
- IPA テキスト: ブロック内の `.ipa.dipa` の `textContent`
- 音源 mp3: ブロック内の `source[type="audio/mpeg"]` の `src` 属性

実装に入る前に1回 `curl -sL 'https://dictionary.cambridge.org/dictionary/english/resilient' | grep -A2 'us dpron-i' | head -40` を実行し、上の構造（クラス名／属性）が現在の HTML と一致するか必ず確認する。差分があれば fixture とセレクタを実HTMLに合わせる。

- [ ] **Step 1: 失敗するテストを書く**

`tests/dictionary.test.ts` の import に `extractCambridgeWordInfo` を追加し、末尾に describe ブロックを追加:

```ts
import {
  normalizeWord,
  isSingleWord,
  cambridgeUrl,
  extractWordInfo,
  extractCambridgeWordInfo,
} from '../src/shared/dictionary';

// ... 既存 describe ブロックの下に追加 ...

describe('extractCambridgeWordInfo', () => {
  it('extracts IPA text and absolutized US mp3 URL from a Cambridge US section', () => {
    const html = `
      <html><body>
        <span class="us dpron-i">
          <span class="daud">
            <audio controls>
              <source type="audio/mpeg" src="/media/english/us_pron/r/res/resil/resilient.mp3">
              <source type="audio/ogg" src="/media/english/us_pron/r/res/resil/resilient.ogg">
            </audio>
          </span>
          <span class="pron dpron">
            <span class="ipa dipa lpr-2 lpl-1">rɪˈzɪl.i.ənt</span>
          </span>
        </span>
      </body></html>`;
    expect(extractCambridgeWordInfo(html)).toEqual({
      ipa: 'rɪˈzɪl.i.ənt',
      audioUrl: 'https://dictionary.cambridge.org/media/english/us_pron/r/res/resil/resilient.mp3',
    });
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npm test -- dictionary`
Expected: `extractCambridgeWordInfo` が未エクスポートで FAIL

- [ ] **Step 3: 最小実装を書く**

`src/shared/dictionary.ts` の末尾に追加:

```ts
const CAMBRIDGE_BASE = 'https://dictionary.cambridge.org';

/**
 * Cambridge 英英ページ HTML から US 発音セクションの IPA と mp3 URL を抽出する。
 * IPA は主目的のため、IPA が取れなければ {null,null} を返す（呼び出し側はフォールバックする）。
 * 音源 URL が相対パスなら絶対 URL 化する。失敗系は静かに {null,null}。
 */
export function extractCambridgeWordInfo(html: string): WordInfo {
  if (!html) return { ipa: null, audioUrl: null };
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const us = doc.querySelector('span.us.dpron-i');
    if (!us) return { ipa: null, audioUrl: null };

    const ipa = us.querySelector('.ipa.dipa')?.textContent?.trim() || null;
    if (!ipa) return { ipa: null, audioUrl: null };

    const src = us.querySelector('source[type="audio/mpeg"]')?.getAttribute('src') ?? null;
    const audioUrl = src ? absolutizeCambridgeUrl(src) : null;

    return { ipa, audioUrl };
  } catch {
    return { ipa: null, audioUrl: null };
  }
}

function absolutizeCambridgeUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith('/')) return `${CAMBRIDGE_BASE}${path}`;
  return `${CAMBRIDGE_BASE}/${path}`;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- dictionary`
Expected: 全 PASS（happy path + 既存）

- [ ] **Step 5: コミット**

```bash
git add tests/dictionary.test.ts src/shared/dictionary.ts
git commit -m "feat: Cambridge HTML から US の IPA と mp3 URL を抽出する純関数を追加"
```

---

## Task 3: `extractCambridgeWordInfo` の異常系・部分採用

**Files:**
- Modify: `tests/dictionary.test.ts`（テスト追記）

仕様 §5 の方針:
- US セクションが無い → `{null,null}`
- 空文字 HTML → `{null,null}`
- IPA あり・音源なし → `{ipa, audioUrl:null}`（部分採用）
- 音源あり・IPA なし → `{null,null}`（Cambridge 不採用→フォールバック）
- 既に絶対 URL の `src` はそのまま通す

- [ ] **Step 1: 失敗するテストを書く**

`describe('extractCambridgeWordInfo', ...)` 内に追加:

```ts
it('returns nulls for empty html', () => {
  expect(extractCambridgeWordInfo('')).toEqual({ ipa: null, audioUrl: null });
});

it('returns nulls when there is no US section', () => {
  const html = `
    <html><body>
      <span class="uk dpron-i">
        <span class="ipa dipa">rɪˈzɪl.i.ənt</span>
      </span>
    </body></html>`;
  expect(extractCambridgeWordInfo(html)).toEqual({ ipa: null, audioUrl: null });
});

it('returns ipa with null audio when US section has IPA but no mp3 source', () => {
  const html = `
    <html><body>
      <span class="us dpron-i">
        <span class="ipa dipa">rɪˈzɪl.i.ənt</span>
      </span>
    </body></html>`;
  expect(extractCambridgeWordInfo(html)).toEqual({
    ipa: 'rɪˈzɪl.i.ənt',
    audioUrl: null,
  });
});

it('rejects (returns nulls) when US section has audio but no IPA text', () => {
  const html = `
    <html><body>
      <span class="us dpron-i">
        <source type="audio/mpeg" src="/media/english/us_pron/x/x.mp3">
      </span>
    </body></html>`;
  expect(extractCambridgeWordInfo(html)).toEqual({ ipa: null, audioUrl: null });
});

it('keeps already-absolute audio URLs as-is', () => {
  const html = `
    <html><body>
      <span class="us dpron-i">
        <source type="audio/mpeg" src="https://cdn.example.com/r.mp3">
        <span class="ipa dipa">rɪˈzɪl.i.ənt</span>
      </span>
    </body></html>`;
  expect(extractCambridgeWordInfo(html)).toEqual({
    ipa: 'rɪˈzɪl.i.ənt',
    audioUrl: 'https://cdn.example.com/r.mp3',
  });
});
```

- [ ] **Step 2: テストを実行して状態を確認**

Run: `npm test -- dictionary`
Expected: Task 2 の実装で異常系も網羅しているため、ほとんどのケースが PASS のはず。仕様と整合しない結果（赤）があれば、そのケース名をメモして次のステップで実装を直す。

- [ ] **Step 3: 失敗したケースがあれば `extractCambridgeWordInfo` を直す**

赤が出たケースだけ実装を調整する。代表的な落とし穴:
- 「音源あり・IPA なし」: `querySelector('.ipa.dipa')` が null のとき `?.textContent?.trim() || null` で null に潰れる設計（Task 2 のコード）になっているか
- 「既に絶対 URL」: `absolutizeCambridgeUrl` の `/^https?:\/\//i` 判定が走っているか
- 「空文字 HTML」: 関数先頭の `if (!html)` ガードが効いているか

全て緑なら Step 4 へ。

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- dictionary`
Expected: 全 PASS

- [ ] **Step 5: コミット**

```bash
git add tests/dictionary.test.ts src/shared/dictionary.ts
git commit -m "test: Cambridge 抽出の異常系・部分採用ケースを網羅"
```

---

## Task 4: background の `getWordInfo` を Cambridge→dictionaryapi の直列に

**Files:**
- Modify: `src/background/index.ts`

既存の `getWordInfo` を `tryDictionaryApi` に改名 → 新規 `tryCambridge` を追加 → 両方を直列で呼ぶ新 `getWordInfo` に差し替え。`HandlerDeps.getWordInfo` のシグネチャは不変なので handler/test には影響なし。

- [ ] **Step 1: import を更新**

`src/background/index.ts:5` を:

```ts
import { extractWordInfo, extractCambridgeWordInfo, type WordInfo } from '../shared/dictionary';
```

- [ ] **Step 2: 既存 `getWordInfo` を `tryDictionaryApi` にリネームし、`tryCambridge` と新 `getWordInfo` を追加**

`src/background/index.ts:8-16` 周辺を次のように差し替える:

```ts
const CAMBRIDGE_BASE = 'https://dictionary.cambridge.org';
const DICT_API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';

/** Cambridge 英英ページから US の IPA と mp3 URL を取得する。未収録/失敗時は {null,null}。 */
async function tryCambridge(word: string): Promise<WordInfo> {
  try {
    const res = await fetch(`${CAMBRIDGE_BASE}/dictionary/english/${encodeURIComponent(word)}`);
    if (!res.ok) return { ipa: null, audioUrl: null };
    const html = await res.text();
    return extractCambridgeWordInfo(html);
  } catch {
    return { ipa: null, audioUrl: null };
  }
}

/** 無料辞書 API（フォールバック）から IPA と mp3 URL を取得する。失敗時は {null,null}。 */
async function tryDictionaryApi(word: string): Promise<WordInfo> {
  const res = await fetch(`${DICT_API}${encodeURIComponent(word)}`);
  if (!res.ok) return { ipa: null, audioUrl: null };
  const json = (await res.json().catch(() => null)) as unknown;
  return extractWordInfo(json);
}

/**
 * Cambridge を一次、dictionaryapi.dev をフォールバックとして単語の IPA＋音源 URL を返す。
 * Cambridge で IPA が取れたら音源 null でも採用する（部分採用＝音源は TTS フォールバックで埋まる）。
 */
async function getWordInfo(word: string): Promise<WordInfo> {
  const cam = await tryCambridge(word);
  if (cam.ipa) return cam;
  return tryDictionaryApi(word);
}
```

- [ ] **Step 3: 型チェックと全テストが通ることを確認**

Run: `npm run typecheck && npm test`
Expected: 型エラーなし、全テスト PASS（`handler.test.ts` は `HandlerDeps.getWordInfo` をモック注入しているので影響なし）

- [ ] **Step 4: コミット**

```bash
git add src/background/index.ts
git commit -m "feat: 単語IPAをCambridge優先・dictionaryapi.devフォールバックに切替"
```

---

## Task 5: `manifest.json` に Cambridge を追加

**Files:**
- Modify: `manifest.json:7-10`

- [ ] **Step 1: `host_permissions` に1行追加**

`manifest.json` を次のように修正:

```json
  "host_permissions": [
    "https://api.anthropic.com/*",
    "https://api.dictionaryapi.dev/*",
    "https://dictionary.cambridge.org/*"
  ],
```

- [ ] **Step 2: dist が manifest をコピーしているか build で確認**

Run: `npm run build`
Expected: ビルド成功。`dist/manifest.json` の host_permissions に cambridge.org が含まれる。

確認コマンド: `grep cambridge dist/manifest.json`
Expected: マッチ行が1つ表示される。

- [ ] **Step 3: コミット**

```bash
git add manifest.json
git commit -m "feat: manifest に dictionary.cambridge.org の host permission を追加"
```

---

## Task 6: ビルド・テスト・Prime Video 実機確認

**Files:** なし（最終検収）

- [ ] **Step 1: 全テスト・型チェック・ビルドを通す**

Run: `npm run typecheck && npm test && npm run build`
Expected: すべて成功。

- [ ] **Step 2: Chrome 拡張をリロード**

1. `chrome://extensions/` を開く
2. Useful Subtitle の「更新」(↻) ボタンを押す
3. 「新しい権限を許可しますか？」が出たら許可（Cambridge への host permission 追加のため）
4. Prime Video のタブを開いて F5 でリロード

- [ ] **Step 3: Cambridge 収録語で IPA が Cambridge 由来になっているか確認**

Prime Video で英語字幕を出し、次のような Cambridge 収録の一般語をクリック:
- `resilient` → `rɪˈzɪl.i.ənt` 系の IPA が出る
- `ambiguous` → `æmˈbɪɡ.ju.əs` 系の IPA が出る
- `interesting` → `ˈɪn.trə.stɪŋ` 系の IPA が出る

DevTools Network タブで `dictionary.cambridge.org/dictionary/english/...` の 200 と、`api.dictionaryapi.dev` への通信が発生していないことを確認（Cambridge が取れたら dictionaryapi.dev は呼ばれない）。

- [ ] **Step 4: Cambridge 未収録語でフォールバックが動くか確認**

固有名詞をクリック（例: 字幕に出てくる人名・地名・ブランド名）。
DevTools Network タブで Cambridge が 404 を返したあと、`api.dictionaryapi.dev` が呼ばれて IPA か null を返すかを確認。IPA が無い語ではポップアップの IPA 行が静かに非表示になる。

- [ ] **Step 5: 🔊 ボタンが Cambridge mp3 を鳴らすか確認**

Cambridge 収録語のポップアップで 🔊 をクリックして Cambridge の mp3 音源が鳴ることを確認。
取れていない語では既存どおり Web Speech API（TTS）にフォールバックすることを確認。

- [ ] **Step 6: 通常視聴で API が呼ばれないか確認**

Prime Video の再生中（クリックなし）に DevTools Network タブを開き、Cambridge にも dictionaryapi.dev にも Anthropic にもリクエストが発生しないことを確認（二重字幕 ON のときは Anthropic 翻訳は発生する＝既存挙動と同じ）。

- [ ] **Step 7: 最終コミット（不要なら飛ばす）**

実機確認のなかで Cambridge HTML 構造が想定と違うことが分かり実装を直した場合のみコミット:

```bash
git add -p
git commit -m "fix: Cambridge セレクタを実HTMLに合わせて調整"
```
