# 字幕つまみドラッグ移動 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 字幕右端の ▲▼ の間に「⠿」つまみを置き、ドラッグで字幕の縦位置を動かせるようにする。

**Architecture:** 変更は `src/content/overlay.ts` だけ。つまみの `pointerdown` でドラッグ開始し、`pointermove`/`pointerup`/`pointercancel` はドラッグ中だけ `document` に capture で登録する（字幕が `clearLine` で隠れてもドラッグが途切れないように、要素の pointer capture は使わない）。見た目はドラッグ中に更新し、保存（`options.onBottomChange`）は離したときに 1 回だけ。

**Tech Stack:** TypeScript, Chrome 拡張 (MV3), Shadow DOM, Pointer Events, vitest + jsdom 29

**Spec:** `docs/superpowers/specs/2026-11-21-subtitle-drag-handle-design.md`

## Global Constraints

- 位置の範囲は画面（基準枠）下から 2%〜85%。▲▼ と同じ定数 `MIN` / `MAX` を使う。
- 基準枠の高さは `host.getBoundingClientRect().height`。0 以下なら動かさない。
- つかめるのは `.pos-handle` だけ。字幕本体・単語のドラッグ（フレーズ選択）には手を入れない。
- `.pos-controls` の `right: -44px` / `padding-left: 12px` は変えない。つまみ幅は 32px。
- ▲▼ ボタンの動作は変えない。
- PC に負荷をかけない: 開発サーバー・`npm run build` の連続実行・全件テストの連続実行はしない。テストは対象ファイルに絞る。
- `package-lock.json` の既存の未コミット差分には触れない（コミットに含めない）。
- コミットメッセージ末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` を付ける。
- バージョン（0.2.1 → 0.3.0）は PR 作成時に上げる。この計画では上げない。

---

## File Structure

- Modify: `src/content/overlay.ts` — つまみ要素・CSS・ドラッグ処理を追加。`move` の範囲制限を `clampBottom` に切り出して共用。
- Modify: `tests/overlay.test.ts` — つまみのドラッグを検証する `describe` を追加。

---

### Task 1: つまみで字幕をドラッグ移動する

**Files:**
- Modify: `src/content/overlay.ts`（CSS: 134〜148 行付近、位置ボタン: 181〜207 行付近、ホバー処理の後 545 行付近、`destroy`: 572 行付近）
- Test: `tests/overlay.test.ts`（ファイル末尾に追記）

**Interfaces:**
- Consumes: 既存の `createOverlay(callbacks, options)`、`options.onBottomChange(percent: number)`、内部関数 `hidePopup(resume?: boolean)`、`applyBottom()`、定数 `MIN`(2) / `MAX`(85)
- Produces: Shadow DOM 内の `.pos-handle` 要素（`.pos-controls` の 2 番目の子）。外部 API の変更なし。

- [ ] **Step 1: 失敗するテストを書く**

`tests/overlay.test.ts` の末尾に追記する（ファイル先頭の `// @vitest-environment jsdom`、`HOST_ID`、`noopCallbacks`、`shadow` は既存のものを使う）:

```ts
describe('createOverlay — つまみのドラッグで字幕を上下に動かす', () => {
  let overlay: Overlay | null = null;

  beforeEach(() => {
    document.body.replaceChildren();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  });

  afterEach(() => {
    overlay?.destroy();
    overlay = null;
  });

  const posControls = (): HTMLElement => shadow().querySelector<HTMLElement>('.pos-controls')!;
  const handle = (): HTMLElement => shadow().querySelector<HTMLElement>('.pos-handle')!;
  const subtitleEl = (): HTMLElement => shadow().querySelector<HTMLElement>('.subtitle')!;
  const bottom = (): number => parseFloat(subtitleEl().style.bottom);

  // jsdom はレイアウトしないので、基準枠（host）の高さを固定する。
  const fixHostHeight = (h: number): void => {
    const host = document.getElementById(HOST_ID)!;
    host.getBoundingClientRect = () => new DOMRect(0, 0, 800, h);
  };

  const pointer = (target: EventTarget, type: string, clientY: number): PointerEvent => {
    const e = new PointerEvent(type, {
      pointerId: 1, button: 0, clientY, bubbles: true, composed: true, cancelable: true,
    });
    target.dispatchEvent(e);
    return e;
  };

  const setup = (bottomPercent = 10): number[] => {
    const saved: number[] = [];
    overlay = createOverlay(noopCallbacks(), {
      bottomPercent,
      onBottomChange: (p) => saved.push(p),
    });
    fixHostHeight(1000);
    overlay.renderLine('Hello, world.', tokenizeLine('Hello, world.'), 0);
    return saved;
  };

  it('つまみが ▲ と ▼ の間に描画される', () => {
    setup();
    const kids = [...posControls().children] as HTMLElement[];
    expect(kids.map((k) => k.className)).toEqual(['pos-btn', 'pos-handle', 'pos-btn']);
    expect(kids.map((k) => k.textContent)).toEqual(['▲', '⠿', '▼']);
  });

  it('上へ 100px ドラッグすると高さ 1000px に対して 10% 上がる', () => {
    setup(10);
    pointer(handle(), 'pointerdown', 500);
    pointer(document, 'pointermove', 400);
    expect(bottom()).toBeCloseTo(20);
    pointer(document, 'pointermove', 550);
    expect(bottom()).toBeCloseTo(5);
  });

  it('下限 2% と上限 85% を超えない', () => {
    setup(10);
    pointer(handle(), 'pointerdown', 500);
    pointer(document, 'pointermove', -5000);
    expect(bottom()).toBe(85);
    pointer(document, 'pointermove', 5000);
    expect(bottom()).toBe(2);
  });

  it('ドラッグ中は保存せず、離したときに最終位置を 1 回だけ保存する', () => {
    const saved = setup(10);
    pointer(handle(), 'pointerdown', 500);
    pointer(document, 'pointermove', 450);
    pointer(document, 'pointermove', 400);
    expect(saved).toEqual([]);
    pointer(document, 'pointerup', 400);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toBeCloseTo(20);
    // 離した後の移動では動かない。
    pointer(document, 'pointermove', 100);
    expect(bottom()).toBeCloseTo(20);
    expect(saved).toHaveLength(1);
  });

  it('動かさずに離したときは保存しない', () => {
    const saved = setup(10);
    pointer(handle(), 'pointerdown', 500);
    pointer(document, 'pointerup', 500);
    expect(saved).toEqual([]);
  });

  it('pointercancel でも見えている位置を保存して終わる', () => {
    const saved = setup(10);
    pointer(handle(), 'pointerdown', 500);
    pointer(document, 'pointermove', 400);
    pointer(document, 'pointercancel', 400);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toBeCloseTo(20);
  });

  it('ドラッグ中に字幕が消えてもドラッグは続き、離すと保存される', () => {
    const saved = setup(10);
    pointer(handle(), 'pointerdown', 500);
    overlay!.clearLine();
    expect(subtitleEl().hidden).toBe(true);
    pointer(document, 'pointermove', 300);
    pointer(document, 'pointerup', 300);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toBeCloseTo(30);
    overlay!.renderLine('Next line.', tokenizeLine('Next line.'), 1);
    expect(bottom()).toBeCloseTo(30);
  });

  it('ドラッグ開始で単語のポップアップを閉じる', () => {
    setup(10);
    overlay!.openPopup(new DOMRect(0, 0, 10, 10), 'Hello');
    expect(shadow().querySelector('.popup')).not.toBeNull();
    pointer(handle(), 'pointerdown', 500);
    expect(shadow().querySelector('.popup')).toBeNull();
  });

  it('つまみの pointerdown は既定動作を止める（再生切り替え・文字選択を防ぐ）', () => {
    setup(10);
    const e = pointer(handle(), 'pointerdown', 500);
    expect(e.defaultPrevented).toBe(true);
  });

  it('左ボタン以外ではドラッグを始めない', () => {
    setup(10);
    handle().dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, button: 2, clientY: 500, bubbles: true, composed: true, cancelable: true,
    }));
    pointer(document, 'pointermove', 400);
    expect(bottom()).toBe(10);
  });

  it('▲▼ ボタンは今までどおり 6% ずつ動かして保存する', () => {
    const saved = setup(10);
    const [up, , down] = [...posControls().children] as HTMLElement[];
    up.click();
    expect(bottom()).toBe(16);
    down.click();
    expect(bottom()).toBe(10);
    expect(saved).toEqual([16, 10]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run tests/overlay.test.ts`
Expected: 新しい `describe` のテストが FAIL（`.pos-handle` が無いので `Cannot read properties of null` 等）。▲▼ のテストと既存テストは PASS。

- [ ] **Step 3: CSS を追加する**

`src/content/overlay.ts` の `STYLES` 内、`.pos-btn:hover { ... }` の行の直後に追加:

```css
.pos-handle {
  width: 32px; height: 22px; border-radius: 6px;
  background: rgba(0, 0, 0, 0.6); color: #fff; font-size: 14px; line-height: 22px;
  text-align: center; cursor: ns-resize; pointer-events: auto;
  touch-action: none; user-select: none;
}
.pos-handle:hover { background: rgba(86, 156, 255, 0.85); }
```

- [ ] **Step 4: つまみ要素を追加し、範囲制限を共通化する**

`src/content/overlay.ts` の位置ボタン部分（`const STEP = 6;` から `posControls.append(upBtn, downBtn);` まで）を次に置き換える:

```ts
  const STEP = 6;
  const MIN = 2;
  const MAX = 85;
  const clampBottom = (percent: number): number => Math.max(MIN, Math.min(MAX, percent));
  const move = (delta: number): void => {
    bottomPercent = clampBottom(bottomPercent + delta);
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
  // ドラッグで上下に動かすつまみ。処理は「字幕位置のドラッグ」の節で登録する。
  const posHandle = document.createElement('div');
  posHandle.className = 'pos-handle';
  posHandle.textContent = '⠿';
  posHandle.title = 'ドラッグで字幕を上下に移動';
  posControls.append(upBtn, posHandle, downBtn);
```

（その後の `subtitle.appendChild(posControls);` と `applyBottom();` はそのまま残す。）

- [ ] **Step 5: ドラッグ処理を追加する**

`src/content/overlay.ts` の「字幕ホバー（一時停止用）」の節の最後（`subtitle.addEventListener('mouseleave', ...)` の閉じ `});` の直後）、`// --- マウント & 全画面追従 ---` の前に追加:

```ts
  // --- 字幕位置のドラッグ（つまみ）---
  // move/up/cancel はドラッグ中だけ document で受ける。要素の pointer capture を使うと、
  // 再生中のセリフの合間に clearLine で字幕が隠れたときにキャプチャが外れてドラッグが途切れる。
  // 単語のフレーズ選択（dragging）とは別の状態として持つ。
  let posDrag: { pointerId: number; startY: number; startBottom: number } | null = null;

  const onPosDragMove = (e: PointerEvent): void => {
    if (!posDrag || e.pointerId !== posDrag.pointerId) return;
    const height = host.getBoundingClientRect().height;
    if (height <= 0) return;
    const dy = e.clientY - posDrag.startY;
    bottomPercent = clampBottom(posDrag.startBottom - (dy / height) * 100);
    applyBottom();
  };

  const stopPosDrag = (): void => {
    document.removeEventListener('pointermove', onPosDragMove, true);
    document.removeEventListener('pointerup', onPosDragEnd, true);
    document.removeEventListener('pointercancel', onPosDragEnd, true);
    posDrag = null;
  };

  // pointercancel でも「見えている位置」をそのまま保存する。
  const onPosDragEnd = (e: PointerEvent): void => {
    if (!posDrag || e.pointerId !== posDrag.pointerId) return;
    const changed = bottomPercent !== posDrag.startBottom;
    stopPosDrag();
    if (changed) options.onBottomChange(bottomPercent);
  };

  posHandle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || posDrag) return;
    // Prime の再生/停止の切り替えや文字選択を起こさない。
    e.preventDefault();
    e.stopPropagation();
    // 字幕だけ動いてポップアップが取り残されないよう閉じる。つまみは字幕枠の中なので
    // inSubtitle は true のままで、ホバー終了は通知されない。
    hidePopup(false);
    posDrag = { pointerId: e.pointerId, startY: e.clientY, startBottom: bottomPercent };
    document.addEventListener('pointermove', onPosDragMove, true);
    document.addEventListener('pointerup', onPosDragEnd, true);
    document.addEventListener('pointercancel', onPosDragEnd, true);
  });
```

- [ ] **Step 6: destroy でドラッグ中のリスナーを外す**

`src/content/overlay.ts` の `function destroy(): void {` の直後の `hidePopup(false);` の次の行に追加:

```ts
    stopPosDrag();
```

- [ ] **Step 7: テストが通ることを確認する**

Run: `npx vitest run tests/overlay.test.ts`
Expected: すべて PASS

- [ ] **Step 8: 型チェックと関連テストを確認する**

Run: `npx tsc --noEmit && npx vitest run tests/overlay.test.ts tests/interaction.test.ts tests/hoverPause.test.ts tests/youtube.test.ts`
Expected: 型エラーなし、すべて PASS

- [ ] **Step 9: コミットする**

```bash
git add src/content/overlay.ts tests/overlay.test.ts
git commit -m "feat: 字幕右端のつまみをドラッグして字幕を上下に動かせるようにする

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
