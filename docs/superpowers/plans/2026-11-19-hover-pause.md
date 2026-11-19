# 字幕ホバーで一時停止 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 動画上の字幕にカーソルを乗せている間は動画を一時停止し、外したら（ホバーで止めた場合だけ）再開する。

**Architecture:** 判断ロジックを `hoverPause.ts`（DOM 構造非依存）に切り出し、`overlay.ts` は字幕枠とポップアップのホバー出入りを `onHoverStart` / `onHoverEnd` コールバックで通知するだけにする。`index.ts` が設定 `pauseOnSubtitleHover` を見て両者をつなぐ。Prime で生の `play()` が無視される場合に備えた再開処理は `videoControl.resumeVideo` に集約する。

**Tech Stack:** TypeScript, Chrome MV3 content script, vitest (+jsdom), esbuild

**Spec:** `docs/superpowers/specs/2026-11-19-hover-pause-design.md`

## Global Constraints

- 対象は動画上の字幕（overlay）のみ。履歴パネルは対象外。
- 設定キー `pauseOnSubtitleHover`、既定値 `true`。設定画面のチェックボックス id は `pauseOnHover`、ラベルは「字幕にカーソルを乗せている間は一時停止（無料・即時）」。
- PC 負荷ルール: テストは対象ファイルだけ実行（`npx vitest run <file>`）。全件テストの連続実行・開発サーバー起動はしない。ビルドは最後に 1 回だけ。
- コード内コメントは日本語、既存の書き方に合わせる。
- コミットメッセージ末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。push・PR 作成はしない。

---

### Task 1: `resumeVideo` を追加し `seekVideo` をそれで整理する

**Files:**
- Modify: `src/content/videoControl.ts`（`seekVideo` 付近）
- Test: `tests/videoControl.test.ts`

**Interfaces:**
- Produces: `export function resumeVideo(v: HTMLVideoElement): () => void` — `v.play()` を呼び、200ms 後もまだ停止中なら（YouTube 以外・`v.isConnected`・`findVideo() === v` のとき）Prime の再生ボタンを押す。戻り値は 200ms 後のボタン押下を取り消す関数。

- [ ] **Step 1: 失敗するテストを書く** — `tests/videoControl.test.ts` の import に `resumeVideo` を追加し、ファイル末尾に追記:

```ts
describe('resumeVideo — 停止中の video を再生し直す', () => {
  let video: HTMLVideoElement;
  let playSpy: ReturnType<typeof vi.fn>;
  let paused: boolean;
  let clickSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    paused = true;
    playSpy = vi.fn(() => Promise.resolve());
    video = document.createElement('video');
    Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
    video.play = playSpy as unknown as HTMLVideoElement['play'];
    document.body.appendChild(video);
    const btn = document.createElement('button');
    btn.className = 'atvwebplayersdk-playpause-button';
    clickSpy = vi.fn();
    btn.addEventListener('click', clickSpy);
    document.body.appendChild(btn);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('すぐに play() を呼ぶ', () => {
    resumeVideo(video);
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it('200ms 後も停止中なら Prime の再生ボタンを押す', () => {
    resumeVideo(video);
    expect(clickSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('再生できていればボタンは押さない', () => {
    resumeVideo(video);
    paused = false;
    vi.advanceTimersByTime(200);
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('戻り値で取り消すとボタンは押さない', () => {
    const cancel = resumeVideo(video);
    cancel();
    vi.advanceTimersByTime(200);
    expect(clickSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run tests/videoControl.test.ts` → Expected: FAIL（`resumeVideo` が未定義）

- [ ] **Step 3: 実装** — `src/content/videoControl.ts` の `seekVideo` の直前に追加し、`seekVideo` を置き換える:

```ts
/**
 * 停止中の video を再生し直す。
 *
 * Prime は一時停止中の生の <video>.play() を握り潰して停止のままにすることがある。
 * そこで play() のあと少し待ってもまだ停止中なら、Prime 自身の再生ボタンを押す
 * （状態機械ごと動かすので握り潰されない）。YouTube は play() だけで再開できる。
 * 戻り値は「少し待ってからボタンを押す」処理を取り消す関数（直後に止め直す場合用）。
 */
export function resumeVideo(v: HTMLVideoElement): () => void {
  void v.play().catch(() => undefined);
  const timer = setTimeout(() => {
    if (!v.paused) return; // 既に再生できている → 何もしない
    if (!isYouTube() && v.isConnected && findVideo() === v) findPlayPauseButton()?.click();
  }, 200);
  return () => clearTimeout(timer);
}

/**
 * 指定秒へシークし、その地点から再生を再開する（負値は 0 に丸める）。
 *
 * Prime は一時停止中だとプログラムからの currentTime 変更で画面を描き直さないため、
 * シーク後に resumeVideo で再生まで行う（履歴行をクリックしても「戻らない」ように
 * 見えるのを防ぐ）。未バッファ地点で直後の play() が落ちた場合に備え、シーク完了
 * (seeked) 時にもう一度 play() する。再生中に呼ばれた場合は resumeVideo の
 * ボタン押下が skip される（v.paused が false）ので、再生中クリックを誤って停止しない。
 * 同じ要素を一貫して扱い、findVideo の二度引きによる取り違えも防ぐ。
 */
export function seekVideo(seconds: number): void {
  const v = findVideo();
  if (!v) return;
  v.currentTime = Math.max(0, seconds);
  resumeVideo(v);
  v.addEventListener('seeked', () => {
    if (findVideo() === v) void v.play().catch(() => undefined);
  }, { once: true });
}
```

- [ ] **Step 4: 通過を確認** — Run: `npx vitest run tests/videoControl.test.ts` → Expected: PASS（既存の seekVideo テストも含め全て）

- [ ] **Step 5: コミット**

```bash
git add src/content/videoControl.ts tests/videoControl.test.ts
git commit -m "refactor: 停止中の動画を再生し直す処理を resumeVideo にまとめる"
```

---

### Task 2: ホバー一時停止の判断部品 `hoverPause.ts`

**Files:**
- Create: `src/content/hoverPause.ts`
- Test: `tests/hoverPause.test.ts`

**Interfaces:**
- Consumes: なし（`resume` は依存として注入。本番では Task 1 の `resumeVideo` を渡す）
- Produces:
  ```ts
  export interface HoverPause { start(): void; end(opts: { resume: boolean }): void; }
  export interface HoverPauseDeps {
    findVideo: () => HTMLVideoElement | null;
    resume: (v: HTMLVideoElement) => () => void;
  }
  export function createHoverPause(deps: HoverPauseDeps): HoverPause;
  ```

- [ ] **Step 1: 失敗するテストを書く** — `tests/hoverPause.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createHoverPause } from '../src/content/hoverPause';

/** play/pause と play イベントだけを持つ偽 video。 */
class FakeVideo extends EventTarget {
  paused: boolean;
  isConnected = true;
  constructor(playing: boolean) {
    super();
    this.paused = !playing;
  }
  pause(): void {
    this.paused = true;
  }
  play(): Promise<void> {
    this.paused = false;
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  }
}

function setup(video: FakeVideo | null) {
  const cancel = vi.fn();
  const resume = vi.fn((_v: HTMLVideoElement) => cancel);
  const hp = createHoverPause({
    findVideo: () => video as unknown as HTMLVideoElement | null,
    resume,
  });
  return { hp, resume, cancel };
}

describe('createHoverPause', () => {
  it('再生中なら start で止め、end(resume:true) で再開を依頼する', () => {
    const v = new FakeVideo(true);
    const { hp, resume } = setup(v);
    hp.start();
    expect(v.paused).toBe(true);
    hp.end({ resume: true });
    expect(resume).toHaveBeenCalledWith(v);
  });

  it('もともと停止中なら何もせず、end でも再開しない', () => {
    const v = new FakeVideo(false);
    const { hp, resume } = setup(v);
    hp.start();
    hp.end({ resume: true });
    expect(resume).not.toHaveBeenCalled();
  });

  it('end(resume:false) は再開せず、記録も消える', () => {
    const v = new FakeVideo(true);
    const { hp, resume } = setup(v);
    hp.start();
    hp.end({ resume: false });
    hp.end({ resume: true });
    expect(resume).not.toHaveBeenCalled();
    expect(v.paused).toBe(true);
  });

  it('止めたあとユーザーが再生したら、止め直しても end で再開しない', () => {
    const v = new FakeVideo(true);
    const { hp, resume } = setup(v);
    hp.start();
    void v.play(); // スペースキー等の手動再生
    v.pause(); // 手動で止め直す
    hp.end({ resume: true });
    expect(resume).not.toHaveBeenCalled();
  });

  it('start が続けて呼ばれても1回だけ止め、end で再開する', () => {
    const v = new FakeVideo(true);
    const pauseSpy = vi.spyOn(v, 'pause');
    const { hp, resume } = setup(v);
    hp.start();
    hp.start();
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    hp.end({ resume: true });
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('video が無ければ何もしない', () => {
    const { hp, resume } = setup(null);
    expect(() => hp.start()).not.toThrow();
    hp.end({ resume: true });
    expect(resume).not.toHaveBeenCalled();
  });

  it('video がページから外れていたら再開しない', () => {
    const v = new FakeVideo(true);
    const { hp, resume } = setup(v);
    hp.start();
    v.isConnected = false;
    hp.end({ resume: true });
    expect(resume).not.toHaveBeenCalled();
  });

  it('再開の直後にまた start したら、保留中の再開処理を取り消して止め直す', () => {
    const v = new FakeVideo(true);
    const { hp, resume, cancel } = setup(v);
    resume.mockImplementation((video: HTMLVideoElement) => {
      void video.play();
      return cancel;
    });
    hp.start();
    hp.end({ resume: true });
    expect(v.paused).toBe(false);
    hp.start();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(v.paused).toBe(true);
  });
});
```

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run tests/hoverPause.test.ts` → Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: 実装** — `src/content/hoverPause.ts`:

```ts
/**
 * 字幕ホバーで一時停止するための判断部品。
 *
 * 字幕枠にカーソルが入ったら（再生中なら）止め、ホバーが終わったら
 * 「この部品が止めた」場合だけ再開する。DOM 構造には依存せず、
 * video の取得と再開処理は外から受け取る（テストしやすくするため）。
 */
export interface HoverPause {
  /** 字幕枠にカーソルが入った。 */
  start(): void;
  /** ホバー状態が終わった。resume=false なら記録だけ消して再開しない。 */
  end(opts: { resume: boolean }): void;
}

export interface HoverPauseDeps {
  /** 本編 video を返す（無ければ null）。 */
  findVideo: () => HTMLVideoElement | null;
  /** 停止中の v を再生し直す。戻り値は保留中の再開処理を取り消す関数。 */
  resume: (v: HTMLVideoElement) => () => void;
}

export function createHoverPause(deps: HoverPauseDeps): HoverPause {
  // ホバーで止めた video。ユーザーが自分で再生したら（play イベント）忘れる。
  let pausedVideo: HTMLVideoElement | null = null;
  let cancelResume: (() => void) | null = null;

  const forget = (): void => {
    pausedVideo?.removeEventListener('play', forget);
    pausedVideo = null;
  };

  return {
    start() {
      // 外した直後にまた入った場合、保留中の再開（Prime ボタン押下）を止める。
      cancelResume?.();
      cancelResume = null;
      if (pausedVideo) return;
      const v = deps.findVideo();
      if (!v || v.paused) return; // もともと停止中なら触らない
      v.pause();
      pausedVideo = v;
      v.addEventListener('play', forget);
    },
    end({ resume }) {
      const v = pausedVideo;
      if (!v) return;
      forget(); // 自分の再開で play イベントが来る前に外しておく
      if (resume && v.paused && v.isConnected) cancelResume = deps.resume(v);
    },
  };
}
```

- [ ] **Step 4: 通過を確認** — Run: `npx vitest run tests/hoverPause.test.ts` → Expected: PASS（8件）

- [ ] **Step 5: コミット**

```bash
git add src/content/hoverPause.ts tests/hoverPause.test.ts
git commit -m "feat: 字幕ホバーで一時停止する判断部品を追加"
```

---

### Task 3: overlay から字幕ホバーの出入りを通知する

**Files:**
- Modify: `src/content/overlay.ts`（`OverlayCallbacks`、`onDocMouseDown`、`onKeyDown`、`clearLine`、`openPopup` 内の × ボタン、`hidePopup`、`attach`、`destroy`、戻り値の `hidePopup`）
- Test: `tests/overlay.test.ts`

**Interfaces:**
- Produces: `OverlayCallbacks` に任意プロパティを追加:
  ```ts
  onHoverStart?: () => void;
  onHoverEnd?: (opts: { resume: boolean }) => void;
  ```
  `Overlay.hidePopup(): void` の外部シグネチャは変えない。

- [ ] **Step 1: 失敗するテストを書く** — `tests/overlay.test.ts` の末尾に追記:

```ts
describe('createOverlay — 字幕ホバーの通知', () => {
  let overlay: Overlay | null = null;
  let starts: number;
  let ends: Array<{ resume: boolean }>;

  const subtitleEl = (): HTMLDivElement => shadow().querySelector<HTMLDivElement>('.subtitle')!;
  const enter = (): void => void subtitleEl().dispatchEvent(new MouseEvent('mouseenter'));
  const leave = (): void => void subtitleEl().dispatchEvent(new MouseEvent('mouseleave'));
  const open = (): void => void overlay!.openPopup(new DOMRect(0, 0, 10, 10), 'hello');

  beforeEach(() => {
    document.body.replaceChildren();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    starts = 0;
    ends = [];
    overlay = createOverlay(
      {
        ...noopCallbacks(),
        onHoverStart: () => void starts++,
        onHoverEnd: (o) => void ends.push(o),
      },
      { bottomPercent: 10, onBottomChange: () => {} },
    );
    overlay.renderLine('Hello there.', tokenizeLine('Hello there.'), 1);
  });

  afterEach(() => {
    overlay?.destroy();
    overlay = null;
  });

  it('字幕枠に入ると onHoverStart、出ると onHoverEnd({resume:true})', () => {
    enter();
    expect(starts).toBe(1);
    leave();
    expect(ends).toEqual([{ resume: true }]);
  });

  it('ポップアップが開いている間は字幕枠から出ても onHoverEnd を呼ばない', () => {
    enter();
    open();
    leave();
    expect(ends).toEqual([]);
  });

  it('枠外で×を押してポップアップを閉じると onHoverEnd({resume:true})', () => {
    enter();
    open();
    leave();
    shadow().querySelector<HTMLDivElement>('.popup .close')!.click();
    expect(ends).toEqual([{ resume: true }]);
  });

  it('枠外で Esc でポップアップを閉じると onHoverEnd({resume:true})', () => {
    enter();
    open();
    leave();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(ends).toEqual([{ resume: true }]);
  });

  it('枠内でポップアップを閉じたら通知せず、その後出たときに通知する', () => {
    enter();
    open();
    shadow().querySelector<HTMLDivElement>('.popup .close')!.click();
    expect(ends).toEqual([]);
    leave();
    expect(ends).toEqual([{ resume: true }]);
  });

  it('ポップアップの外側クリックで閉じると onHoverEnd({resume:false})', () => {
    enter();
    open();
    leave();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(ends).toEqual([{ resume: false }]);
  });

  it('clearLine では再開を通知しない（ポップアップ無し）', () => {
    enter();
    overlay!.clearLine();
    expect(ends).toEqual([]);
  });

  it('clearLine でポップアップが閉じても resume:false にとどめる', () => {
    enter();
    open();
    overlay!.clearLine();
    expect(ends).toEqual([{ resume: false }]);
  });

  it('ポップアップが無ければ hidePopup しても通知しない', () => {
    overlay!.hidePopup();
    expect(ends).toEqual([]);
  });
});
```

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run tests/overlay.test.ts` → Expected: 新規の describe が FAIL（`starts` が 0 のまま等）。型エラーで落ちる場合もある。

- [ ] **Step 3: 実装** — `src/content/overlay.ts` を次のとおり変更する。

(a) `OverlayCallbacks` の `onSeek` の後に追加:

```ts
  /** 字幕枠にカーソルが入ったとき（字幕ホバーで一時停止用）。 */
  onHoverStart?: () => void;
  /**
   * 字幕枠とポップアップのホバーが終わったとき。
   * resume=false はポップアップ外側のクリック等で閉じた場合（再開はユーザーに委ねる）。
   */
  onHoverEnd?: (opts: { resume: boolean }) => void;
```

(b) `let dragging = false;` の直後に追加:

```ts
  // 字幕枠の中にカーソルがあるか（字幕ホバーで一時停止用）。
  let inSubtitle = false;
```

(c) `onDocMouseDown` / `onKeyDown` を次に置き換える:

```ts
  const onDocMouseDown = (e: MouseEvent): void => {
    // シャドウ内（単語/ポップアップ）クリックは host にリターゲットされる。それ以外なら閉じる。
    // 外側クリックで閉じた場合は再生の再開をユーザーに委ねる（Prime は動画クリックで
    // 再生/停止が切り替わるので、こちらでも再開すると二重に切り替わる）。
    if (popup && e.target !== host) hidePopup(false);
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') hidePopup();
  };
```

(d) `clearLine` の先頭の `subtitle.hidden = true;` の直後に `inSubtitle = false;` を追加し、末尾の `hidePopup();` を `hidePopup(false);` に変える。コメントを添える:

```ts
  function clearLine(): void {
    subtitle.hidden = true;
    // 隠した字幕の上にはカーソルが居られない。ただし再開はしない
    // （停止中に字幕が消えた場合に再生と停止を繰り返さないため）。
    inSubtitle = false;
    original.replaceChildren();
    wordRefs = [];
    currentLineVideoTime = 0;
    setTranslation({ kind: 'none' });
    hidePopup(false);
  }
```

(e) `openPopup` 内の `close.addEventListener('click', hidePopup);` を次に変える（イベント引数が resume に渡らないようにする）:

```ts
    close.addEventListener('click', () => hidePopup());
```

(f) `hidePopup` を次に置き換える:

```ts
  /**
   * ポップアップを閉じる。実際に閉じた場合、カーソルが字幕枠の外ならホバー終了を通知する
   * （ポップアップが開いている間はホバー継続とみなしているため）。
   */
  function hidePopup(resume = true): void {
    popupGeneration++;
    const wasOpen = popup !== null;
    if (popup) {
      popup.remove();
      popup = null;
    }
    popupBody = null;
    popupIpa = null;
    popupSenses = null;
    popupAnchor = null;
    popupAudioUrl = null;
    clearHighlight();
    if (wasOpen && !inSubtitle) callbacks.onHoverEnd?.({ resume });
  }
```

(g) `// --- マウント & 全画面追従 ---` の直前に追加:

```ts
  // --- 字幕ホバー（一時停止用）---
  // ポップアップは字幕枠の外に出るので、開いている間はホバー継続とみなす。
  subtitle.addEventListener('mouseenter', () => {
    inSubtitle = true;
    callbacks.onHoverStart?.();
  });
  subtitle.addEventListener('mouseleave', () => {
    inSubtitle = false;
    if (!popup) callbacks.onHoverEnd?.({ resume: true });
  });
```

(h) `attach` 内の 2 か所の `hidePopup();` と `destroy` 内の `hidePopup();` を `hidePopup(false);` に変える（付け替え・破棄で勝手に再生しない）。

(i) 戻り値オブジェクトの `hidePopup,` を `hidePopup: () => hidePopup(),` に変える。

- [ ] **Step 4: 通過を確認** — Run: `npx vitest run tests/overlay.test.ts` → Expected: PASS（既存テストも含め全て）

- [ ] **Step 5: 型チェック** — Run: `npx tsc --noEmit` → Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
git add src/content/overlay.ts tests/overlay.test.ts
git commit -m "feat: 字幕枠とポップアップのホバー出入りを overlay から通知する"
```

---

### Task 4: 設定項目の追加と content script での接続

**Files:**
- Modify: `src/shared/types.ts`（`Settings`）、`src/shared/settings.ts`（`DEFAULT_SETTINGS`）
- Modify: `src/options/options.html`（`autoPause` の行の直後）、`src/options/options.ts`
- Modify: `src/content/index.ts`（import と `createOverlay` 呼び出し）
- Test: `tests/settings.test.ts`, `tests/options.test.ts`

**Interfaces:**
- Consumes: Task 1 `resumeVideo(v): () => void`、Task 2 `createHoverPause({ findVideo, resume })`、Task 3 `OverlayCallbacks.onHoverStart` / `onHoverEnd`
- Produces: `Settings.pauseOnSubtitleHover: boolean`

- [ ] **Step 1: 失敗するテストを書く**

`tests/settings.test.ts` の「defaults to truecasing on…」テストの後に追加:

```ts
  it('defaults to pausing while the cursor is over the subtitle', () => {
    expect(DEFAULT_SETTINGS.pauseOnSubtitleHover).toBe(true);
  });
```

`tests/options.test.ts` の `describe('options provider', …)` の末尾（最後の `it` の後）に追加:

```ts
  it('loads and saves the subtitle hover pause switch', async () => {
    await saveSettings({ pauseOnSubtitleHover: false });
    await start();
    expect(field('pauseOnHover').checked).toBe(false);
    field('pauseOnHover').checked = true;
    field('pauseOnHover').dispatchEvent(new Event('change'));
    await flush();
    expect((await getSettings()).pauseOnSubtitleHover).toBe(true);
  });
```

同ファイルの「shows no usage label on switches that do not consume the quota」の id 配列を `['truecaseSubtitle', 'autoPause', 'pauseOnHover']` に変える。

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run tests/settings.test.ts tests/options.test.ts` → Expected: FAIL（`pauseOnSubtitleHover` が undefined、`pauseOnHover` 要素が無い）

- [ ] **Step 3: 設定の実装**

`src/shared/types.ts` の `autoPauseOnClick` の後に:

```ts
  /** 動画上の字幕にカーソルを乗せている間は動画を一時停止する。 */
  pauseOnSubtitleHover: boolean;
```

`src/shared/settings.ts` の `DEFAULT_SETTINGS` の `autoPauseOnClick: true,` の後に:

```ts
  pauseOnSubtitleHover: true,
```

`src/options/options.html` の `autoPause` の `<div class="field row">…</div>` の直後に:

```html
    <div class="field row">
      <input id="pauseOnHover" type="checkbox" />
      <label for="pauseOnHover">字幕にカーソルを乗せている間は一時停止（無料・即時）</label>
    </div>
```

`src/options/options.ts`:
- `const autoPause = el<HTMLInputElement>('autoPause');` の後に `const pauseOnHover = el<HTMLInputElement>('pauseOnHover');`
- `autoPause.checked = s.autoPauseOnClick;` の後に `pauseOnHover.checked = s.pauseOnSubtitleHover;`
- `persist` の `autoPauseOnClick: autoPause.checked,` の後に `pauseOnSubtitleHover: pauseOnHover.checked,`
- `change` を購読する配列の `autoPause,` の後に `pauseOnHover,` を追加

- [ ] **Step 4: 通過を確認** — Run: `npx vitest run tests/settings.test.ts tests/options.test.ts` → Expected: PASS

- [ ] **Step 5: content script で接続**

`src/content/index.ts`:
- import を `import { findVideo, pauseVideo, resumeVideo, seekVideo } from './videoControl';` に変え、`import { createHoverPause } from './hoverPause';` を追加。
- `let overlay!: Overlay;` の直前に:

```ts
  // 字幕ホバーで一時停止（設定 OFF なら null で、通知は何もしない）。
  const hoverPause = settings.pauseOnSubtitleHover
    ? createHoverPause({ findVideo, resume: resumeVideo })
    : null;
```

- `createOverlay` の第1引数の `onSeek: seekVideo,` の後に:

```ts
      onHoverStart: () => hoverPause?.start(),
      onHoverEnd: (opts) => hoverPause?.end(opts),
```

- [ ] **Step 6: 型チェック** — Run: `npx tsc --noEmit` → Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add src/shared/types.ts src/shared/settings.ts src/options/options.html src/options/options.ts src/content/index.ts tests/settings.test.ts tests/options.test.ts
git commit -m "feat: 字幕にカーソルを乗せている間は動画を一時停止する設定を追加"
```

---

## 最終確認（全タスク後）

- [ ] `npx vitest run tests/videoControl.test.ts tests/hoverPause.test.ts tests/overlay.test.ts tests/settings.test.ts tests/options.test.ts` → PASS
- [ ] `npx tsc --noEmit` → エラーなし
- [ ] `npm run build` を 1 回だけ実行し、worktree の `dist/` を生成
- [ ] 実機確認はユーザーに依頼（worktree の `dist/` を Load unpacked、または main マージ後に通常の拡張で ↻＋F5）
