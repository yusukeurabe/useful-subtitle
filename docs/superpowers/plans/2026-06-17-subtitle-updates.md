# 字幕4点アップデート 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prime Video 字幕拡張に「ドラッグ範囲選択の修正・簡易 truecasing・字幕の縦位置ボタン・過去字幕の履歴パネル」の4点を追加する。

**Architecture:** 純ロジック（truecase）は TDD で `src/shared/` に。UI 系は content script（overlay／新規 transcriptPanel）に実装し、設定は `chrome.storage.local` 経由。字幕は取得直後に truecase を通し、表示・履歴・AI 送信で統一して使う。

**Tech Stack:** TypeScript, esbuild, vitest, Chrome Extension MV3, Shadow DOM。

> **コミット規約:** 各コミットメッセージの末尾に次の行を付ける。
> `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
> 以降の各 Step のコミットコマンドでは件名のみ示す。

---

## ファイル構成

**新規**
- `src/shared/truecase.ts` — ALL CAPS 字幕のローカル整形（純関数）
- `src/content/transcriptPanel.ts` — 右側の字幕履歴パネル
- `tests/truecase.test.ts` — truecase のユニットテスト

**変更**
- `src/shared/types.ts` — `Settings` に3項目追加
- `src/shared/settings.ts` — 既定値追加
- `tests/settings.test.ts` — 新既定値のテスト
- `src/content/overlay.ts` — ドラッグ修正＋縦位置ボタン
- `src/content/videoControl.ts` — `seekVideo` 追加
- `src/content/index.ts` — truecase 適用・履歴連携・位置保存
- `src/options/options.html`, `src/options/options.ts` — 設定トグル2つ追加

---

## Task 1: truecase 純関数（TDD）

**Files:**
- Create: `src/shared/truecase.ts`
- Test: `tests/truecase.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`tests/truecase.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toTrueCase } from '../src/shared/truecase';

describe('toTrueCase', () => {
  it('returns an empty string unchanged', () => {
    expect(toTrueCase('')).toBe('');
  });

  it('lowercases an all-caps sentence and capitalizes the first letter', () => {
    expect(toTrueCase('HELLO WORLD')).toBe('Hello world');
  });

  it('capitalizes the first letter after . ! ?', () => {
    expect(toTrueCase('HELLO. HOW ARE YOU? GREAT!')).toBe('Hello. How are you? Great!');
  });

  it('always capitalizes the pronoun I and its contractions', () => {
    expect(toTrueCase("I THINK I'M RIGHT AND I'LL WIN")).toBe("I think I'm right and I'll win");
  });

  it('does not capitalize i inside other words', () => {
    expect(toTrueCase('IT IS HIS')).toBe('It is his');
  });

  it('leaves proper nouns lowercased (known limitation)', () => {
    expect(toTrueCase('MY NAME IS JOHN')).toBe('My name is john');
  });

  it('passes through text that already has mixed case', () => {
    expect(toTrueCase('Hello, my name is John.')).toBe('Hello, my name is John.');
  });

  it('handles letterless input', () => {
    expect(toTrueCase('...')).toBe('...');
    expect(toTrueCase('123 - 456')).toBe('123 - 456');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- truecase`
Expected: FAIL（`toTrueCase` が存在しない / モジュール未解決）

- [ ] **Step 3: 最小実装を書く**

`src/shared/truecase.ts`:

```ts
/**
 * ALL CAPS の字幕を、簡易ルールで自然な大小文字へ整形する（ローカル・無料・即時）。
 * - 入力が大小文字混在（小文字を含む）なら、整形済みとみなして素通しする。
 * - ALL CAPS のときだけ：全体を小文字化 → 文頭/文末記号後を大文字化 → 一人称 I を大文字化。
 * 固有名詞（人名・地名など）は機械的に判定できないため小文字のままになる（既知の限界）。
 */
export function toTrueCase(line: string): string {
  if (!isAllCaps(line)) return line;
  let s = line.toLowerCase();
  // 文頭、および文末記号(. ! ?)の後の最初の英字を大文字化
  s = s.replace(/(^|[.!?]\s+)([a-z])/g, (_m, pre: string, ch: string) => pre + ch.toUpperCase());
  // 一人称 I（単独）と短縮形 I'm / I'll / I've / I'd の i を大文字化
  // （i の直後がアポストロフィでも単語境界になるため \bi\b で拾える）
  s = s.replace(/\bi\b/g, 'I');
  return s;
}

/** 英字を含み、その中に小文字が 1 つもなければ ALL CAPS とみなす。 */
function isAllCaps(line: string): boolean {
  let hasLetter = false;
  for (const ch of line) {
    if (ch >= 'a' && ch <= 'z') return false;
    if (ch >= 'A' && ch <= 'Z') hasLetter = true;
  }
  return hasLetter;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- truecase`
Expected: PASS（8 ケース全通過）

- [ ] **Step 5: コミット**

```bash
git add src/shared/truecase.ts tests/truecase.test.ts
git commit -m "feat: 字幕の大小文字を簡易整形する toTrueCase を追加（機能2）"
```

---

## Task 2: 設定3項目の追加

**Files:**
- Modify: `src/shared/types.ts`（`Settings` interface）
- Modify: `src/shared/settings.ts`（`DEFAULT_SETTINGS`）
- Test: `tests/settings.test.ts`

- [ ] **Step 1: 失敗するテストを追加**

`tests/settings.test.ts` の `describe('settings', () => {` 内（既存 it の後）に追加:

```ts
  it('defaults to truecasing on, subtitle at 12% and transcript panel on', () => {
    expect(DEFAULT_SETTINGS.truecaseSubtitle).toBe(true);
    expect(DEFAULT_SETTINGS.subtitleBottomPercent).toBe(12);
    expect(DEFAULT_SETTINGS.showTranscriptPanel).toBe(true);
  });
```

- [ ] **Step 2: 失敗を確認**

Run: `npm test -- settings`
Expected: FAIL（`truecaseSubtitle` 等が `undefined`）かつ `npm run typecheck` で型エラー

- [ ] **Step 3: 型を追加**

`src/shared/types.ts` の `Settings` interface、`enabled: boolean;` の行の直後に追加:

```ts
  /** 字幕の大小文字をローカルで自動整形する（簡易 truecasing）。 */
  truecaseSubtitle: boolean;
  /** カスタム字幕の画面下からの位置（％）。 */
  subtitleBottomPercent: number;
  /** 右側の字幕履歴パネルを表示する。 */
  showTranscriptPanel: boolean;
```

- [ ] **Step 4: 既定値を追加**

`src/shared/settings.ts` の `DEFAULT_SETTINGS` オブジェクト、`enabled: true,` の直後に追加:

```ts
  truecaseSubtitle: true,
  subtitleBottomPercent: 12,
  showTranscriptPanel: true,
```

- [ ] **Step 5: テストと型を確認**

Run: `npm test -- settings && npm run typecheck`
Expected: PASS（テスト通過、型エラーなし）

- [ ] **Step 6: コミット**

```bash
git add src/shared/types.ts src/shared/settings.ts tests/settings.test.ts
git commit -m "feat: truecase/字幕位置/履歴パネルの設定項目を追加"
```

---

## Task 3: ドラッグ範囲選択の修正

**Files:**
- Modify: `src/content/overlay.ts`（`renderLine` の span 生成、イベント登録／解除）

ドラッグ追従を「単語の `mouseenter`」から「`document` の `mousemove` + `shadow.elementFromPoint` による座標判定」に変える。プレイヤー上での取りこぼしをなくす。

- [ ] **Step 1: ドラッグ追従ハンドラを追加**

`src/content/overlay.ts`、`onMouseUp` 関数定義（`const onMouseUp = ...`）の直後に追加:

```ts
  const onMouseMove = (e: MouseEvent): void => {
    if (!dragging) return;
    const node = shadow.elementFromPoint(e.clientX, e.clientY);
    if (!node) return;
    const idx = wordRefs.findIndex((w) => w.el === node);
    if (idx < 0) return;
    dragEnd = idx;
    highlight(dragStart, dragEnd);
  };
```

- [ ] **Step 2: 単語の mouseenter リスナーを削除**

`src/content/overlay.ts` の `renderLine` 内、span に付けている **`mouseenter` リスナーのブロックを削除**する。削除対象:

```ts
      span.addEventListener('mouseenter', () => {
        if (!dragging) return;
        dragEnd = index;
        highlight(dragStart, dragEnd);
      });
```

（直前の `mousedown` リスナーはそのまま残す。）

- [ ] **Step 3: document に mousemove を登録**

`src/content/overlay.ts`、既存の
`document.addEventListener('mouseup', onMouseUp, true);`
の直後に追加:

```ts
  document.addEventListener('mousemove', onMouseMove, true);
```

- [ ] **Step 4: destroy で解除**

`src/content/overlay.ts` の `destroy` 関数内、
`document.removeEventListener('mouseup', onMouseUp, true);`
の直後に追加:

```ts
    document.removeEventListener('mousemove', onMouseMove, true);
```

- [ ] **Step 5: 型・ビルドを確認**

Run: `npm run typecheck && npm run build`
Expected: 型エラーなし、`dist/content.js` が生成される

- [ ] **Step 6: コミット**

```bash
git add src/content/overlay.ts
git commit -m "fix: ドラッグ範囲選択を座標ベースにして取りこぼしを解消（機能1）"
```

- [ ] **Step 7: 実機確認**

`chrome://extensions` で拡張をリロード → Prime Video で英語字幕 ON → 字幕の複数単語をドラッグ。青いハイライトが連続して伸び、離すと解説ポップアップが出ることを確認。単語1クリックも従来どおり動くこと。

---

## Task 4: 字幕の縦位置ボタン

**Files:**
- Modify: `src/content/overlay.ts`（STYLES、`createOverlay` シグネチャ、ボタン生成）
- Modify: `src/content/index.ts`（`createOverlay` 呼び出し、保存コールバック）

- [ ] **Step 1: STYLES に位置ボタンの CSS を追加し、固定 bottom を外す**

`src/content/overlay.ts` の `STYLES` テンプレート内:

(a) `.subtitle` の宣言から `bottom: 12%;` を削除（位置は JS で動的設定するため）。変更後の `.subtitle`:

```css
.subtitle {
  position: fixed; left: 50%; transform: translateX(-50%);
  max-width: 80vw; text-align: center; pointer-events: auto; user-select: none;
  font-family: -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
}
```

(b) `STYLES` の末尾（閉じバッククォートの直前）に追加:

```css
.pos-controls {
  position: absolute; right: -44px; top: 50%; transform: translateY(-50%);
  display: flex; flex-direction: column; gap: 4px;
  opacity: 0.2; transition: opacity 0.2s;
}
.subtitle:hover .pos-controls { opacity: 0.9; }
.pos-btn {
  width: 32px; height: 32px; border-radius: 6px; border: none;
  background: rgba(0, 0, 0, 0.6); color: #fff; font-size: 13px;
  cursor: pointer; pointer-events: auto; line-height: 1;
}
.pos-btn:hover { background: rgba(86, 156, 255, 0.85); }
```

- [ ] **Step 2: createOverlay にオプション引数を追加**

`src/content/overlay.ts`、`OverlayCallbacks` interface の直後に追加:

```ts
export interface OverlayOptions {
  /** 字幕の初期縦位置（画面下からの％）。 */
  bottomPercent: number;
  /** ユーザーが位置を変えたとき（永続化用）。 */
  onBottomChange: (percent: number) => void;
}
```

`createOverlay` のシグネチャを変更:

```ts
export function createOverlay(callbacks: OverlayCallbacks, options: OverlayOptions): Overlay {
```

- [ ] **Step 3: 位置の状態とボタンを生成**

`src/content/overlay.ts`、`subtitle.append(original, translation);` の行の直後に追加:

```ts
  let bottomPercent = options.bottomPercent;
  const applyBottom = (): void => {
    subtitle.style.bottom = `${bottomPercent}%`;
  };
  const STEP = 6;
  const MIN = 2;
  const MAX = 85;
  const move = (delta: number): void => {
    bottomPercent = Math.max(MIN, Math.min(MAX, bottomPercent + delta));
    applyBottom();
    options.onBottomChange(bottomPercent);
  };
  const posControls = document.createElement('div');
  posControls.className = 'pos-controls';
  const upBtn = document.createElement('button');
  upBtn.className = 'pos-btn';
  upBtn.textContent = '▲';
  upBtn.title = '字幕を上へ';
  upBtn.addEventListener('click', () => move(STEP));
  const downBtn = document.createElement('button');
  downBtn.className = 'pos-btn';
  downBtn.textContent = '▼';
  downBtn.title = '字幕を下へ';
  downBtn.addEventListener('click', () => move(-STEP));
  posControls.append(upBtn, downBtn);
  subtitle.appendChild(posControls);
  applyBottom();
```

- [ ] **Step 4: index.ts で位置設定を渡す**

`src/content/index.ts`、先頭付近の import に `saveSettings` を追加。変更後の1行目:

```ts
import { getSettings, saveSettings } from '../shared/settings';
```

`createOverlay({ ... })` の呼び出しを次に置き換える:

```ts
  overlay = createOverlay(
    {
      onLookup: (selection, sentence, anchor) =>
        void runLookup(overlay, settings, selection, sentence, anchor),
    },
    {
      bottomPercent: settings.subtitleBottomPercent,
      onBottomChange: (percent) => void saveSettings({ subtitleBottomPercent: percent }),
    },
  );
```

- [ ] **Step 5: 型・ビルドを確認**

Run: `npm run typecheck && npm run build`
Expected: 型エラーなし、ビルド成功

- [ ] **Step 6: コミット**

```bash
git add src/content/overlay.ts src/content/index.ts
git commit -m "feat: 字幕の縦位置を▲▼ボタンで調整・保存（機能3）"
```

- [ ] **Step 7: 実機確認**

拡張をリロード → Prime Video 再生 → 字幕にマウスを乗せると右側に ▲▼ が出る。クリックで字幕が上下し、ページ再読み込み後も位置が保たれることを確認。

---

## Task 5: 過去の字幕履歴パネル

**Files:**
- Create: `src/content/transcriptPanel.ts`
- Modify: `src/content/videoControl.ts`（`seekVideo` 追加）
- Modify: `src/content/index.ts`（truecase 適用・履歴連携）

- [ ] **Step 1: videoControl に seekVideo を追加**

`src/content/videoControl.ts` の末尾に追加:

```ts
/** 指定秒へシークする（負値は 0 に丸める）。 */
export function seekVideo(seconds: number): void {
  const v = findVideo();
  if (v) v.currentTime = Math.max(0, seconds);
}
```

- [ ] **Step 2: transcriptPanel.ts を新規作成**

`src/content/transcriptPanel.ts`:

```ts
export interface TranscriptEntry {
  /** 行を一意に識別する連番（翻訳の後追い更新に使う）。 */
  id: number;
  /** 整形済み（truecase 適用後）の英文。 */
  english: string;
  /** この字幕が出た瞬間の動画再生位置（秒）。クリックで巻き戻す先。 */
  videoTime: number;
}

export interface TranscriptPanelCallbacks {
  /** 行クリックでその場面へシークする。 */
  onSeek: (videoTime: number) => void;
}

export interface TranscriptPanel {
  append(entry: TranscriptEntry): void;
  setTranslation(id: number, japanese: string): void;
  destroy(): void;
}

const STYLES = `
.host {
  position: fixed; top: 0; right: 0; width: 320px; height: 100%;
  z-index: 2147483000; pointer-events: auto;
  font-family: -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
}
.panel {
  display: flex; flex-direction: column; height: 100%;
  background: rgba(20, 20, 20, 0.82); color: #f3f3f3;
  backdrop-filter: blur(2px);
}
.header {
  flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; font-size: 13px; font-weight: 700; border-bottom: 1px solid #444;
}
.header .x { cursor: pointer; color: #aaa; font-size: 16px; line-height: 1; }
.list { flex: 1 1 auto; overflow-y: auto; padding: 6px 0; }
.row {
  padding: 8px 12px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.06);
}
.row:hover { background: rgba(86, 156, 255, 0.18); }
.row .en { font-size: 13px; line-height: 1.4; }
.row .ja { font-size: 12px; line-height: 1.4; color: #ffe08a; margin-top: 2px; }
.reopen {
  position: fixed; top: 8px; right: 8px; z-index: 2147483000;
  background: rgba(20,20,20,0.82); color: #fff; border: 1px solid #555;
  border-radius: 6px; padding: 4px 8px; font-size: 12px; cursor: pointer;
  pointer-events: auto;
  font-family: -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
}
`;

export function createTranscriptPanel(cb: TranscriptPanelCallbacks): TranscriptPanel {
  const host = document.createElement('div');
  host.id = 'useful-subtitle-transcript';
  host.style.cssText = 'position:fixed;inset:0 0 0 auto;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLES;
  shadow.appendChild(style);

  const panelHost = document.createElement('div');
  panelHost.className = 'host';
  const panel = document.createElement('div');
  panel.className = 'panel';
  const header = document.createElement('div');
  header.className = 'header';
  const title = document.createElement('span');
  title.textContent = '字幕の履歴';
  const closeX = document.createElement('span');
  closeX.className = 'x';
  closeX.textContent = '×';
  closeX.title = 'パネルを閉じる';
  header.append(title, closeX);
  const list = document.createElement('div');
  list.className = 'list';
  panel.append(header, list);
  panelHost.appendChild(panel);
  shadow.appendChild(panelHost);

  const reopen = document.createElement('button');
  reopen.className = 'reopen';
  reopen.textContent = '☰ 字幕履歴';
  reopen.style.display = 'none';
  shadow.appendChild(reopen);

  const setVisible = (visible: boolean): void => {
    panelHost.style.display = visible ? '' : 'none';
    reopen.style.display = visible ? 'none' : '';
  };
  closeX.addEventListener('click', () => setVisible(false));
  reopen.addEventListener('click', () => setVisible(true));

  const jaById = new Map<number, HTMLDivElement>();

  function append(entry: TranscriptEntry): void {
    const row = document.createElement('div');
    row.className = 'row';
    row.addEventListener('click', () => cb.onSeek(entry.videoTime));
    const en = document.createElement('div');
    en.className = 'en';
    en.textContent = entry.english;
    const ja = document.createElement('div');
    ja.className = 'ja';
    row.append(en, ja);
    list.appendChild(row);
    jaById.set(entry.id, ja);
    list.scrollTop = list.scrollHeight;
  }

  function setTranslation(id: number, japanese: string): void {
    const ja = jaById.get(id);
    if (ja) ja.textContent = japanese;
  }

  function destroy(): void {
    host.remove();
    jaById.clear();
  }

  document.body.appendChild(host);
  return { append, setTranslation, destroy };
}
```

- [ ] **Step 3: index.ts に truecase と履歴パネルを統合**

`src/content/index.ts` の import 群を次に置き換える（先頭ブロック）:

```ts
import { getSettings, saveSettings } from '../shared/settings';
import { tokenizeLine } from '../shared/tokenize';
import { toTrueCase } from '../shared/truecase';
import { startCaptionObserver } from './captionObserver';
import { createOverlay, type Overlay } from './overlay';
import { createTranscriptPanel, type TranscriptPanel } from './transcriptPanel';
import { runLookup } from './interaction';
import { findVideo, seekVideo } from './videoControl';
import { sendRequest } from '../shared/messages';
```

`createOverlay(...)` 呼び出しの直後（`let currentText = '';` の前）に履歴パネル生成を追加:

```ts
  const panel: TranscriptPanel | null = settings.showTranscriptPanel
    ? createTranscriptPanel({ onSeek: seekVideo })
    : null;
  let entryId = 0;
```

`startCaptionObserver((text) => { ... })` のコールバック全体を次に置き換える:

```ts
  startCaptionObserver((raw) => {
    if (raw === null) {
      currentText = '';
      overlay.clearLine();
      return;
    }
    const text = settings.truecaseSubtitle ? toTrueCase(raw) : raw;
    currentText = text;
    overlay.renderLine(text, tokenizeLine(text));

    const id = ++entryId;
    panel?.append({ id, english: text, videoTime: findVideo()?.currentTime ?? 0 });

    if (!settings.dualSubtitle) {
      overlay.setTranslation({ kind: 'none' });
      return;
    }
    overlay.setTranslation({ kind: 'loading' });
    void sendRequest({ type: 'translateLine', text }).then((res) => {
      if (res.ok) panel?.setTranslation(id, res.text);
      if (text !== currentText) return; // 既に次の行へ移っていれば字幕表示は破棄
      overlay.setTranslation(res.ok ? { kind: 'text', text: res.text } : { kind: 'none' });
    });
  });
```

- [ ] **Step 4: 型・ビルドを確認**

Run: `npm run typecheck && npm run build`
Expected: 型エラーなし、ビルド成功

- [ ] **Step 5: コミット**

```bash
git add src/content/transcriptPanel.ts src/content/videoControl.ts src/content/index.ts
git commit -m "feat: 過去字幕の履歴パネルと truecase 適用を追加（機能4・機能2適用）"
```

- [ ] **Step 6: 実機確認**

拡張をリロード → Prime Video 再生（英語字幕 ON・デュアル字幕 ON）。右側に履歴パネルが出て、字幕が流れるたびに行が増え、英文が読みやすい大小文字になり、少し遅れて日本語訳が各行に入る。行クリックでその場面に巻き戻る。`×` で閉じ、`☰ 字幕履歴` で再表示できることを確認。

---

## Task 6: 設定画面に2トグルを追加

**Files:**
- Modify: `src/options/options.html`
- Modify: `src/options/options.ts`

（縦位置は画面上の▲▼で操作するため、設定画面には truecase と履歴パネルの2つだけ出す。）

- [ ] **Step 1: HTML にトグルを追加**

`src/options/options.html`、`dualSubtitle` の `<div class="field row">…</div>` ブロックの直後に追加:

```html
    <div class="field row">
      <input id="truecaseSubtitle" type="checkbox" />
      <label for="truecaseSubtitle">字幕の大文字を読みやすく自動整形（無料・即時）</label>
    </div>

    <div class="field row">
      <input id="showTranscriptPanel" type="checkbox" />
      <label for="showTranscriptPanel">右側に字幕の履歴パネルを表示</label>
    </div>
```

- [ ] **Step 2: options.ts に要素取得を追加**

`src/options/options.ts` の `init` 内、`const enabled = el<HTMLInputElement>('enabled');` の直後に追加:

```ts
  const truecaseSubtitle = el<HTMLInputElement>('truecaseSubtitle');
  const showTranscriptPanel = el<HTMLInputElement>('showTranscriptPanel');
```

- [ ] **Step 3: 初期値の反映を追加**

`enabled.checked = s.enabled;` の直後に追加:

```ts
  truecaseSubtitle.checked = s.truecaseSubtitle;
  showTranscriptPanel.checked = s.showTranscriptPanel;
```

- [ ] **Step 4: persist と change リスナーに追加**

`persist` の `saveSettings({ ... })` に2フィールドを追加（`enabled: enabled.checked,` の直後）:

```ts
      truecaseSubtitle: truecaseSubtitle.checked,
      showTranscriptPanel: showTranscriptPanel.checked,
```

`for (const field of [...])` の配列に2要素を追加:

```ts
  for (const field of [
    apiKey, model, lang, dualSubtitle, autoPause, enabled,
    truecaseSubtitle, showTranscriptPanel,
  ]) {
```

- [ ] **Step 5: 型・ビルドを確認**

Run: `npm run typecheck && npm run build`
Expected: 型エラーなし、ビルド成功（`dist/options.html` 反映）

- [ ] **Step 6: コミット**

```bash
git add src/options/options.html src/options/options.ts
git commit -m "feat: 設定画面に truecase と履歴パネルのトグルを追加"
```

---

## Task 7: 総合ビルド・テスト・実機確認

**Files:** （変更なし。検証のみ）

- [ ] **Step 1: 全テスト**

Run: `npm test`
Expected: 全テスト PASS（truecase・settings 含む）

- [ ] **Step 2: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 3: 本番ビルド**

Run: `npm run build`
Expected: `dist/` 更新成功

- [ ] **Step 4: 実機通し確認**

`chrome://extensions` → 拡張をリロード → Prime Video で英語字幕 ON。次を順に確認:
1. **ドラッグ**: 複数語をドラッグ選択 → 解説が出る。
2. **大小文字**: 字幕が ALL CAPS でなく自然な表記で表示される。
3. **位置**: ▲▼ で字幕が上下し、再読み込み後も保持。
4. **履歴**: 右パネルに行が増える／訳が入る／クリックで巻き戻る／開閉できる。
5. 設定画面の2トグル OFF で、それぞれ無効化されること。

- [ ] **Step 5: 完了コミット（必要なら）**

ビルド成果物（`dist/`）をコミット対象に含める運用なら:

```bash
git add dist
git commit -m "build: 字幕4点アップデートの dist を更新"
```

---

## Self-Review（記入済み）

- **Spec カバレッジ:** 機能1=Task3 / 機能2=Task1＋Task5(適用)＋Task6(設定) / 機能3=Task4 / 機能4=Task5 / 設定=Task2 / UI=Task6 / 検証=Task7。スコープ外（先読み・AI truecase・永続化）は未実装で意図どおり。
- **型整合:** `toTrueCase(string):string` / `createOverlay(callbacks, options)`＋`OverlayOptions{bottomPercent,onBottomChange}` / `createTranscriptPanel({onSeek})`→`TranscriptPanel{append,setTranslation,destroy}` / `TranscriptEntry{id,english,videoTime}` / `seekVideo(number)` / `findVideo()` 。各タスク間で名称一致を確認済み。
- **プレースホルダ:** なし（全ステップに実コード・実コマンド）。
