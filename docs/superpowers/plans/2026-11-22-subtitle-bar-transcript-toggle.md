# 字幕下ボタン群の字幕リスト開閉ボタン Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 字幕下のボタン群（`.rewind-bar`）の「再生/一時停止」と「つまみ」の間に、右端の字幕リストを開閉するボタンを追加する。

**Architecture:** 字幕リスト（`transcriptPanel.ts`）に開閉トグル API と開閉通知コールバックを足し、字幕オーバーレイ（`overlay.ts`）に開閉ボタンと点灯状態の API を足して、`index.ts` で双方をつなぐ。

**Tech Stack:** TypeScript / Shadow DOM / vitest + jsdom / esbuild（Chrome 拡張 MV3）

## Global Constraints

- 再生/一時停止ボタン（幅 44px）の中心は画面中央のまま。新ボタンありのときバー右端は `50% + 98px`（22 + 6 + 36 + 6 + 28）、なしのときは従来どおり `50% + 56px`。
- 新ボタン: 幅 36px、線画のリストアイコン、開いている間は `.open` で青（`rgba(86, 156, 255, 0.85)`）、`aria-pressed` を付ける。
- ラベル: 閉→「字幕リストを開く」、開→「字幕リストを閉じる」。
- 既存の右上 ☰ 再表示ボタンは残す。既存の `TranscriptPanel.setVisible`（ページ単位でホスト全体を出し入れ）の意味は変えない。
- コメント・テスト名は日本語、既存スタイルに合わせる。
- テストは対象ファイルに絞って実行する（`npx vitest run tests/<file>`）。開発サーバー・ビルドは実行しない。

---

### Task 1: 字幕リストに開閉トグルと開閉通知を追加

**Files:**
- Modify: `src/content/transcriptPanel.ts`（`TranscriptPanelCallbacks`・`TranscriptPanel` インターフェース、内部 `setVisible`（約 299 行）、return 文（末尾））
- Test: `tests/transcriptPanel.test.ts`（末尾に describe を追加）

**Interfaces:**
- Produces:
  - `TranscriptPanelCallbacks.onOpenChange?: (open: boolean) => void` — パネルが開いた／閉じた（Close・☰・toggleOpen のいずれでも）ときに、状態が実際に変わったときだけ呼ぶ。
  - `TranscriptPanel.toggleOpen(): void` — 開いていれば閉じ、閉じていれば開く。

- [ ] **Step 1: 失敗するテストを書く**

`tests/transcriptPanel.test.ts` の末尾に追加（`HOST_ID` はファイル冒頭で定義済みの `'useful-subtitle-transcript'`）:

```ts
describe('createTranscriptPanel — 開閉トグルと開閉通知', () => {
  let panel: TranscriptPanel | null = null;

  beforeEach(() => {
    document.body.replaceChildren();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  });

  afterEach(() => {
    panel?.destroy();
    panel = null;
  });

  const root = (): ShadowRoot => document.getElementById(HOST_ID)!.shadowRoot!;
  const panelHost = (): HTMLElement => root().querySelector<HTMLElement>('.host')!;
  const reopenBtn = (): HTMLButtonElement => root().querySelector<HTMLButtonElement>('.reopen')!;
  const closeBtn = (): HTMLButtonElement => root().querySelector<HTMLButtonElement>('.x')!;

  it('toggleOpen で開閉し、そのたびに onOpenChange が呼ばれる', () => {
    const changes: boolean[] = [];
    panel = createTranscriptPanel({ onSeek: () => {}, onOpenChange: (o) => changes.push(o) });
    expect(panelHost().style.display).toBe('none');
    panel.toggleOpen();
    expect(panelHost().style.display).toBe('');
    panel.toggleOpen();
    expect(panelHost().style.display).toBe('none');
    expect(changes).toEqual([true, false]);
  });

  it('☰ と Close で開閉したときも onOpenChange が呼ばれる', () => {
    const changes: boolean[] = [];
    panel = createTranscriptPanel({ onSeek: () => {}, onOpenChange: (o) => changes.push(o) });
    reopenBtn().click();
    closeBtn().click();
    expect(changes).toEqual([true, false]);
  });

  it('onOpenChange 未指定でも toggleOpen は例外を出さない', () => {
    panel = createTranscriptPanel({ onSeek: () => {} });
    expect(() => panel!.toggleOpen()).not.toThrow();
  });
});
```

もしファイル冒頭に `HOST_ID` が無ければ `const HOST_ID = 'useful-subtitle-transcript';` をこの describe の直前に追加する。

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run tests/transcriptPanel.test.ts`
Expected: FAIL（`toggleOpen is not a function` など）

- [ ] **Step 3: 実装**

`TranscriptPanelCallbacks` の末尾（`onHoverEnd` の後）に追加:

```ts
  /** パネルが開いた／閉じたとき（Close・☰・toggleOpen のどれでも）。字幕下の開閉ボタンの点灯用。 */
  onOpenChange?: (open: boolean) => void;
```

`TranscriptPanel` インターフェースの `setVisible` の直後に追加:

```ts
  /** パネルを開閉する（開いていれば閉じ、閉じていれば開く）。setVisible（ページ単位の出し入れ）とは別。 */
  toggleOpen(): void;
```

内部の `setVisible`（`panelHost.style.display = visible ? '' : 'none';` を含む関数）を次に置き換える:

```ts
  let open = false;
  const setVisible = (visible: boolean): void => {
    panelHost.style.display = visible ? '' : 'none';
    reopen.style.display = visible ? 'none' : '';
    if (!visible) leavePanel();
    syncTopOffset();
    if (!visible) clampReopen();
    if (open !== visible) {
      open = visible;
      cb.onOpenChange?.(visible);
    }
  };
```

末尾の return 文を次に置き換える:

```ts
  return {
    append,
    setTranslation,
    updateActiveByTime,
    clear,
    setVisible: setPageVisible,
    toggleOpen: () => setVisible(!open),
    destroy,
  };
```

- [ ] **Step 4: 成功を確認**

Run: `npx vitest run tests/transcriptPanel.test.ts`
Expected: PASS（既存テストも含め全件）

- [ ] **Step 5: コミット**

```bash
git add src/content/transcriptPanel.ts tests/transcriptPanel.test.ts
git commit -m "feat: 字幕リストに開閉トグルと開閉通知を追加する"
```

---

### Task 2: 字幕下のボタン群に開閉ボタンを追加してつなぐ

**Files:**
- Modify: `src/content/icons.ts`（`createPauseIcon` の後に追加）
- Modify: `src/content/overlay.ts`（`OverlayCallbacks`・`Overlay` インターフェース、`STYLES` の `.rewind-bar` 周り（約 176〜204 行）、ボタン生成（約 266〜291 行）、return 文）
- Modify: `src/content/index.ts`（`createOverlay` 呼び出しと `createTranscriptPanel` 呼び出し）
- Test: `tests/overlay.test.ts`（「字幕の下の巻き戻しボタン」describe 内に追加）

**Interfaces:**
- Consumes: Task 1 の `TranscriptPanel.toggleOpen()` と `TranscriptPanelCallbacks.onOpenChange`。
- Produces:
  - `createListIcon(size = 16): SVGSVGElement`（icons.ts）
  - `OverlayCallbacks.onToggleTranscript?: () => void` — 指定時のみ開閉ボタンを作る。
  - `Overlay.setTranscriptOpen(open: boolean): void`

- [ ] **Step 1: 失敗するテストを書く**

`tests/overlay.test.ts` の「字幕の下の巻き戻しボタン」describe の中、`describe('再生/一時停止ボタン'` の直前に追加:

```ts
  describe('字幕リストの開閉ボタン', () => {
    const listToggle = (): HTMLButtonElement | null =>
      bar().querySelector<HTMLButtonElement>('.list-toggle');
    const withList = (onToggleTranscript: () => void = () => {}): Overlay =>
      createOverlay(
        { ...noopCallbacks(), onToggleTranscript },
        { bottomPercent: 10, onBottomChange: () => {} },
      );

    it('onToggleTranscript 指定時は再生/一時停止とつまみの間に並ぶ', () => {
      overlay = withList();
      const kids = [...bar().children] as HTMLElement[];
      expect(kids).toHaveLength(5);
      expect(kids[2].classList.contains('play-toggle')).toBe(true);
      expect(kids[3].classList.contains('list-toggle')).toBe(true);
      expect(kids[4].classList.contains('pos-handle')).toBe(true);
      expect(bar().classList.contains('has-list')).toBe(true);
    });

    it('onToggleTranscript 未指定ならボタンを出さず、配置も従来どおり', () => {
      overlay = createOverlay(noopCallbacks(), { bottomPercent: 10, onBottomChange: () => {} });
      expect(listToggle()).toBeNull();
      expect(bar().classList.contains('has-list')).toBe(false);
    });

    it('再生/一時停止ボタンが中央に残るよう、ボタンありではバーの右端を 50% + 98px に合わせる', () => {
      overlay = withList();
      const css = shadow().querySelector('style')!.textContent ?? '';
      // 98 = 再生ボタン幅 44 の半分 22 + すき間 6 + 開閉ボタン幅 36 + すき間 6 + つまみ幅 28
      expect(css).toMatch(/\.list-toggle\s*\{[^}]*width:\s*36px/);
      expect(css).toMatch(/\.rewind-bar\.has-list\s*\{[^}]*transform:\s*translateX\(calc\(-100% \+ 98px\)\)/);
    });

    it('クリックで onToggleTranscript が呼ばれる', () => {
      let toggles = 0;
      overlay = withList(() => toggles++);
      listToggle()!.click();
      expect(toggles).toBe(1);
    });

    it('初期は閉じた状態で、setTranscriptOpen で点灯とラベルが切り替わる', () => {
      overlay = withList();
      const btn = listToggle()!;
      expect(btn.classList.contains('open')).toBe(false);
      expect(btn.getAttribute('aria-pressed')).toBe('false');
      expect(btn.title).toBe('字幕リストを開く');
      expect(btn.querySelector('svg')).not.toBeNull();
      overlay.setTranscriptOpen(true);
      expect(btn.classList.contains('open')).toBe(true);
      expect(btn.getAttribute('aria-pressed')).toBe('true');
      expect(btn.title).toBe('字幕リストを閉じる');
      expect(btn.getAttribute('aria-label')).toBe('字幕リストを閉じる');
      overlay.setTranscriptOpen(false);
      expect(btn.classList.contains('open')).toBe(false);
      expect(btn.title).toBe('字幕リストを開く');
    });

    it('ボタンが無いときの setTranscriptOpen は例外を出さない', () => {
      overlay = createOverlay(noopCallbacks(), { bottomPercent: 10, onBottomChange: () => {} });
      expect(() => overlay!.setTranscriptOpen(true)).not.toThrow();
    });

    it('mousedown の既定動作を止め、クリックでフォーカスを取らない', () => {
      overlay = withList();
      const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      listToggle()!.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
    });

    it('クリックで開いている単語ポップアップを閉じる', () => {
      overlay = withList();
      overlay.openPopup(new DOMRect(0, 0, 10, 10), 'Hello');
      listToggle()!.click();
      expect(shadow().querySelector('.popup')).toBeNull();
    });
  });
```

既存テスト `'↺5 と ↺10 のボタンが並ぶ'` で使う `buttons()` のセレクタを、開閉ボタンを拾わないよう `'.rewind-btn:not(.play-toggle):not(.list-toggle)'` に変更する。

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run tests/overlay.test.ts`
Expected: FAIL（`.list-toggle` が無い、`setTranscriptOpen is not a function` など）

- [ ] **Step 3: アイコンを追加**

`src/content/icons.ts` の `createPauseIcon` の直後に追加:

```ts
/** 字幕リストの開閉ボタン用のリストアイコン（線画 SVG の横線3本）。 */
export function createListIcon(size = 16): SVGSVGElement {
  return createLineIcon(size, ['M5 7h14', 'M5 12h14', 'M5 17h14']);
}
```

- [ ] **Step 4: overlay.ts を実装**

import を変更:

```ts
import { createListIcon, createPauseIcon, createPlayIcon, createSpeakerButton } from './icons';
```

`OverlayCallbacks` の `onTogglePlay` の直後に追加:

```ts
  /** 字幕下の字幕リスト開閉ボタンが押されたとき。未指定ならボタンを出さない（字幕リスト無効時）。 */
  onToggleTranscript?: () => void;
```

`Overlay` インターフェースの `setPlaying` の直後に追加:

```ts
  /** 字幕下の字幕リスト開閉ボタンの点灯を、字幕リストの開閉状態に合わせる（true＝開いている）。 */
  setTranscriptOpen(open: boolean): void;
```

`STYLES` の `.rewind-bar` のコメントを次に置き換える（並びと 98px の説明を追加）:

```
/* 字幕の真下に置く巻き戻しボタン。.subtitle の外の別要素なので字幕が消えても残る。
   --sub-bottom は字幕の bottom（%）。36px = ボタン高さ 32px + すき間 4px で、
   字幕を一番下まで下げたときは 4px で止まり字幕に少し重なる。
   並びは [↺5][↺10][再生/一時停止]([字幕リスト開閉])[つまみ]。再生/一時停止ボタン（幅 44px）の
   中心を画面中央に置くため、バーの右端を 50% + 56px に合わせる（= 自分の幅だけ左へずらして
   56px 戻す。56 = ボタン幅の半分 22 + すき間 6 + つまみ幅 28）。字幕リスト開閉ボタンが
   あるとき（.has-list）は 98px（= 56 + 開閉ボタン幅 36 + すき間 6）。
   ボタン幅・すき間・つまみ幅のどれかを変えたら 56px / 98px も合わせること。 */
```

`.rewind-bar .bar-handle { ... }` の行の直後に追加:

```
.rewind-bar.has-list { transform: translateX(calc(-100% + 98px)); }
/* 再生/一時停止ボタンの右隣に置く字幕リストの開閉ボタン。開いている間は青く点灯する。 */
.list-toggle {
  width: 36px; min-width: 36px; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
}
.list-toggle.open { background: rgba(86, 156, 255, 0.85); }
```

`rewindBar.append(makeRewindBtn(5), makeRewindBtn(10), playToggle, barHandle);` を次に置き換える:

```ts
  // 字幕リストの開閉ボタン。字幕リストが有効なとき（onToggleTranscript 指定時）だけ、
  // 再生/一時停止ボタンとつまみの間に置く。点灯は setTranscriptOpen で字幕リストに合わせる。
  let listToggle: HTMLButtonElement | null = null;
  const setTranscriptOpen = (open: boolean): void => {
    if (!listToggle) return;
    const label = open ? '字幕リストを閉じる' : '字幕リストを開く';
    listToggle.classList.toggle('open', open);
    listToggle.setAttribute('aria-pressed', String(open));
    listToggle.title = label;
    listToggle.setAttribute('aria-label', label);
  };
  if (callbacks.onToggleTranscript) {
    const onToggleTranscript = callbacks.onToggleTranscript;
    listToggle = document.createElement('button');
    listToggle.className = 'rewind-btn list-toggle';
    listToggle.appendChild(createListIcon());
    // 他のボタンと同じく、クリックでフォーカスを取らない（Space で再度押されないため）。
    listToggle.addEventListener('mousedown', (e) => e.preventDefault());
    listToggle.addEventListener('click', () => {
      // 開いている単語ポップアップは閉じる（閉じるときに再生を再開しない）。
      hidePopup(false);
      onToggleTranscript();
    });
    setTranscriptOpen(false);
    rewindBar.classList.add('has-list');
  }
  rewindBar.append(
    makeRewindBtn(5),
    makeRewindBtn(10),
    playToggle,
    ...(listToggle ? [listToggle] : []),
    barHandle,
  );
```

`createOverlay` の return オブジェクトに `setTranscriptOpen,` を `setPlaying` の隣に追加する（return 文の形に合わせる）。

- [ ] **Step 5: index.ts でつなぐ**

`createOverlay` の callbacks の `onTogglePlay: togglePlayVideo,` の直後に追加:

```ts
      // 字幕リストが有効なときだけ、字幕下に開閉ボタンを出す。
      onToggleTranscript: settings.showTranscriptPanel ? () => panel?.toggleOpen() : undefined,
```

`panel` は `createOverlay` より後で `let panel` 宣言されているが、このクロージャはクリック時にしか評価されない（その時点で宣言済み）ため、宣言は移動しない。

`createTranscriptPanel({` の引数の `onHoverEnd: (opts) => hoverPause?.end(opts),` の直後に追加:

```ts
        // 開閉のたびに、字幕下の開閉ボタンの点灯を合わせる。
        onOpenChange: (open) => overlay.setTranscriptOpen(open),
```

- [ ] **Step 6: 成功を確認**

Run: `npx vitest run tests/overlay.test.ts tests/transcriptPanel.test.ts && npx tsc --noEmit`
Expected: PASS、型エラーなし

- [ ] **Step 7: コミット**

```bash
git add src/content/icons.ts src/content/overlay.ts src/content/index.ts tests/overlay.test.ts
git commit -m "feat: 字幕下のボタン群に字幕リストの開閉ボタンを追加する"
```
