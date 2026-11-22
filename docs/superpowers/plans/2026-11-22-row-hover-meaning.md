# 字幕履歴の行ホバーで和訳＋解説 Implementation Plan

> **注記（レビュー後の変更）:** レビューの指摘で、発火のきっかけを `mouseover` から `mousemove` に変更し、単語ポップアップとの同じ文の取得中要求の共有と、エラー後は行を出て戻るまで再要求しない制御を追加した（最新の仕様は設計書を参照。本文は当初の計画のまま）。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 字幕履歴パネルの行の「単語以外の場所」に 500ms カーソルを置くと、その行の英文の下に和訳＋解説を差し込み、出したまま残す。

**Architecture:** `src/content/transcriptPanel.ts` 内で完結させる。行ごとの状態（差し込み要素・取得状態・世代番号）を `entriesById` の値に持たせ、行の `mouseover`（対象が `.word` 以外）でドウェルタイマーを張る。取得は既存コールバック `cb.onExplain(sentence)`（＝ `explainSentence`、単語ポップアップ下段とキャッシュ共有）を再利用する。

**Tech Stack:** TypeScript / Chrome 拡張 MV3 content script / Shadow DOM / vitest + jsdom

## Global Constraints

- 設計書: `docs/superpowers/specs/2026-11-22-row-hover-meaning-design.md`
- ドウェル時間は **500ms**（`ROW_DWELL_MS = 500`）
- 新しい設定項目・メッセージ種別・コールバックは追加しない。`cb.onExplain` 未指定なら本機能は無効
- 既存の単語ポップアップ（`.hover-popup`、`DWELL_MS`/`SWITCH_MS`/`CLOSE_GRACE_MS`）の挙動は変えない
- 行クリック＝シーク（`onSeek`）は変えない
- コメント・UI 文言は日本語（既存コードに合わせる）。ローディング文言は既存と同じ `Thinking…`
- PC 負荷配慮: テストは `npx vitest run tests/transcriptPanel.test.ts` のように対象ファイルだけ実行する。開発サーバー・watch は起動しない
- バージョンは PR 作成時に `manifest.json` / `package.json` を 0.8.3 → 0.9.0（この計画のタスクには含めない）

---

### Task 1: 行の単語以外ホバーで和訳＋解説を差し込む

**Files:**
- Modify: `src/content/transcriptPanel.ts`（STYLES 末尾の CSS 追加、`entriesById` の値の型、`append`、`clear`、`destroy`、新規の行ドウェル処理）
- Test: `tests/transcriptPanel.test.ts`（末尾に describe を追加）

**Interfaces:**
- Consumes: 既存の `cb.onExplain?: (sentence: string) => Promise<TranscriptMeaning>`、`TranscriptMeaning`（`{ok:true; translation; explanation} | {ok:false; error}`）、既存の `followBottom()`、`rows`、`entriesById`
- Produces: DOM 上のクラス名 `.row-meaning`（行の末尾に追加される差し込みブロック）、その子 `.rm-trans`（和訳）、`.rm-expl`（解説）、`.rm-body.loading`（取得中）、`.rm-body.err`（エラー）。公開 API（`TranscriptPanel`）は変更しない

- [ ] **Step 1: 失敗するテストを書く**

`tests/transcriptPanel.test.ts` の末尾に追加（`wordsOf`、`HOST_ID`、`TranscriptMeaning` などは同ファイル既存のものを使う）:

```ts
describe('createTranscriptPanel — 行の単語以外ホバーで和訳＋解説を行の下に表示', () => {
  let panel: TranscriptPanel | null = null;

  beforeEach(() => {
    document.body.replaceChildren();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    panel?.destroy();
    panel = null;
  });

  function shadow(): ShadowRoot {
    return document.getElementById(HOST_ID)!.shadowRoot!;
  }
  function rowsOf(): HTMLDivElement[] {
    return Array.from(shadow().querySelectorAll<HTMLDivElement>('.row'));
  }
  /** 実ブラウザ同様、バブリングする mouseover を発火する（対象要素＝カーソル直下の要素）。 */
  function over(el: Element): void {
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  }
  function enOf(row: HTMLDivElement): HTMLDivElement {
    return row.querySelector<HTMLDivElement>('.en')!;
  }
  function meaningOf(row: HTMLDivElement): HTMLDivElement | null {
    return row.querySelector<HTMLDivElement>('.row-meaning');
  }

  it('単語以外に 500ms 置くと onExplain が英文で呼ばれ、和訳と解説が行の末尾に出る', async () => {
    const calls: string[] = [];
    const onSeek = vi.fn();
    panel = createTranscriptPanel({
      onSeek,
      onExplain: async (s) => {
        calls.push(s);
        return { ok: true, translation: '頑張って！', explanation: '舞台前のイディオム。' };
      },
    });
    panel.append({ id: 1, english: 'Break a leg!', videoTime: 7 });
    const row = rowsOf()[0];

    over(enOf(row)); // 語間（テキストノード上）は対象が .en になる
    await vi.advanceTimersByTimeAsync(499);
    expect(calls).toEqual([]);
    expect(meaningOf(row)).toBeNull();
    await vi.advanceTimersByTimeAsync(1);

    expect(calls).toEqual(['Break a leg!']);
    const m = meaningOf(row)!;
    expect(m.querySelector('.rm-trans')!.textContent).toBe('頑張って！');
    expect(m.querySelector('.rm-expl')!.textContent).toBe('舞台前のイディオム。');
    expect(row.lastElementChild).toBe(m);
    expect(shadow().querySelector('.hover-popup')).toBeNull(); // 単語ポップアップは出ない

    m.click(); // 差し込み表示のクリックも行のシーク
    expect(onSeek).toHaveBeenCalledWith(7);
  });

  it('応答が来るまでは Thinking… を出す', async () => {
    let resolve: (v: TranscriptMeaning) => void = () => {};
    panel = createTranscriptPanel({
      onSeek: () => {},
      onExplain: () => new Promise<TranscriptMeaning>((r) => { resolve = r; }),
    });
    panel.append({ id: 1, english: 'Hello there', videoTime: 1 });
    const row = rowsOf()[0];
    over(row);
    await vi.advanceTimersByTimeAsync(500);

    expect(meaningOf(row)!.querySelector('.rm-body.loading')!.textContent).toBe('Thinking…');
    resolve({ ok: true, translation: 'やあ', explanation: '' });
    await vi.advanceTimersByTimeAsync(0);
    expect(meaningOf(row)!.querySelector('.loading')).toBeNull();
    expect(meaningOf(row)!.querySelector('.rm-trans')!.textContent).toBe('やあ');
    expect(meaningOf(row)!.querySelector('.rm-expl')).toBeNull(); // 空の解説は出さない
  });

  it('単語の上に置いているだけでは行の表示は出ない', async () => {
    const onExplain = vi.fn().mockResolvedValue({ ok: true, translation: 'x', explanation: 'y' });
    panel = createTranscriptPanel({ onSeek: () => {}, onExplain });
    panel.append({ id: 1, english: 'Hello there', videoTime: 1 });
    const row = rowsOf()[0];

    over(wordsOf(row)[0]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onExplain).not.toHaveBeenCalled();
    expect(meaningOf(row)).toBeNull();
  });

  it('500ms 前に単語へ移る／行を離れるとドウェルは取り消される', async () => {
    const onExplain = vi.fn().mockResolvedValue({ ok: true, translation: 'x', explanation: 'y' });
    panel = createTranscriptPanel({ onSeek: () => {}, onExplain });
    panel.append({ id: 1, english: 'Hello there', videoTime: 1 });
    const row = rowsOf()[0];

    over(enOf(row));
    await vi.advanceTimersByTimeAsync(300);
    over(wordsOf(row)[0]);
    await vi.advanceTimersByTimeAsync(500);
    expect(onExplain).not.toHaveBeenCalled();

    over(enOf(row));
    await vi.advanceTimersByTimeAsync(300);
    row.dispatchEvent(new Event('mouseleave'));
    await vi.advanceTimersByTimeAsync(500);
    expect(onExplain).not.toHaveBeenCalled();
  });

  it('同じ行の単語以外を移動してもドウェルは張り直さない（最初の位置から 500ms で出る）', async () => {
    const onExplain = vi.fn().mockResolvedValue({ ok: true, translation: 'x', explanation: 'y' });
    panel = createTranscriptPanel({ onSeek: () => {}, onExplain });
    panel.append({ id: 1, english: 'Hello there', videoTime: 1 });
    const row = rowsOf()[0];

    over(row);
    await vi.advanceTimersByTimeAsync(300);
    over(enOf(row));
    await vi.advanceTimersByTimeAsync(200);
    expect(onExplain).toHaveBeenCalledTimes(1);
  });

  it('行から離れても表示は残り、成功済みの行へ再ホバーしても再要求しない', async () => {
    const onExplain = vi.fn().mockResolvedValue({ ok: true, translation: '残る和訳', explanation: '' });
    panel = createTranscriptPanel({ onSeek: () => {}, onExplain });
    panel.append({ id: 1, english: 'Hello there', videoTime: 1 });
    const row = rowsOf()[0];

    over(enOf(row));
    await vi.advanceTimersByTimeAsync(500);
    row.dispatchEvent(new Event('mouseleave'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(meaningOf(row)!.querySelector('.rm-trans')!.textContent).toBe('残る和訳');

    over(enOf(row));
    await vi.advanceTimersByTimeAsync(1000);
    expect(onExplain).toHaveBeenCalledTimes(1);
  });

  it('エラーは赤字で出て、再ホバーで再要求する', async () => {
    const onExplain = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: '取得できませんでした' })
      .mockResolvedValueOnce({ ok: true, translation: '再取得した和訳', explanation: '' });
    panel = createTranscriptPanel({ onSeek: () => {}, onExplain });
    panel.append({ id: 1, english: 'Hello there', videoTime: 1 });
    const row = rowsOf()[0];

    over(enOf(row));
    await vi.advanceTimersByTimeAsync(500);
    expect(meaningOf(row)!.querySelector('.rm-body.err')!.textContent).toBe('取得できませんでした');

    row.dispatchEvent(new Event('mouseleave'));
    over(enOf(row));
    await vi.advanceTimersByTimeAsync(500);
    expect(onExplain).toHaveBeenCalledTimes(2);
    expect(row.querySelectorAll('.row-meaning')).toHaveLength(1);
    expect(meaningOf(row)!.querySelector('.err')).toBeNull();
    expect(meaningOf(row)!.querySelector('.rm-trans')!.textContent).toBe('再取得した和訳');
  });

  it('onExplain が reject してもエラー表示になり、例外を外へ出さない', async () => {
    panel = createTranscriptPanel({ onSeek: () => {}, onExplain: () => Promise.reject(new Error('boom')) });
    panel.append({ id: 1, english: 'Hello there', videoTime: 1 });
    const row = rowsOf()[0];
    over(enOf(row));
    await vi.advanceTimersByTimeAsync(500);
    expect(meaningOf(row)!.querySelector('.rm-body.err')).not.toBeNull();
  });

  it('デュアル字幕の和訳（.ja）がある行では解説だけを出す', async () => {
    panel = createTranscriptPanel({
      onSeek: () => {},
      onExplain: async () => ({ ok: true, translation: '重複する和訳', explanation: '補足の解説' }),
    });
    panel.append({ id: 1, english: 'Hello there', videoTime: 1 });
    panel.setTranslation(1, 'やあ、そこの人');
    const row = rowsOf()[0];
    over(enOf(row));
    await vi.advanceTimersByTimeAsync(500);

    expect(meaningOf(row)!.querySelector('.rm-trans')).toBeNull();
    expect(meaningOf(row)!.querySelector('.rm-expl')!.textContent).toBe('補足の解説');
  });

  it('英文が更新されると表示が消え、遅れて届いた古い応答は捨てられる', async () => {
    const resolvers: Array<(v: TranscriptMeaning) => void> = [];
    const calls: string[] = [];
    panel = createTranscriptPanel({
      onSeek: () => {},
      onExplain: (s) => {
        calls.push(s);
        return new Promise<TranscriptMeaning>((r) => { resolvers.push(r); });
      },
    });
    panel.append({ id: 1, english: 'Good', videoTime: 1 });
    const row = rowsOf()[0];
    over(enOf(row));
    await vi.advanceTimersByTimeAsync(500);
    expect(meaningOf(row)).not.toBeNull();

    panel.append({ id: 1, english: 'Good morning', videoTime: 1 });
    expect(meaningOf(row)).toBeNull();
    resolvers[0]({ ok: true, translation: '古い和訳', explanation: '' });
    await vi.advanceTimersByTimeAsync(0);
    expect(meaningOf(row)).toBeNull();

    over(enOf(row));
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toEqual(['Good', 'Good morning']);
    resolvers[1]({ ok: true, translation: 'おはよう', explanation: '' });
    await vi.advanceTimersByTimeAsync(0);
    expect(meaningOf(row)!.querySelector('.rm-trans')!.textContent).toBe('おはよう');
  });

  it('ドウェル中に英文が更新されるとそのドウェルは取り消される', async () => {
    const onExplain = vi.fn().mockResolvedValue({ ok: true, translation: 'x', explanation: '' });
    panel = createTranscriptPanel({ onSeek: () => {}, onExplain });
    panel.append({ id: 1, english: 'Good', videoTime: 1 });
    over(enOf(rowsOf()[0]));
    await vi.advanceTimersByTimeAsync(300);
    panel.append({ id: 1, english: 'Good morning', videoTime: 1 });
    await vi.advanceTimersByTimeAsync(500);
    expect(onExplain).not.toHaveBeenCalled();
  });

  it('clear() 後に遅れて届いた応答は何も描かず、例外も出さない', async () => {
    let resolve: (v: TranscriptMeaning) => void = () => {};
    panel = createTranscriptPanel({
      onSeek: () => {},
      onExplain: () => new Promise<TranscriptMeaning>((r) => { resolve = r; }),
    });
    panel.append({ id: 1, english: 'Hello there', videoTime: 1 });
    over(enOf(rowsOf()[0]));
    await vi.advanceTimersByTimeAsync(500);

    panel.clear();
    resolve({ ok: true, translation: '遅い和訳', explanation: '' });
    await vi.advanceTimersByTimeAsync(0);
    expect(rowsOf()).toHaveLength(0);
    expect(shadow().querySelector('.row-meaning')).toBeNull();
  });

  it('clear() はドウェル中のタイマーも取り消す', async () => {
    const onExplain = vi.fn().mockResolvedValue({ ok: true, translation: 'x', explanation: '' });
    panel = createTranscriptPanel({ onSeek: () => {}, onExplain });
    panel.append({ id: 1, english: 'Hello there', videoTime: 1 });
    over(enOf(rowsOf()[0]));
    await vi.advanceTimersByTimeAsync(300);
    panel.clear();
    await vi.advanceTimersByTimeAsync(500);
    expect(onExplain).not.toHaveBeenCalled();
  });

  it('onExplain 未指定なら何も出ず、行クリックでシークできる', async () => {
    const onSeek = vi.fn();
    panel = createTranscriptPanel({ onSeek });
    panel.append({ id: 1, english: 'Hello there', videoTime: 3 });
    const row = rowsOf()[0];
    over(enOf(row));
    await vi.advanceTimersByTimeAsync(1000);
    expect(meaningOf(row)).toBeNull();
    row.click();
    expect(onSeek).toHaveBeenCalledWith(3);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/transcriptPanel.test.ts`
Expected: 新しい describe のテストが FAIL（`.row-meaning` が見つからず `null` 参照や `toHaveBeenCalledTimes` 不一致）。既存テストは PASS のまま。

- [ ] **Step 3: CSS を追加**

`src/content/transcriptPanel.ts` の `STYLES` テンプレート末尾（`.hover-popup .hp-body.err { color: #ff8a8a; }` の直後、閉じバッククォートの前）に追加:

```css
/* 行の単語以外ホバーで英文の下に差し込む和訳＋解説（出したまま残す）。 */
.row .row-meaning { margin-top: 4px; }
.row .row-meaning .rm-trans { font-size: 12px; line-height: 1.4; color: #ffe08a; white-space: pre-wrap; }
.row .row-meaning .rm-expl { font-size: 11.5px; line-height: 1.45; color: #c8c8c8; white-space: pre-wrap; margin-top: 2px; }
.row .row-meaning .rm-body { font-size: 12px; line-height: 1.4; white-space: pre-wrap; }
.row .row-meaning .rm-body.loading { opacity: 0.7; }
.row .row-meaning .rm-body.err { color: #ff8a8a; }
```

- [ ] **Step 4: 行ごとの状態を `entriesById` の値に持たせる**

`entriesById` の宣言（`grep -n "entriesById = new Map" src/content/transcriptPanel.ts` で場所を確認）の直前に型を追加し、値の型に `ja` と `rm` を足す:

```ts
  /** 行の単語以外ホバーで差し込む和訳＋解説の状態。seq は古い応答を捨てるための世代番号。 */
  interface RowMeaning {
    el: HTMLDivElement | null;
    state: 'loading' | 'done' | 'error' | null;
    seq: number;
  }
```

値の型を `{ entry: TranscriptEntry; row: HTMLDivElement; en: HTMLDivElement; ja: HTMLDivElement; rm: RowMeaning }` に変更する（既存の宣言の書式に合わせて型引数を書き換える）。

- [ ] **Step 5: 行ドウェルと差し込み描画を実装**

`const onHoverKeyDown = ...` の直後（`function append` の前）に追加:

```ts
  // --- 行の「単語以外の場所」へのホバーで、和訳＋解説を英文の下に差し込む ---
  // 単語の上は従来どおり単語ポップアップ。ここでは行の余白・語間・短い行の右側の空きなど
  // 単語以外に ROW_DWELL_MS 留まったときだけ発火し、出した表示は行から離れても残す。
  const ROW_DWELL_MS = 500;
  type RowItem = { entry: TranscriptEntry; row: HTMLDivElement; en: HTMLDivElement; ja: HTMLDivElement; rm: RowMeaning };
  let rowDwellRow: HTMLDivElement | null = null;
  let rowDwellTimer: ReturnType<typeof setTimeout> | undefined;

  const clearRowDwell = (): void => {
    rowDwellRow = null;
    if (rowDwellTimer) {
      clearTimeout(rowDwellTimer);
      rowDwellTimer = undefined;
    }
  };

  /** 差し込み表示を取り除き、進行中の応答を無効化する（英文更新・全消去時）。 */
  const resetRowMeaning = (rm: RowMeaning): void => {
    rm.seq++;
    rm.el?.remove();
    rm.el = null;
    rm.state = null;
  };

  /** 差し込み表示の中身を描く。null=取得中、ok=false=エラー、ok=true=和訳＋解説。 */
  const renderRowMeaning = (item: RowItem, res: TranscriptMeaning | null): void => {
    const el = item.rm.el;
    if (!el) return;
    el.replaceChildren();
    if (res === null || !res.ok) {
      const body = document.createElement('div');
      body.className = res === null ? 'rm-body loading' : 'rm-body err';
      body.textContent = res === null ? 'Thinking…' : res.error;
      el.appendChild(body);
      return;
    }
    // デュアル字幕の和訳が既に行に出ていれば、和訳は重ねず解説だけを足す。
    if (res.translation && !item.ja.textContent) {
      const trans = document.createElement('div');
      trans.className = 'rm-trans';
      trans.textContent = res.translation;
      el.appendChild(trans);
    }
    if (res.explanation) {
      const expl = document.createElement('div');
      expl.className = 'rm-expl';
      expl.textContent = res.explanation;
      el.appendChild(expl);
    }
  };

  /** 行の英文の和訳＋解説を取得して差し込む。取得中・取得済みの行では何もしない。 */
  const openRowMeaning = (item: RowItem): void => {
    const explain = cb.onExplain;
    if (!explain) return;
    const { rm } = item;
    if (rm.state === 'loading' || rm.state === 'done') return;
    rm.el?.remove(); // 前回のエラー表示を作り直す
    const el = document.createElement('div');
    el.className = 'row-meaning';
    item.row.appendChild(el);
    rm.el = el;
    rm.state = 'loading';
    const seq = ++rm.seq;
    // 追従中の最下行が伸びたら、伸びた分も見えるよう最下部へ送る。
    const settle = (res: TranscriptMeaning | null): void => {
      renderRowMeaning(item, res);
      if (rows[rows.length - 1]?.el === item.row) followBottom();
    };
    settle(null);
    void explain(item.entry.english).then(
      (res) => {
        if (seq !== rm.seq) return; // 英文更新・全消去で無効化済み
        rm.state = res.ok ? 'done' : 'error';
        settle(res);
      },
      () => {
        if (seq !== rm.seq) return;
        rm.state = 'error';
        settle({ ok: false, error: '和訳を取得できませんでした。' });
      },
    );
  };
```

注意: `rows` と `followBottom` は既存（`rows` は `{ videoTime; el }` の配列、`followBottom` は関数宣言なので巻き上げで参照可）。`RowItem` は Step 4 で変更した `entriesById` の値の型と同じ形にする（可能なら `entriesById` 側の型注釈も `RowItem` を使うよう寄せてよいが、宣言順で参照できない場合は同じ形の型リテラルのままでよい）。

- [ ] **Step 6: `append` に配線する**

既存の「同じ id の更新」分岐（`if (existing) { ... }`）で、`existing.entry.english = entry.english;` の直前に追加:

```ts
      // 英文が変わったので、差し込み済みの和訳＋解説と待機中の行ドウェルは古くなる。
      resetRowMeaning(existing.rm);
      if (rowDwellRow === existing.row) clearRowDwell();
```

新規行の分岐で:

1. 既存の `row.addEventListener('mouseleave', () => { clearDwell(); scheduleClose(); });` の中に `clearRowDwell();` を追加する。
2. その直後に `mouseover` ハンドラを追加:

```ts
    // 単語以外（語間・余白・行末の空き・和訳欄）に入ったら行のドウェルを始める。
    // 単語に入ったら取り消す（単語の上は単語ポップアップの担当）。
    row.addEventListener('mouseover', (e) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('.word')) {
        if (rowDwellRow === row) clearRowDwell();
        return;
      }
      if (!cb.onExplain || rowDwellRow === row) return;
      clearRowDwell();
      rowDwellRow = row;
      rowDwellTimer = setTimeout(() => {
        rowDwellRow = null;
        rowDwellTimer = undefined;
        const item = entriesById.get(entry.id);
        if (item) openRowMeaning(item);
      }, ROW_DWELL_MS);
    });
```

3. `ja` 要素の生成が `entriesById.set(...)` より後にあるため、`ja` の生成を `entriesById.set` より前へ移し、`entriesById.set(entry.id, { entry, row, en, ja, rm: { el: null, state: null, seq: 0 } });` とする。`row.append(en, ja);` と `jaById.set(entry.id, ja);` は従来どおり残す（`renderWords` が `en` を描く順序は変えない）。

- [ ] **Step 7: `clear` と `destroy` に後始末を追加**

`clear()` と `destroy()` の両方で、`entriesById.clear();` の直前に追加:

```ts
    clearRowDwell();
    for (const item of entriesById.values()) resetRowMeaning(item.rm); // 遅れた応答を無効化
```

- [ ] **Step 8: テストと型チェック**

Run: `npx vitest run tests/transcriptPanel.test.ts`
Expected: 全テスト PASS（既存＋新規）

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 9: コミット**

```bash
git add src/content/transcriptPanel.ts tests/transcriptPanel.test.ts
git commit -m "feat: 字幕履歴の行の単語以外ホバーで和訳＋解説を行の下に表示する"
```
（コミットメッセージ末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` を付ける）
