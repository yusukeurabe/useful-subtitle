# 履歴の手動消去ボタン Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 字幕履歴パネルのヘッダーに「履歴をすべて消す」ボタン（🗑）を追加し、ワンクリックで履歴を全消去＋記録位置を初期化する（押下後の字幕からまた記録される）。

**Architecture:** 既存の `onSeek`/`onExplain` と同じコールバック方式。`transcriptPanel` はヘッダーにボタンを描き、クリックで `onClearHistory` コールバックを呼ぶだけ。`index.ts` がそのコールバックに `() => { panel.clear(); recorder.reset(); }` を渡し、表示の全消去（既存 `clear()`）と記録フロンティアの初期化（既存 `recorder.reset()`）を束ねる。

**Tech Stack:** TypeScript / Chrome 拡張(MV3) / esbuild バンドル / Vitest(+ jsdom)。

## 設計ドキュメント

`docs/superpowers/specs/2026-06-19-manual-clear-history-button-design.md`

## ファイル構成

- **修正** `src/content/transcriptPanel.ts` … `TranscriptPanelCallbacks` に `onClearHistory?` を追加。
  ヘッダーに消去ボタン（`onClearHistory` 指定時のみ）。`STYLES` に少量CSS。既存の公開 `clear()` を利用。
- **修正** `tests/transcriptPanel.test.ts` … 消去ボタンの単体テスト（jsdom）を3件追記。
- **修正** `src/content/index.ts` … `recorder` を `panel` 生成より前へ移動、`panel` を `let` 化、
  `onClearHistory: () => { panel?.clear(); recorder.reset(); }` を配線。単体テスト対象外＝型/build/実機で検証。

---

## Task 1: 履歴パネルに消去ボタンと `onClearHistory` コールバックを追加

**Files:**
- Modify: `src/content/transcriptPanel.ts`
- Test: `tests/transcriptPanel.test.ts`（追記）

- [ ] **Step 1: 失敗するテストを追記**

`tests/transcriptPanel.test.ts` の末尾に describe ブロックを追記:
```ts
describe('createTranscriptPanel — 履歴の手動消去ボタン', () => {
  let panel: TranscriptPanel | null = null;

  beforeEach(() => {
    document.body.replaceChildren();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  });

  afterEach(() => {
    panel?.destroy();
    panel = null;
  });

  function clearButton(): HTMLElement | null {
    const host = document.getElementById(HOST_ID);
    return host!.shadowRoot!.querySelector<HTMLElement>('.clear');
  }

  it('onClearHistory 指定時、ヘッダーに消去ボタンが表示される', () => {
    panel = createTranscriptPanel({ onSeek: () => {}, onClearHistory: () => {} });
    expect(clearButton()).not.toBeNull();
  });

  it('消去ボタンをクリックすると onClearHistory が1回呼ばれる', () => {
    let calls = 0;
    panel = createTranscriptPanel({ onSeek: () => {}, onClearHistory: () => { calls++; } });
    clearButton()!.click();
    expect(calls).toBe(1);
  });

  it('onClearHistory 未指定なら消去ボタンは表示されない', () => {
    panel = createTranscriptPanel({ onSeek: () => {} });
    expect(clearButton()).toBeNull();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- transcriptPanel`
Expected: FAIL（消去ボタン `.clear` が存在しない／`onClearHistory` 指定時も null）。

- [ ] **Step 3: コールバック型に `onClearHistory` を追加**

`src/content/transcriptPanel.ts` の `TranscriptPanelCallbacks` を置換する。

置換前:
```ts
export interface TranscriptPanelCallbacks {
  /** 行クリックでその場面へシークする。 */
  onSeek: (videoTime: number) => void;
  /** 行に一定時間ホバーしたとき、その英文の意味（和訳＋解説）を取得する。 */
  onExplain?: (sentence: string) => Promise<TranscriptMeaning>;
}
```
置換後:
```ts
export interface TranscriptPanelCallbacks {
  /** 行クリックでその場面へシークする。 */
  onSeek: (videoTime: number) => void;
  /** 行に一定時間ホバーしたとき、その英文の意味（和訳＋解説）を取得する。 */
  onExplain?: (sentence: string) => Promise<TranscriptMeaning>;
  /** ヘッダーの消去ボタンクリックで履歴を全消去する（未指定ならボタンを出さない）。 */
  onClearHistory?: () => void;
}
```

- [ ] **Step 4: STYLES に消去ボタンのCSSを追加**

`STYLES` テンプレート内、`.header .x { ... }` の行の直後に追記する。

置換前:
```ts
.header .x { cursor: pointer; color: #aaa; font-size: 16px; line-height: 1; }
```
置換後:
```ts
.header .x { cursor: pointer; color: #aaa; font-size: 16px; line-height: 1; }
.header .actions { display: flex; align-items: center; gap: 10px; }
.header .clear { cursor: pointer; color: #aaa; font-size: 15px; line-height: 1; }
.header .clear:hover { color: #fff; }
```

- [ ] **Step 5: ヘッダーに消去ボタンを生成して配置**

`createTranscriptPanel` 内のヘッダー組み立て部を置換する。

置換前:
```ts
  const closeX = document.createElement('span');
  closeX.className = 'x';
  closeX.textContent = '×';
  closeX.title = 'パネルを閉じる';
  header.append(title, closeX);
```
置換後:
```ts
  const closeX = document.createElement('span');
  closeX.className = 'x';
  closeX.textContent = '×';
  closeX.title = 'パネルを閉じる';
  // 右側のボタン群。space-between で散らばらないよう1つにまとめる（🗑 を × の左隣に置く）。
  const actions = document.createElement('span');
  actions.className = 'actions';
  if (cb.onClearHistory) {
    const clearBtn = document.createElement('span');
    clearBtn.className = 'clear';
    clearBtn.textContent = '🗑';
    clearBtn.title = '履歴をすべて消す';
    clearBtn.addEventListener('click', () => cb.onClearHistory?.());
    actions.append(clearBtn);
  }
  actions.append(closeX);
  header.append(title, actions);
```

- [ ] **Step 6: テストが通ることを確認**

Run: `npm test -- transcriptPanel`
Expected: PASS（既存＋追記3件）。

- [ ] **Step 7: 全テストと型チェック**

Run: `npm test && npm run typecheck`
Expected: 全 PASS、型エラー無し。

- [ ] **Step 8: コミット**

```bash
git add src/content/transcriptPanel.ts tests/transcriptPanel.test.ts
git commit -m "feat: 履歴パネルに手動消去ボタンを追加" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `content/index.ts` に消去ボタンを配線

**Files:**
- Modify: `src/content/index.ts`

index.ts は拡張のエントリ（`void main()`）で単体テストの対象外のため、型チェック＋ビルド＋実機確認で検証する。
`recorder` を `panel` 生成より前へ移動し、`panel` を `let` 化してコールバックの前方参照を避ける。

- [ ] **Step 1: `recorder` の生成を前へ移動し、`panel` を `let` 化して `onClearHistory` を配線**

`src/content/index.ts` の `panel` 生成ブロックから `recorder` 生成までを置換する。

置換前:
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
  let entryId = 0;

  // 履歴への重複記録を防ぐ記録ポリシー。履歴クリックや再生バーで過去へ巻き戻して
  // 記録済み範囲を再生し直す間は記録せず、記録済み地点を追い越したら記録を再開する。
  const recorder = createTranscriptRecorder();
```
置換後:
```ts
  // 履歴への重複記録を防ぐ記録ポリシー。履歴クリックや再生バーで過去へ巻き戻して
  // 記録済み範囲を再生し直す間は記録せず、記録済み地点を追い越したら記録を再開する。
  // 消去ボタンより先に宣言しておく（onClearHistory から参照するため）。
  const recorder = createTranscriptRecorder();

  // 履歴パネル。消去ボタン（onClearHistory）は履歴の全消去＋記録位置の初期化を束ねる。
  // 押下後に再生された字幕からまた記録が始まる。panel 自身を参照するので let で先に宣言する。
  let panel: TranscriptPanel | null = null;
  const clearHistory = (): void => {
    panel?.clear();
    recorder.reset();
  };
  panel = settings.showTranscriptPanel
    ? createTranscriptPanel({
        onSeek: seekVideo,
        onExplain: async (sentence) => {
          const res = await sendRequest({ type: 'explainSentence', text: sentence });
          if (!res.ok) return { ok: false, error: res.error };
          const { translation, explanation } = parseSentenceMeaning(res.text);
          return { ok: true, translation, explanation };
        },
        onClearHistory: clearHistory,
      })
    : null;
  let entryId = 0;
```

- [ ] **Step 2: 型チェックとビルド**

Run: `npm run typecheck && npm run build`
Expected: 型エラー無し、`dist/` にビルド成功。

- [ ] **Step 3: 全テスト**

Run: `npm test`
Expected: 全 PASS。

- [ ] **Step 4: コミット**

```bash
git add src/content/index.ts
git commit -m "feat: 履歴の手動消去ボタンを配線（clear＋recorder.reset）" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 実機確認（手動）

**反映手順:** watch ビルド（`npm run dev`）起動中 → Chrome の拡張管理で本拡張を再読み込み（↻）→ Prime のページを再読み込み（F5）。MV3 仕様で両方必要。

- [ ] **確認1（基本）:** 履歴が数行ある状態で 🗑 を押す → **履歴が空になる**。
- [ ] **確認2（再蓄積）:** 消去後そのまま視聴を続ける → **押した後の字幕から順に履歴へ並ぶ**。
- [ ] **確認3（巻き戻し中の消去）:** 履歴行クリック等で過去へ巻き戻した状態で 🗑 → 消去後、そこから視聴を進めると
  **遅延なく字幕が記録され始める**こと（フロンティア初期化が効いている）。
- [ ] **確認4（全画面）:** 全画面再生中でも 🗑 が押せて履歴が消えること。

---

## Self-Review（計画作成者による確認結果）

- **Spec coverage:** コールバック方式＝Task 1,2 / ボタンの見た目（🗑 を × の左隣・未指定で非表示）＝Task 1 /
  clear()＋recorder.reset() の束ね＝Task 2 / 全画面動作・確認ダイアログ無し＝設計どおり（実装は標準 confirm 不使用）/
  手動確認＝Task 3。spec の各節に対応タスクあり。
- **Placeholder scan:** TBD/TODO 無し。全ステップに実コードと実コマンドを記載。
- **Type consistency:** `onClearHistory?: () => void`（Task 1 で型定義、Task 2 で `clearHistory` を渡す）、
  クラス名 `.clear` / `.actions`（Task 1 の CSS・DOM・テストで一貫）、`panel?.clear()`・`recorder.reset()`
  （既存の公開API）を一貫使用。
