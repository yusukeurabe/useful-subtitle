# いま再生中の字幕マーカー 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 字幕履歴パネルで、動画の現在再生位置に対応する行を「左の青バー＋淡い青背景」でハイライトし、賢く追従スクロールする。

**Architecture:** パネル（`transcriptPanel.ts`）が各行の `videoTime` を内部配列で保持し、`updateActiveByTime(currentTime)` で現在行を線形走査して `.active` クラスを付け替える。`index.ts` が `timeupdate` / `seeked` / 字幕追加後に現在時刻を渡して呼ぶ。追従スクロールはプログラム由来のスクロールを無視し、手動スクロール時はアクティブ行が可視 or 最下部付近のときだけ追従を再開する。

**Tech Stack:** TypeScript / esbuild / vitest v4.1.9（jsdom 環境）。Chrome 拡張のコンテンツスクリプト。

設計の出典: `docs/superpowers/specs/2026-06-18-current-subtitle-marker-design.md`

---

## ファイル構成

- **Modify** `src/content/transcriptPanel.ts`
  - `.row.active` のスタイル追加
  - `TranscriptPanel` インターフェイスに `updateActiveByTime(currentTime: number): void` を追加
  - 行ごとの `videoTime` を保持する内部配列、現在行の判定、`.active` の付け替え
  - 賢い追従スクロール（スクロール監視・プログラム/手動の判別・追従可否）
  - 追従可否の純粋関数 `nextFollowState` を新規 export
- **Modify** `src/content/index.ts`
  - `timeupdate` / `seeked` を `document` キャプチャ段で購読し、字幕追加直後にも、`panel.updateActiveByTime(currentTime)` を呼ぶ配線
- **Modify** `tests/transcriptPanel.test.ts`
  - 現在行ハイライトのテスト（境界含む）と `nextFollowState` のテストを追加

---

## Task 1: 現在行ハイライト（`.active` の判定と付け替え）

動画の現在時刻から「いま再生中の行」を判定し、その行だけに `.active` を付ける。見た目は左の青バー＋淡い青背景。追従スクロールは Task 2 で足すので、ここでは **クラスの付け替えのみ**。

**Files:**
- Modify: `src/content/transcriptPanel.ts`
- Test: `tests/transcriptPanel.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`tests/transcriptPanel.test.ts` の末尾（最後の `describe` の後）に、以下の describe ブロックを追加する。ファイル冒頭の import 群はそのまま使える（`createTranscriptPanel`, `HOST_ID` は既存）。

```typescript
describe('createTranscriptPanel — 現在再生行のハイライト', () => {
  let panel: TranscriptPanel | null = null;

  beforeEach(() => {
    document.body.replaceChildren();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  });

  afterEach(() => {
    panel?.destroy();
    panel = null;
  });

  /** shadow DOM 内の行要素を取得する。 */
  function rowsOf(): HTMLDivElement[] {
    const host = document.getElementById(HOST_ID);
    return Array.from(host!.shadowRoot!.querySelectorAll<HTMLDivElement>('.row'));
  }

  /** videoTime の配列から行をまとめて追加する。 */
  function appendRows(p: TranscriptPanel, times: number[]): void {
    times.forEach((t, i) => p.append({ id: i + 1, english: `line ${i + 1}`, videoTime: t }));
  }

  /** active が付いている行のインデックス（無ければ -1）。 */
  function activeIndex(): number {
    return rowsOf().findIndex((r) => r.classList.contains('active'));
  }

  it('最初の行の videoTime より前の時刻ではどの行も active にならない', () => {
    panel = createTranscriptPanel({ onSeek: () => {} });
    appendRows(panel, [10, 20, 30]);
    panel.updateActiveByTime(5);
    expect(activeIndex()).toBe(-1);
  });

  it('行と行の間の時刻では「videoTime が現在時刻以下で最大の行」が active になる', () => {
    panel = createTranscriptPanel({ onSeek: () => {} });
    appendRows(panel, [10, 20, 30]);
    panel.updateActiveByTime(25);
    expect(activeIndex()).toBe(1);
  });

  it('ちょうど境界の時刻ではその行が active になる', () => {
    panel = createTranscriptPanel({ onSeek: () => {} });
    appendRows(panel, [10, 20, 30]);
    panel.updateActiveByTime(20);
    expect(activeIndex()).toBe(1);
  });

  it('最後の行以降の時刻では最後の行が active になる', () => {
    panel = createTranscriptPanel({ onSeek: () => {} });
    appendRows(panel, [10, 20, 30]);
    panel.updateActiveByTime(100);
    expect(activeIndex()).toBe(2);
  });

  it('巻き戻すと active が前の行へ戻り、active は常に1行だけ', () => {
    panel = createTranscriptPanel({ onSeek: () => {} });
    appendRows(panel, [10, 20, 30]);
    panel.updateActiveByTime(100);
    expect(activeIndex()).toBe(2);

    panel.updateActiveByTime(15);
    expect(activeIndex()).toBe(0);
    expect(rowsOf().filter((r) => r.classList.contains('active'))).toHaveLength(1);
  });

  it('履歴が空でも updateActiveByTime は何もせず例外を出さない', () => {
    panel = createTranscriptPanel({ onSeek: () => {} });
    expect(() => panel!.updateActiveByTime(50)).not.toThrow();
    expect(activeIndex()).toBe(-1);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run tests/transcriptPanel.test.ts`
Expected: 新規6テストが FAIL（`panel.updateActiveByTime is not a function` 系のエラー）。既存テストは PASS のまま。

- [ ] **Step 3: インターフェイスに `updateActiveByTime` を追加する**

`src/content/transcriptPanel.ts` の `TranscriptPanel` インターフェイスへ1行追加する。

```typescript
export interface TranscriptPanel {
  append(entry: TranscriptEntry): void;
  setTranslation(id: number, japanese: string): void;
  /** 動画の現在再生位置（秒）から、いま再生中の行を判定して .active を付け替える。 */
  updateActiveByTime(currentTime: number): void;
  destroy(): void;
}
```

- [ ] **Step 4: `.row.active` のスタイルを追加する**

`STYLES` 内の `.row:hover { ... }` の直後に、以下を追加する。`box-shadow: inset` で左バーを描くことで、`border-left` のようにテキストがずれない。

```css
.row.active {
  background: rgba(86, 156, 255, 0.14);
  box-shadow: inset 4px 0 0 #569cff;
}
```

- [ ] **Step 5: 行データの保持と現在行判定を実装する**

`createTranscriptPanel` 内、`const jaById = new Map<number, HTMLDivElement>();` の直後に、行の内部配列・現在行参照・許容誤差を追加する。

```typescript
  const jaById = new Map<number, HTMLDivElement>();
  // 行と videoTime の対応を追加順に保持する（現在行判定に使う）。
  const rows: { videoTime: number; el: HTMLDivElement }[] = [];
  // いま .active が付いている行（無ければ null）。
  let activeRow: HTMLDivElement | null = null;
  // 再生時刻の読み取りと記録時刻のわずかなずれを吸収する許容誤差（秒）。
  const ACTIVE_EPSILON = 0.25;
```

`append` 内で、`jaById.set(entry.id, ja);` の直後に行を配列へ push する。

```typescript
    jaById.set(entry.id, ja);
    rows.push({ videoTime: entry.videoTime, el: row });
    list.scrollTop = list.scrollHeight;
```

`setTranslation` 関数の直後（`destroy` の前）に `updateActiveByTime` を実装する。

```typescript
  function updateActiveByTime(currentTime: number): void {
    // 「videoTime <= currentTime（+許容誤差）を満たす行のうち videoTime 最大の行」を現在行とする。
    // タイが出たら後から追加された行（id が後）を優先する（>= で上書き）。
    let next: HTMLDivElement | null = null;
    let bestTime = -Infinity;
    for (const r of rows) {
      if (r.videoTime <= currentTime + ACTIVE_EPSILON && r.videoTime >= bestTime) {
        bestTime = r.videoTime;
        next = r.el;
      }
    }
    if (next === activeRow) return;
    activeRow?.classList.remove('active');
    next?.classList.add('active');
    activeRow = next;
  }
```

最後に、返り値オブジェクトへ `updateActiveByTime` を加える。

```typescript
  return { append, setTranslation, updateActiveByTime, destroy };
```

- [ ] **Step 6: テストを実行して成功を確認する**

Run: `npx vitest run tests/transcriptPanel.test.ts`
Expected: 全テスト PASS（既存 + 新規6）。

- [ ] **Step 7: 型チェックとフルテスト**

Run: `npx tsc --noEmit && npm test`
Expected: 型エラー無し。全テスト PASS。

- [ ] **Step 8: コミットする**

```bash
git add src/content/transcriptPanel.ts tests/transcriptPanel.test.ts
git commit -m "$(cat <<'EOF'
feat: 字幕履歴に現在再生行のハイライトを追加

動画の現在再生位置から該当する履歴行を判定し、左の青バー＋淡い青背景で
ハイライトする updateActiveByTime を追加。境界（最初の行より前／巻き戻し／
履歴空／ちょうど境界時刻）を含むテストを追加。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 賢い追従スクロール

アクティブ行が変わったらその行を見える位置へスクロールする。ただしユーザーが手動でスクロール中は追従を止め、アクティブ行が再び可視範囲に入るか最下部付近へ戻したら再開する。DOM のレイアウト測定は jsdom では再現できないため、追従可否の判断ロジックを純粋関数 `nextFollowState` に切り出して単体テストする。スクロールの実測部分はブラウザでの手動確認とする。

**Files:**
- Modify: `src/content/transcriptPanel.ts`
- Test: `tests/transcriptPanel.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`tests/transcriptPanel.test.ts` 冒頭の import に `nextFollowState` を加える。

```typescript
import { createTranscriptPanel, nextFollowState, type TranscriptPanel } from '../src/content/transcriptPanel';
```

ファイル末尾に、純粋関数のテストを追加する。

```typescript
describe('nextFollowState — 追従可否の判定', () => {
  it('プログラム由来のスクロールは無視し、直前の追従状態を保つ', () => {
    expect(
      nextFollowState({ wasFollowing: true, isProgrammatic: true, activeRowVisible: false, nearBottom: false }),
    ).toBe(true);
    expect(
      nextFollowState({ wasFollowing: false, isProgrammatic: true, activeRowVisible: true, nearBottom: true }),
    ).toBe(false);
  });

  it('手動スクロール時はアクティブ行が見えていれば追従を再開する', () => {
    expect(
      nextFollowState({ wasFollowing: false, isProgrammatic: false, activeRowVisible: true, nearBottom: false }),
    ).toBe(true);
  });

  it('手動スクロール時は最下部付近なら追従を再開する', () => {
    expect(
      nextFollowState({ wasFollowing: false, isProgrammatic: false, activeRowVisible: false, nearBottom: true }),
    ).toBe(true);
  });

  it('手動スクロールでアクティブ行が見えず最下部でもなければ追従を止める', () => {
    expect(
      nextFollowState({ wasFollowing: true, isProgrammatic: false, activeRowVisible: false, nearBottom: false }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run tests/transcriptPanel.test.ts`
Expected: `nextFollowState` の4テストが FAIL（`nextFollowState is not a function` / import 解決不可）。

- [ ] **Step 3: `nextFollowState` を実装する**

`src/content/transcriptPanel.ts` の `STYLES` 定数の直前（ファイル上部、インターフェイス群の後）に、export 付きの純粋関数を追加する。

```typescript
/**
 * 追従スクロールを続けるかどうかを決める純粋関数。
 * - プログラム由来のスクロール（こちらが scrollIntoView した結果）は無視し、状態を保つ。
 * - 手動スクロール時は、アクティブ行が可視範囲にある／最下部付近にあるときだけ追従を再開する。
 */
export function nextFollowState(opts: {
  wasFollowing: boolean;
  isProgrammatic: boolean;
  activeRowVisible: boolean;
  nearBottom: boolean;
}): boolean {
  if (opts.isProgrammatic) return opts.wasFollowing;
  return opts.activeRowVisible || opts.nearBottom;
}
```

- [ ] **Step 4: 追従の状態・スクロール監視・自動スクロールを実装する**

`createTranscriptPanel` 内、Task 1 で足した `const ACTIVE_EPSILON = 0.25;` の直後に追従用の状態と関数を追加する。

```typescript
  const ACTIVE_EPSILON = 0.25;
  // 追従スクロールの状態。初期は追従ON。
  let following = true;
  // 直近で自前スクロールした後の scrollTop。scroll イベントがこの値なら自前由来とみなす。
  let lastAutoScrollTop = -1;

  // リスト最下部付近にいるか（8px の遊びを持たせる）。
  const isNearBottom = (): boolean =>
    list.scrollTop + list.clientHeight >= list.scrollHeight - 8;

  // アクティブ行がリストの可視範囲に重なっているか。
  const isActiveVisible = (): boolean => {
    if (!activeRow) return false;
    const r = activeRow.getBoundingClientRect();
    const c = list.getBoundingClientRect();
    return r.bottom > c.top && r.top < c.bottom;
  };

  // アクティブ行を可視範囲へスクロールし、自前スクロールとして記録する。
  const scrollActiveIntoView = (): void => {
    if (!activeRow) return;
    activeRow.scrollIntoView({ block: 'nearest' });
    lastAutoScrollTop = list.scrollTop;
  };

  // 手動スクロールを検知して追従可否を更新する。自前スクロールの「こだま」は無視する。
  list.addEventListener('scroll', () => {
    following = nextFollowState({
      wasFollowing: following,
      isProgrammatic: list.scrollTop === lastAutoScrollTop,
      activeRowVisible: isActiveVisible(),
      nearBottom: isNearBottom(),
    });
  });
```

- [ ] **Step 5: `append` の最下部スクロールを追従状態でガードする**

`append` 内の `list.scrollTop = list.scrollHeight;` を、追従中だけ実行する形に置き換える。

```typescript
    rows.push({ videoTime: entry.videoTime, el: row });
    // 追従中のときだけ最下部へ送る（履歴を遡って読んでいる間は勝手に飛ばさない）。
    if (following) {
      list.scrollTop = list.scrollHeight;
      lastAutoScrollTop = list.scrollTop;
    }
```

- [ ] **Step 6: アクティブ行が変わったら追従スクロールする**

`updateActiveByTime` の末尾（`activeRow = next;` の後）に1行足す。

```typescript
    activeRow?.classList.remove('active');
    next?.classList.add('active');
    activeRow = next;
    if (following) scrollActiveIntoView();
```

- [ ] **Step 7: テストを実行して成功を確認する**

Run: `npx vitest run tests/transcriptPanel.test.ts`
Expected: 全テスト PASS（Task 1 の6 + `nextFollowState` の4 + 既存）。

> 注: jsdom はレイアウトを計算しないため（`scrollHeight`/`getBoundingClientRect` が 0）、`isNearBottom`/`isActiveVisible`/`scrollIntoView` の実挙動は単体テストできない。追従の体感確認は Task 3 完了後にブラウザで行う。

- [ ] **Step 8: 型チェックとフルテスト**

Run: `npx tsc --noEmit && npm test`
Expected: 型エラー無し。全テスト PASS。

- [ ] **Step 9: コミットする**

```bash
git add src/content/transcriptPanel.ts tests/transcriptPanel.test.ts
git commit -m "$(cat <<'EOF'
feat: 現在再生行への賢い追従スクロールを追加

アクティブ行が変わったら可視範囲へスクロールする。手動スクロール中は追従を
止め、アクティブ行が再び見える／最下部付近へ戻したら再開する。判定は純粋関数
nextFollowState に切り出して単体テストした。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 再生位置の監視を `index.ts` に配線する

動画の `timeupdate` / `seeked` と字幕追加直後に、現在時刻を `panel.updateActiveByTime` へ渡す。メディアイベントはバブリングしないため `document` のキャプチャ段で購読する（既存の `loadstart` 購読と同じ手口、広告での video 差し替えにも耐える）。`index.ts` には既存のユニットテストが無いため、型チェック・ビルド・手動確認で検証する。

**Files:**
- Modify: `src/content/index.ts`

- [ ] **Step 1: 監視リスナーを追加する**

`index.ts` の、`recorder` 関連のブロック（`if (panel) { ... for (const ev of ['loadstart', 'emptied', 'durationchange'] ...) }`）の直後、`// 直近の字幕。...` の前に、以下を追加する。

```typescript
  if (panel) {
    // 再生位置の変化を監視して履歴のアクティブ行を更新する。メディアイベントは
    // バブリングしないため document のキャプチャ段で受ける（広告での video 差し替えにも耐える）。
    const syncActiveRow = (): void => panel.updateActiveByTime(findVideo()?.currentTime ?? 0);
    for (const ev of ['timeupdate', 'seeked'] as const) {
      document.addEventListener(ev, syncActiveRow, true);
    }
  }
```

（`panel` は `const` 宣言のため、`if (panel)` ブロック内のクロージャでも非 null に絞り込まれ、`panel.updateActiveByTime` は `?.` 無しで型が通る。）

- [ ] **Step 2: 字幕追加直後にもアクティブ行を更新する**

caption コールバック内の append 行を、追加直後に現在行を更新する形へ置き換える。置き換え前:

```typescript
    if (recordedId !== null) panel?.append({ id: recordedId, english: text, videoTime });
```

置き換え後:

```typescript
    if (recordedId !== null) {
      panel?.append({ id: recordedId, english: text, videoTime });
      // 追加した行を即座にアクティブにする（timeupdate を待たずに反映）。
      panel?.updateActiveByTime(videoTime);
    }
```

- [ ] **Step 3: 型チェック・フルテスト・ビルド**

Run: `npx tsc --noEmit && npm test && node build.mjs`
Expected: 型エラー無し。全テスト PASS。ビルド成功（`dist/` 生成）。

- [ ] **Step 4: 手動確認（ブラウザ）**

`chrome://extensions` で拡張を再読み込みし、Prime Video の再生画面で次を確認する。

- 再生中、いま喋っている字幕の行に左の青バー＋淡い青背景が付き、再生に合わせて移動する。
- 履歴の過去行をクリック、または再生バーで巻き戻すと、対応する行へマーカーが移り可視範囲へスクロールする。
- 履歴を上へ手動スクロールして読んでいる間は、新しい字幕が来てもスクロールが勝手に飛ばない。最下部付近へ戻すと追従が再開する。
- 全画面の出入りでもマーカーとパネルが維持される。

- [ ] **Step 5: コミットする**

```bash
git add src/content/index.ts
git commit -m "$(cat <<'EOF'
feat: 再生位置を監視して現在再生行を更新する配線を追加

timeupdate / seeked を document キャプチャ段で購読し、字幕追加直後にも
panel.updateActiveByTime を呼んで、履歴のアクティブ行を再生位置に追従させる。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 完了条件

- 3タスクすべてのコミットが worktree ブランチに入っている。
- `npx tsc --noEmit` と `npm test` がパス。
- ブラウザでの手動確認（Task 3 Step 4）の項目をすべて満たす。
- PR は作成しない（ユーザーが明示的に「PR作成」と指示するまでコミットのみ）。

## 自己レビュー結果

- **スペック網羅:** 現在行判定（Task 1）／再生位置監視の配線（Task 3）／パネル API `updateActiveByTime`（Task 1）／見た目 `.row.active`（Task 1）／賢い追従スクロール（Task 2）／設定トグルなし（変更なし＝対応）。すべてタスクに対応済み。
- **プレースホルダ:** なし（全ステップに実コードまたは実コマンドを記載）。
- **型整合:** `updateActiveByTime(currentTime: number): void` をインターフェイス・実装・呼び出し（index.ts）・テストで一致。`nextFollowState` の引数名（`wasFollowing` / `isProgrammatic` / `activeRowVisible` / `nearBottom`）を実装とテストで一致。内部の `rows` / `activeRow` / `following` / `lastAutoScrollTop` の名称はファイル内で一貫。
