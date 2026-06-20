# 動画切り替え時に字幕履歴をリセット Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Amazon プライムで別の作品・エピソードに切り替えたときだけ字幕履歴パネルを全消去し、広告では誤って消さないようにする。

**Architecture:** 「作品が切り替わったか」を純粋関数 `createTitleSwitchDetector`（URL 由来の作品コード＋本編の尺、どちらかが変われば切替＝両方とも非破壊シグナル）で判定する。履歴パネルに全消去 `clear()` を新設し、`content/index.ts` で切替検出時に `clear()`＋記録位置リセットを呼ぶ。既存の読み込みイベント由来 `recorder.reset()`（無害なフロンティア初期化）は温存する純粋追加。

**Tech Stack:** TypeScript / Chrome 拡張(MV3) / esbuild バンドル / Vitest(+ jsdom)。

---

## 設計ドキュメント

`docs/superpowers/specs/2026-06-19-reset-history-on-video-switch-design.md`

## ファイル構成

- **新規** `src/content/contentIdentity.ts` … 純粋ロジック。`extractContentId(href)` と
  `createTitleSwitchDetector()`。DOM/`location` には触れない（呼び出し側が値を渡す）。
- **新規** `tests/contentIdentity.test.ts` … 上記の単体テスト（node 環境）。
- **修正** `src/content/transcriptPanel.ts` … 公開APIに `clear()` を追加。
- **修正** `tests/transcriptPanel.test.ts` … `clear()` の単体テスト（jsdom）を追記。
- **修正** `src/content/index.ts` … 検出器を配線。切替時に `panel.clear()`＋`recorder.reset()`。
- **不要** `build.mjs` … エントリ `content/index.ts` から `contentIdentity.ts` を import するので
  esbuild が自動でバンドルする。ビルド設定の変更は不要。

---

## Task 0: ブランチ作成と設計/計画ドキュメントのコミット

**Files:**
- Commit: `docs/superpowers/specs/2026-06-19-reset-history-on-video-switch-design.md`
- Commit: `docs/superpowers/plans/2026-06-19-reset-history-on-video-switch.md`

- [ ] **Step 1: フィーチャーブランチを作成（main 作業ディレクトリで。worktree は使わない）**

Run:
```bash
git checkout -b fix/reset-history-on-video-switch
```
Expected: `Switched to a new branch 'fix/reset-history-on-video-switch'`

- [ ] **Step 2: 設計・計画ドキュメントをコミット**

```bash
git add docs/superpowers/specs/2026-06-19-reset-history-on-video-switch-design.md \
        docs/superpowers/plans/2026-06-19-reset-history-on-video-switch.md
git commit -m "docs: 動画切替で字幕履歴をリセットする設計と実装計画を追加" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
Expected: 2 files committed.

---

## Task 1: `extractContentId` — URL から作品コードを取り出す（純粋）

**Files:**
- Create: `src/content/contentIdentity.ts`
- Test: `tests/contentIdentity.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

Create `tests/contentIdentity.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { extractContentId } from '../src/content/contentIdentity';

describe('extractContentId — URL から作品コードを取り出す', () => {
  it('GTI を含む URL はその GTI を返す（クエリ・ref は無視）', () => {
    expect(
      extractContentId(
        'https://www.amazon.co.jp/gp/video/detail/amzn1.dv.gti.abc123/ref=foo?autoplay=1',
      ),
    ).toBe('amzn1.dv.gti.abc123');
  });

  it('detail パスの ASIN を返す（クエリ・ref は無視）', () => {
    expect(
      extractContentId(
        'https://www.amazon.co.jp/gp/video/detail/B0ABCDEFGH/ref=atv_dp?autoplay=1&t=120',
      ),
    ).toBe('B0ABCDEFGH');
  });

  it('/dp/ パスの ASIN を返す', () => {
    expect(extractContentId('https://www.amazon.co.jp/dp/B0ZZZZ1234')).toBe('B0ZZZZ1234');
  });

  it('同一作品でクエリ・ハッシュだけ違う URL は同じ id になる', () => {
    const a = extractContentId('https://www.amazon.co.jp/gp/video/detail/B0ABCDEFGH/ref=a?t=1');
    const b = extractContentId('https://www.amazon.co.jp/gp/video/detail/B0ABCDEFGH/ref=b?t=999#x');
    expect(a).toBe(b);
    expect(a).toBe('B0ABCDEFGH');
  });

  it('作品コードを含まない URL は空文字を返す', () => {
    expect(extractContentId('https://www.amazon.co.jp/gp/video/storefront')).toBe('');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- contentIdentity`
Expected: FAIL（`extractContentId` が存在しない／モジュール未解決）。

- [ ] **Step 3: 最小実装を書く**

Create `src/content/contentIdentity.ts`:
```ts
/**
 * Prime Video の「いま見ている作品」を見分ける純粋ロジック。
 *
 * 動画を切り替えたら字幕履歴を全消去したいが、Prime は広告・プレビュー用に複数の
 * <video> を持ち、生のメディアイベントは広告でも発火する。広告で履歴を誤って消さない
 * よう、「作品が本当に変わったか」を URL 由来の作品コードと本編の尺（duration）という
 * 2つの非破壊シグナルの論理和で判定する。どちらの取りこぼしも「消えないだけ」で、
 * 誤消去は構造的に起こさない。
 */

/**
 * URL から Prime の安定した作品コードを取り出す。取れなければ ''（空文字）。
 * クエリ・ref・ハッシュ等の揺れは含めない（同一作品内の URL 微変化で誤判定しない）。
 */
export function extractContentId(href: string): string {
  // 1) GTI（エピソード単位で最も精密）: amzn1.dv.gti.<token>
  const gti = href.match(/amzn1\.dv\.gti\.[A-Za-z0-9-]+/);
  if (gti) return gti[0];
  // 2) ASIN: /gp/video/detail/<id> | /detail/<id> | /dp/<id> のパス位置のトークン
  const asin = href.match(/\/(?:gp\/video\/detail|detail|dp)\/([A-Za-z0-9]{6,})/);
  if (asin) return asin[1];
  return '';
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- contentIdentity`
Expected: PASS（5 件）。

- [ ] **Step 5: コミット**

```bash
git add src/content/contentIdentity.ts tests/contentIdentity.test.ts
git commit -m "feat: URL から Prime の作品コードを取り出す extractContentId を追加" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `createTitleSwitchDetector` — 作品切替の判定（純粋）

**Files:**
- Modify: `src/content/contentIdentity.ts`（追記）
- Test: `tests/contentIdentity.test.ts`（追記）

- [ ] **Step 1: 失敗するテストを追記**

`tests/contentIdentity.test.ts` の import を更新し、describe ブロックを追記する。

import 行を次へ置き換え:
```ts
import { extractContentId, createTitleSwitchDetector } from '../src/content/contentIdentity';
```

ファイル末尾に追記:
```ts
describe('createTitleSwitchDetector — 作品切替の判定', () => {
  const movie = (id: string, durationRaw: number) => ({ id, durationRaw });

  it('初回は基準確立のみで false（起動直後に消さない）', () => {
    const d = createTitleSwitchDetector();
    expect(d.check(movie('B0A', 2520))).toBe(false);
  });

  it('同じ id・同じ尺なら false（同一作品の通常再生）', () => {
    const d = createTitleSwitchDetector();
    d.check(movie('B0A', 2520));
    expect(d.check(movie('B0A', 2520))).toBe(false);
  });

  it('id が変われば true（別作品・別エピソード）', () => {
    const d = createTitleSwitchDetector();
    d.check(movie('B0A', 2520));
    expect(d.check(movie('B0B', 2520))).toBe(true);
  });

  it('尺が閾値を超えて変わると true（URL が変わらない切替の backstop）', () => {
    const d = createTitleSwitchDetector();
    d.check(movie('B0A', 2520));
    expect(d.check(movie('B0A', 1800))).toBe(true);
  });

  it('短い尺（広告）は尺シグナルとして無視し、誤発火しない', () => {
    const d = createTitleSwitchDetector();
    d.check(movie('B0A', 2520)); // 本編の基準
    expect(d.check(movie('B0A', 30))).toBe(false); // 広告(30秒) → 無視
    expect(d.check(movie('B0A', 2520))).toBe(false); // 本編へ復帰 → 消さない
  });

  it('duration が NaN / Infinity のときは尺シグナルを無視する', () => {
    const d = createTitleSwitchDetector();
    d.check(movie('B0A', 2520));
    expect(d.check(movie('B0A', NaN))).toBe(false);
    expect(d.check(movie('B0A', Infinity))).toBe(false);
  });

  it('id が空文字なら良い基準を上書きせず、単独で切替判定もしない', () => {
    const d = createTitleSwitchDetector();
    d.check(movie('B0A', 2520)); // 基準 id=B0A
    expect(d.check(movie('', 2520))).toBe(false); // id 取れず → 消さない
    expect(d.check(movie('B0B', 2520))).toBe(true); // 基準は B0A のまま → B0B で切替
  });

  it('尺差が許容閾値内（微小ゆらぎ）なら false', () => {
    const d = createTitleSwitchDetector({ durationToleranceSeconds: 1 });
    d.check(movie('B0A', 2520));
    expect(d.check(movie('B0A', 2520.4))).toBe(false);
  });

  it('id が無くても尺だけで切替を拾える（非破壊の backstop）', () => {
    const d = createTitleSwitchDetector();
    d.check(movie('', 2520)); // id 無し、尺で基準
    expect(d.check(movie('', 2520))).toBe(false);
    expect(d.check(movie('', 1500))).toBe(true); // 別尺 → 切替
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- contentIdentity`
Expected: FAIL（`createTitleSwitchDetector` が存在しない）。

- [ ] **Step 3: 最小実装を追記**

`src/content/contentIdentity.ts` の末尾に追記:
```ts
export interface TitleSwitchInput {
  /** extractContentId(location.href) の結果。取れなければ ''。 */
  id: string;
  /** 本編 video の duration（秒）。未ロードは NaN、ライブは Infinity でよい。 */
  durationRaw: number;
}

export interface TitleSwitchDetector {
  /** 作品が切り替わったと判定したら true（＝履歴を消すべき）。基準も更新する。 */
  check(input: TitleSwitchInput): boolean;
}

export interface TitleSwitchOptions {
  /** 本編とみなす最低尺（秒）。これ未満の duration は尺シグナルとして無視。既定 300。 */
  minTitleSeconds?: number;
  /** 尺が「変わった」とみなす差の閾値（秒）。微小ゆらぎを吸収。既定 1。 */
  durationToleranceSeconds?: number;
}

/**
 * 直近の作品コード・本編尺を保持し、「id 変化」または「尺が閾値以上の別値へ変化」で
 * 切替（true）と判定する。短尺（広告）・NaN・Infinity の尺は無視。初回は基準確立のみ。
 */
export function createTitleSwitchDetector(opts: TitleSwitchOptions = {}): TitleSwitchDetector {
  const minTitleSeconds = opts.minTitleSeconds ?? 300;
  const tol = opts.durationToleranceSeconds ?? 1;

  let lastId: string | null = null;
  let lastDuration: number | null = null;

  return {
    check({ id, durationRaw }: TitleSwitchInput): boolean {
      // 本編とみなせる尺だけを尺シグナルとして採用（広告・短尺・未ロードは除外）。
      const qualifies = Number.isFinite(durationRaw) && durationRaw >= minTitleSeconds;
      const effDur = qualifies ? durationRaw : null;

      const hasBaseline = lastId !== null || lastDuration !== null;
      const idChanged = id !== '' && lastId !== null && id !== lastId;
      const durChanged =
        effDur !== null && lastDuration !== null && Math.abs(effDur - lastDuration) > tol;
      const switched = hasBaseline && (idChanged || durChanged);

      // 基準更新: 空文字は良い基準を上書きしない／短尺・NaN は尺基準を上書きしない。
      if (id !== '') lastId = id;
      if (effDur !== null) lastDuration = effDur;

      return switched;
    },
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- contentIdentity`
Expected: PASS（14 件＝extractContentId 5＋detector 9）。

- [ ] **Step 5: コミット**

```bash
git add src/content/contentIdentity.ts tests/contentIdentity.test.ts
git commit -m "feat: 作品切替を判定する createTitleSwitchDetector を追加（広告は無視）" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 履歴パネルに `clear()`（全消去）を追加

**Files:**
- Modify: `src/content/transcriptPanel.ts`
- Test: `tests/transcriptPanel.test.ts`（追記）

- [ ] **Step 1: 失敗するテストを追記**

`tests/transcriptPanel.test.ts` の末尾に describe ブロックを追記:
```ts
describe('createTranscriptPanel — clear() で履歴を全消去', () => {
  let panel: TranscriptPanel | null = null;

  beforeEach(() => {
    document.body.replaceChildren();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
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

  it('clear() で全ての行が消える', () => {
    panel = createTranscriptPanel({ onSeek: () => {} });
    panel.append({ id: 1, english: 'A', videoTime: 1 });
    panel.append({ id: 2, english: 'B', videoTime: 2 });
    expect(rowsOf()).toHaveLength(2);

    panel.clear();
    expect(rowsOf()).toHaveLength(0);
  });

  it('clear() 後の updateActiveByTime は何もせず例外を出さない', () => {
    panel = createTranscriptPanel({ onSeek: () => {} });
    panel.append({ id: 1, english: 'A', videoTime: 10 });
    panel.clear();
    expect(() => panel!.updateActiveByTime(50)).not.toThrow();
    expect(rowsOf().filter((r) => r.classList.contains('active'))).toHaveLength(0);
  });

  it('clear() 後に append すると新しい行が先頭になる', () => {
    panel = createTranscriptPanel({ onSeek: () => {} });
    panel.append({ id: 1, english: 'OLD', videoTime: 1000 });
    panel.clear();
    panel.append({ id: 2, english: 'NEW', videoTime: 3 });

    const rows = rowsOf();
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('NEW');
    expect(rows[0].textContent).not.toContain('OLD');
  });

  it('clear() 後に旧 id へ setTranslation しても無視され例外を出さない（遅延翻訳の混入防止）', () => {
    panel = createTranscriptPanel({ onSeek: () => {} });
    panel.append({ id: 1, english: 'OLD', videoTime: 1 });
    panel.clear();
    expect(() => panel!.setTranslation(1, '遅れて来た翻訳')).not.toThrow();
    const host = document.getElementById(HOST_ID);
    expect(host!.shadowRoot!.textContent).not.toContain('遅れて来た翻訳');
  });

  it('ホバーカードが開いている状態で clear() すると閉じる', async () => {
    vi.useFakeTimers();
    panel = createTranscriptPanel({
      onSeek: () => {},
      onExplain: async () => ({ ok: true, translation: 'x', explanation: 'y' }),
    });
    panel.append({ id: 1, english: 'Hello', videoTime: 1 });
    rowsOf()[0].dispatchEvent(new Event('mouseenter'));
    await vi.advanceTimersByTimeAsync(500);
    expect(popup()).not.toBeNull();

    panel.clear();
    expect(popup()).toBeNull();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- transcriptPanel`
Expected: FAIL（`panel.clear is not a function` 等）。

- [ ] **Step 3: 最小実装**

`src/content/transcriptPanel.ts` の `TranscriptPanel` インターフェースに `clear` を追加する。

置換前:
```ts
export interface TranscriptPanel {
  append(entry: TranscriptEntry): void;
  setTranslation(id: number, japanese: string): void;
  /** 動画の現在再生位置（秒）から、いま再生中の行を判定して .active を付け替える。 */
  updateActiveByTime(currentTime: number): void;
  destroy(): void;
}
```
置換後:
```ts
export interface TranscriptPanel {
  append(entry: TranscriptEntry): void;
  setTranslation(id: number, japanese: string): void;
  /** 動画の現在再生位置（秒）から、いま再生中の行を判定して .active を付け替える。 */
  updateActiveByTime(currentTime: number): void;
  /** 履歴を全消去する（別作品・別エピソードへ切り替えたときに呼ぶ）。 */
  clear(): void;
  destroy(): void;
}
```

次に `clear` 関数を `updateActiveByTime` 関数の直後（`// --- マウント & 全画面追従 ---` コメントの直前）に追加する:
```ts
  // 履歴を全消去する（別作品・別エピソードへの切り替え時に呼ぶ）。行・対応表・
  // アクティブ行・追従状態を初期化し、開いていればホバーカードも閉じる。
  function clear(): void {
    hideHoverPopup(); // 消える行を指したままのカードを残さない
    list.replaceChildren();
    rows.length = 0;
    jaById.clear();
    activeRow = null;
    following = true; // 新しい作品は最下部へ追従させる
    lastAutoScrollTop = -1;
  }
```

最後に return 文へ `clear` を追加する。

置換前:
```ts
  return { append, setTranslation, updateActiveByTime, destroy };
```
置換後:
```ts
  return { append, setTranslation, updateActiveByTime, clear, destroy };
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- transcriptPanel`
Expected: PASS（既存＋追記 5 件）。

- [ ] **Step 5: 全テストと型チェック**

Run: `npm test && npm run typecheck`
Expected: 全 PASS、型エラー無し。

- [ ] **Step 6: コミット**

```bash
git add src/content/transcriptPanel.ts tests/transcriptPanel.test.ts
git commit -m "feat: 履歴パネルに全消去 clear() を追加" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `content/index.ts` に検出器を配線

**Files:**
- Modify: `src/content/index.ts`

index.ts は拡張のエントリ（`void main()`）で単体テストの対象外のため、型チェック＋ビルド＋実機確認で検証する。

- [ ] **Step 1: import を追加**

`src/content/index.ts` の import 群に追加する。

置換前:
```ts
import { findVideo, seekVideo } from './videoControl';
```
置換後:
```ts
import { findVideo, seekVideo } from './videoControl';
import { extractContentId, createTitleSwitchDetector } from './contentIdentity';
```

- [ ] **Step 2: 検出器の生成と判定関数を追加、読み込みイベント処理を差し替え**

置換前（現状の 42-55 行付近）:
```ts
  let entryId = 0;

  // 履歴への重複記録を防ぐ記録ポリシー。履歴クリックや再生バーで過去へ巻き戻して
  // 記録済み範囲を再生し直す間は記録せず、記録済み地点を追い越したら記録を再開する。
  const recorder = createTranscriptRecorder();
  if (panel) {
    // 動画の読み込み（エピソード切替など）を検知してフロンティアを初期化し、
    // 新しい動画を時刻 0 付近から記録できるようにする。メディアイベントはバブリング
    // しないため document のキャプチャ段で受ける。
    const resetRecorder = (): void => recorder.reset();
    for (const ev of ['loadstart', 'emptied', 'durationchange'] as const) {
      document.addEventListener(ev, resetRecorder, true);
    }
  }
```
置換後:
```ts
  let entryId = 0;

  // 履歴への重複記録を防ぐ記録ポリシー。履歴クリックや再生バーで過去へ巻き戻して
  // 記録済み範囲を再生し直す間は記録せず、記録済み地点を追い越したら記録を再開する。
  const recorder = createTranscriptRecorder();
  // 別作品・別エピソードへの切り替えを見分ける検出器（URL の作品コード＋本編の尺）。
  // 広告では発火しない（id も本編の尺も変わらない）ので、広告で履歴を誤って消さない。
  const titleSwitch = createTitleSwitchDetector();

  // 作品が本当に切り替わったときだけ履歴を全消去し、記録位置も初期化する。
  const maybeResetForNewTitle = (): void => {
    if (!panel) return;
    const switched = titleSwitch.check({
      id: extractContentId(location.href),
      durationRaw: findVideo()?.duration ?? NaN,
    });
    if (switched) {
      panel.clear();
      recorder.reset();
    }
  };

  if (panel) {
    // 動画の読み込み（エピソード切替など）を検知。フロンティアは従来どおり常に初期化し
    // （新しい動画を時刻 0 付近から記録できるように）、加えて作品が本当に変わったかを
    // 判定して履歴を全消去する。メディアイベントはバブリングしないため document の
    // キャプチャ段で受ける。
    const handleMediaLoad = (): void => {
      recorder.reset();
      maybeResetForNewTitle();
    };
    for (const ev of ['loadstart', 'emptied', 'durationchange'] as const) {
      document.addEventListener(ev, handleMediaLoad, true);
    }
  }
```

- [ ] **Step 3: 字幕観測コールバックの先頭で切替判定を呼ぶ**

置換前:
```ts
  startCaptionObserver((raw) => {
    if (raw === null) {
      currentText = '';
      overlay.clearLine();
      return;
    }
```
置換後:
```ts
  startCaptionObserver((raw) => {
    // 記録の前に作品切替を判定する。切り替わっていれば履歴を空にしてから進むので、
    // 新作品の最初の字幕が履歴の先頭行になる。
    maybeResetForNewTitle();
    if (raw === null) {
      currentText = '';
      overlay.clearLine();
      return;
    }
```

- [ ] **Step 4: 型チェックとビルド**

Run: `npm run typecheck && npm run build`
Expected: 型エラー無し、`dist/` にビルド成功。

- [ ] **Step 5: 全テスト**

Run: `npm test`
Expected: 全 PASS。

- [ ] **Step 6: コミット**

```bash
git add src/content/index.ts
git commit -m "feat: 動画切替を検知して字幕履歴を全消去（広告では消さない）" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 実機確認（手動）

**反映手順:** `npm run dev`（watch ビルド）→ Chrome の拡張管理で本拡張を再読み込み（↻）→ Prime のページを再読み込み（F5）。MV3 仕様で拡張↻とページF5の両方が必要。

- [ ] **確認1（基本）:** 作品Aを数行ぶん視聴して履歴が並ぶ → 別作品B（または次のエピソード）へ切り替える →
  **履歴が空になり、Bの字幕だけが時刻0付近から並ぶ**こと。
- [ ] **確認2（巻き戻し回帰）:** 同一作品の途中で履歴行クリックや再生バーで巻き戻す →
  **履歴は消えず、重複も増えない**こと（既存挙動の維持）。
- [ ] **確認3（広告。広告ありプランの場合のみ）:** 本編途中で広告が入る →
  広告中・広告明けで**履歴が消えない**こと。広告が無いプランならこの確認はスキップ。
- [ ] **確認4（同一作品の見直し）:** 同じエピソードを最初から見直す → 履歴は残る（妥当）。

---

## Self-Review（計画作成者による確認結果）

- **Spec coverage:** clear() 新設＝Task 3 / 切替検出（URL＋尺・広告無視・初回非発火）＝Task 1,2 /
  index.ts 配線（記録前判定・読み込みイベント・フロンティア温存・entryId 連番維持）＝Task 4 /
  手動確認（基本・広告・巻き戻し・見直し）＝Task 5。spec の各節に対応タスクあり。
- **Placeholder scan:** TBD/TODO 無し。全ステップに実コードと実コマンドを記載。
- **Type consistency:** `extractContentId(href: string): string`、
  `createTitleSwitchDetector(opts?): TitleSwitchDetector`、`check({id, durationRaw}): boolean`、
  `TranscriptPanel.clear(): void` を Task 1–4 で一貫使用。index.ts の呼び出し
  `titleSwitch.check({ id, durationRaw })` は定義と一致。
