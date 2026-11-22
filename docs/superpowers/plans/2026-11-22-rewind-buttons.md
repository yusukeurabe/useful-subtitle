# 字幕下の巻き戻しボタン（5秒・10秒）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 動画上の字幕の真下に「↺5」「↺10」ボタンを置き、押すと現在位置から 5/10 秒戻って再生する。

**Architecture:** `videoControl.ts` に `rewindVideo(seconds)` を追加し、既存 `seekVideo` と内部関数 `seekElement` を共有する。`overlay.ts` は `.subtitle` とは別要素 `.rewind-bar` を shadow 内に置き、字幕の縦位置（`bottomPercent`）を CSS 変数 `--sub-bottom` で渡して字幕の真下に配置する。`index.ts` で `onRewind: rewindVideo` を配線する。

**Tech Stack:** TypeScript, Chrome MV3 content script, Shadow DOM, vitest + jsdom

**Spec:** `docs/superpowers/specs/2026-11-22-rewind-buttons-design.md`

## Global Constraints

- コメント・テスト名は日本語（既存ファイルに合わせる）。コミットメッセージも日本語の conventional commits（`feat:` 等）、末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- 重い処理禁止: 開発サーバー・`npm run build` の繰り返し・全件テストの連続実行をしない。検証は対象ファイルを絞った `npx vitest run <file>` と `npx tsc --noEmit`
- ボタン文言: `↺5`（title `5秒戻る`）、`↺10`（title `10秒戻る`）
- 不透明度: 普段 0.35、字幕かバーにホバーで 0.9
- バー位置: `bottom: max(4px, calc(var(--sub-bottom) - 36px))`（36px = ボタン高さ 32px + すき間 4px）
- バージョン番号はこの計画では上げない（PR 作成時に 0.3.0 → 0.4.0）

---

### Task 1: `rewindVideo` を追加する

**Files:**
- Modify: `src/content/videoControl.ts:101-119`（`seekVideo` 付近）
- Test: `tests/videoControl.test.ts`

**Interfaces:**
- Produces: `export function rewindVideo(seconds: number): void` — 本編 video を現在位置から `seconds` 秒戻して再生（0 秒未満は 0）。video 無しなら何もしない。

- [ ] **Step 1: 失敗するテストを書く**

`tests/videoControl.test.ts` の import を次に変更:

```ts
import { pickBestVideo, resumeVideo, rewindVideo, seekVideo, type VideoLike } from '../src/content/videoControl';
```

`describe('seekVideo — …')` ブロックの直後に追加:

```ts
describe('rewindVideo — 現在位置から指定秒だけ戻して再生', () => {
  let video: HTMLVideoElement;
  let current: number;
  let setTimes: number[];
  let playSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.replaceChildren();
    current = 0;
    setTimes = [];
    playSpy = vi.fn(() => Promise.resolve());
    video = document.createElement('video');
    // jsdom は currentTime/play を実装しないので差し替える。
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => current,
      set: (t: number) => {
        current = t;
        setTimes.push(t);
      },
    });
    Object.defineProperty(video, 'paused', { configurable: true, value: true });
    video.play = playSpy as unknown as HTMLVideoElement['play'];
    document.body.appendChild(video);
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('現在位置から 5 秒戻す', () => {
    current = 42;
    rewindVideo(5);
    expect(setTimes).toEqual([37]);
  });

  it('現在位置から 10 秒戻す', () => {
    current = 42;
    rewindVideo(10);
    expect(setTimes).toEqual([32]);
  });

  it('0 秒より前には戻らない', () => {
    current = 3;
    rewindVideo(10);
    expect(setTimes).toEqual([0]);
  });

  it('戻した後に再生する（停止中は Prime が絵を描き直さないため）', () => {
    current = 20;
    rewindVideo(5);
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it('video が無ければ何もしない（例外を出さず play も呼ばない）', () => {
    document.body.replaceChildren();
    expect(() => rewindVideo(5)).not.toThrow();
    expect(playSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run tests/videoControl.test.ts`
Expected: FAIL（`rewindVideo` が export されていない）

- [ ] **Step 3: 実装**

`src/content/videoControl.ts` の `seekVideo`（101〜119 行のコメントと関数）を次で置き換える:

```ts
/**
 * v を指定秒へシークし、その地点から再生を再開する（負値は 0 に丸める）。
 *
 * Prime は一時停止中だとプログラムからの currentTime 変更で画面を描き直さないため、
 * シーク後に resumeVideo で再生まで行う（履歴行をクリックしても「戻らない」ように
 * 見えるのを防ぐ）。未バッファ地点で直後の play() が落ちた場合に備え、シーク完了
 * (seeked) 時にもう一度 play() する。再生中に呼ばれた場合は resumeVideo の
 * ボタン押下が skip される（v.paused が false）ので、再生中クリックを誤って停止しない。
 */
function seekElement(v: HTMLVideoElement, seconds: number): void {
  v.currentTime = Math.max(0, seconds);
  resumeVideo(v);
  v.addEventListener('seeked', () => {
    if (findVideo() === v) void v.play().catch(() => undefined);
  }, { once: true });
}

/**
 * 指定秒へシークし、その地点から再生を再開する。
 * 同じ要素を一貫して扱い、findVideo の二度引きによる取り違えも防ぐ。
 */
export function seekVideo(seconds: number): void {
  const v = findVideo();
  if (v) seekElement(v, seconds);
}

/**
 * 現在位置から seconds 秒戻して再生する（字幕下の巻き戻しボタン用）。
 * 0 秒より前は 0 秒。現在位置の読み取りとシークは同じ要素に対して行う。
 */
export function rewindVideo(seconds: number): void {
  const v = findVideo();
  if (v) seekElement(v, v.currentTime - seconds);
}
```

- [ ] **Step 4: 通過を確認**

Run: `npx vitest run tests/videoControl.test.ts`
Expected: PASS（既存の seekVideo テストも含め全件）

- [ ] **Step 5: コミット**

```bash
git add src/content/videoControl.ts tests/videoControl.test.ts
git commit -m "feat: 現在位置から指定秒だけ戻して再生する rewindVideo を追加"
```

---

### Task 2: 字幕の下に巻き戻しバーを描画し、配線する

**Files:**
- Modify: `src/content/overlay.ts`（`OverlayCallbacks`、`STYLES`、`createOverlay` 内の要素生成と `applyBottom`）
- Modify: `src/content/index.ts:12`（import）, `src/content/index.ts:41-49`（createOverlay のコールバック）
- Test: `tests/overlay.test.ts`, `tests/youtube.test.ts`

**Interfaces:**
- Consumes: `rewindVideo(seconds: number): void`（Task 1、`src/content/videoControl.ts`）
- Produces: `OverlayCallbacks.onRewind?: (seconds: number) => void`

- [ ] **Step 1: 失敗するテストを書く**

`tests/overlay.test.ts` の末尾に追加:

```ts
describe('createOverlay — 字幕の下の巻き戻しボタン', () => {
  let overlay: Overlay | null = null;

  beforeEach(() => {
    document.body.replaceChildren();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  });

  afterEach(() => {
    overlay?.destroy();
    overlay = null;
  });

  const bar = (): HTMLElement => shadow().querySelector<HTMLElement>('.rewind-bar')!;
  const buttons = (): HTMLButtonElement[] =>
    [...bar().querySelectorAll<HTMLButtonElement>('.rewind-btn')];

  it('↺5 と ↺10 のボタンが並ぶ', () => {
    overlay = createOverlay(noopCallbacks(), { bottomPercent: 10, onBottomChange: () => {} });
    expect(buttons().map((b) => b.textContent)).toEqual(['↺5', '↺10']);
    expect(buttons().map((b) => b.title)).toEqual(['5秒戻る', '10秒戻る']);
  });

  it('クリックで onRewind が 5 / 10 で呼ばれる', () => {
    const rewinds: number[] = [];
    overlay = createOverlay(
      { ...noopCallbacks(), onRewind: (s) => rewinds.push(s) },
      { bottomPercent: 10, onBottomChange: () => {} },
    );
    buttons()[0].click();
    buttons()[1].click();
    expect(rewinds).toEqual([5, 10]);
  });

  it('onRewind 未指定でもクリックで例外を出さない', () => {
    overlay = createOverlay(noopCallbacks(), { bottomPercent: 10, onBottomChange: () => {} });
    expect(() => buttons()[0].click()).not.toThrow();
  });

  it('字幕の直後に置かれ、字幕の子ではない（字幕が消えても残るため）', () => {
    overlay = createOverlay(noopCallbacks(), { bottomPercent: 10, onBottomChange: () => {} });
    const subtitle = shadow().querySelector<HTMLElement>('.subtitle')!;
    expect(subtitle.contains(bar())).toBe(false);
    expect(subtitle.nextElementSibling).toBe(bar());
  });

  it('clearLine で字幕が隠れてもバーは表示されたまま', () => {
    overlay = createOverlay(noopCallbacks(), { bottomPercent: 10, onBottomChange: () => {} });
    overlay.renderLine('Hello, world.', tokenizeLine('Hello, world.'), 0);
    overlay.clearLine();
    expect(shadow().querySelector<HTMLElement>('.subtitle')!.hidden).toBe(true);
    expect(bar().hidden).toBe(false);
  });

  it('字幕の縦位置を CSS 変数で受け取り、▲▼で字幕と一緒に動く', () => {
    overlay = createOverlay(noopCallbacks(), { bottomPercent: 10, onBottomChange: () => {} });
    expect(bar().style.getPropertyValue('--sub-bottom')).toBe('10%');
    const up = shadow().querySelector<HTMLButtonElement>('.pos-btn')!; // 先頭は ▲
    up.click();
    expect(bar().style.getPropertyValue('--sub-bottom')).toBe('16%');
  });
});
```

`tests/youtube.test.ts` の `'mounts in the player, converts popup coordinates, follows replacement and fullscreen'` テスト内、
`expect(host.shadowRoot!.querySelector<HTMLElement>('.subtitle')!.style.position).toBe('absolute');` の直後に 1 行追加:

```ts
    expect(host.shadowRoot!.querySelector<HTMLElement>('.rewind-bar')!.style.position).toBe('absolute');
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run tests/overlay.test.ts tests/youtube.test.ts`
Expected: FAIL（`.rewind-bar` が無い／`onRewind` が型に無い）

- [ ] **Step 3: overlay.ts を実装**

(a) `OverlayCallbacks` の `onSeek` の直後に追加:

```ts
  /** 字幕下の巻き戻しボタン（↺5 / ↺10）が押されたとき。引数は戻す秒数。 */
  onRewind?: (seconds: number) => void;
```

(b) `STYLES` の末尾（`.pos-handle:hover { … }` の行の後、閉じバッククォートの前）に追加:

```css
/* 字幕の真下に置く巻き戻しボタン。.subtitle の外の別要素なので字幕が消えても残る。
   --sub-bottom は字幕の bottom（%）。36px = ボタン高さ 32px + すき間 4px で、
   字幕を一番下まで下げたときは 4px で止まり字幕に少し重なる。 */
.rewind-bar {
  position: fixed; left: 50%; transform: translateX(-50%);
  bottom: max(4px, calc(var(--sub-bottom) - 36px));
  display: flex; gap: 6px; pointer-events: auto;
  opacity: 0.35; transition: opacity 0.2s;
}
.subtitle:hover ~ .rewind-bar, .rewind-bar:hover { opacity: 0.9; }
.rewind-btn {
  height: 32px; min-width: 44px; padding: 0 8px; border-radius: 6px; border: none;
  background: rgba(0, 0, 0, 0.6); color: #fff; font-size: 13px; line-height: 1;
  font-family: -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
  cursor: pointer;
}
.rewind-btn:hover { background: rgba(86, 156, 255, 0.85); }
```

(c) `createOverlay` 内、`subtitle.append(original, translation);` の直後に追加:

```ts
  // 字幕の真下の巻き戻しボタン。字幕の合間に .subtitle が hidden になっても押せるよう、
  // .subtitle の子にせず直後の兄弟として置く（そのため字幕ホバー一時停止の対象外）。
  const rewindBar = document.createElement('div');
  rewindBar.className = 'rewind-bar';
  if (youtube) rewindBar.style.position = 'absolute';
  for (const seconds of [5, 10]) {
    const btn = document.createElement('button');
    btn.className = 'rewind-btn';
    btn.textContent = `↺${seconds}`;
    btn.title = `${seconds}秒戻る`;
    btn.addEventListener('click', () => callbacks.onRewind?.(seconds));
    rewindBar.appendChild(btn);
  }
```

(d) `applyBottom` を次に置き換え:

```ts
  const applyBottom = (): void => {
    subtitle.style.bottom = `${bottomPercent}%`;
    rewindBar.style.setProperty('--sub-bottom', `${bottomPercent}%`);
  };
```

(e) `shadow.appendChild(subtitle);` を次に置き換え（ポップアップより前、字幕の直後に置く。`~` セレクタのため順序が必要）:

```ts
  shadow.appendChild(subtitle);
  shadow.appendChild(rewindBar);
```

- [ ] **Step 4: index.ts を配線**

`src/content/index.ts` 12 行目の import を:

```ts
import { findVideo, pauseVideo, resumeVideo, rewindVideo, seekVideo } from './videoControl';
```

createOverlay のコールバック内、`onSeek: seekVideo,` の直後（`onHoverStart` の前）に:

```ts
      onRewind: rewindVideo,
```

- [ ] **Step 5: 通過を確認**

Run: `npx vitest run tests/overlay.test.ts tests/youtube.test.ts tests/videoControl.test.ts`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
git add src/content/overlay.ts src/content/index.ts tests/overlay.test.ts tests/youtube.test.ts
git commit -m "feat: 字幕の真下に5秒・10秒の巻き戻しボタンを付ける"
```
