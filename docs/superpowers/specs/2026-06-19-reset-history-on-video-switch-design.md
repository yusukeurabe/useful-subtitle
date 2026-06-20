# 動画切り替え時に字幕履歴をリセット 設計

**日付:** 2026-06-19
**ブランチ（予定）:** `fix/reset-history-on-video-switch`（main 作業ディレクトリで作業。worktree は使わない＝実機が読む `dist` は main 作業ディレクトリのものなので、リロード確認のためここでビルドする）

## ゴール

Amazon プライムで**別の作品／エピソードに切り替えたら、右側「字幕の履歴」パネルを全消去**し、
新しい作品の字幕だけが時刻0から並ぶようにする。現状は切り替えても前の作品の履歴が残り続ける。

**最優先の制約（おまかせ＝安全側）:** **広告・CM が入っても履歴を誤って全消去しない**こと。
取りこぼし（本来消したい場面で消えない）は許容するが、**誤消去（消すべきでない場面で消す）は構造的に起こさない**。

## 問題の所在（なぜ過去履歴が残るか）

- `src/content/index.ts:46-55` は動画読み込みイベント（`loadstart`/`emptied`/`durationchange`）で
  `recorder.reset()` を呼ぶが、これは**記録位置フロンティア（`maxRecordedTime`）を初期化するだけ**
  （`transcriptRecorder.ts:34-36`）。新しい動画を時刻0から記録できるようにはなるが、
  **パネルに並んだ過去の行は消えない**。
- `src/content/transcriptPanel.ts` には**履歴を空にする手段が無い**
  （公開APIは `append` / `setTranslation` / `updateActiveByTime` / `destroy` のみ）。

→ 修正の核は「パネルに全消去 `clear()` を新設」＋「**作品が切り替わったときだけ** `clear()` を呼ぶ」。

## 方針（採用＝案C：作品ID〔URL〕＋本編の尺の併用）

「切り替わった」の判定に、**互いに独立した2つの非破壊シグナルの論理和**を使う。
どちらの取りこぼしも「消えないだけ（＝現状と同じ）」で、**どちらも誤消去を起こさない**。

1. **作品ID（URL由来）の変化** … 別作品・別エピソードへ遷移すると Prime の URL 内の作品コード
   （GTI / ASIN）が変わる。**広告は URL を変えない**ので広告では発火しない。
   クエリ・ref 等のノイズは無視して安定IDだけを比較する。
2. **本編の尺（duration）の変化** … 別の作品は尺が異なることが多い。**「本編とみなす最低尺
   （既定5分）」未満は無視**するため、数十秒〜短い広告は尺シグナルを動かさない。
   URL が変わらないケース（次話で URL 不変など）の取りこぼしを補う backstop。

- 既存の読み込みイベント由来の `recorder.reset()`（無害なフロンティア初期化）は**そのまま残す**。
  本変更は**純粋に追加**で、既存の「新しい動画を0から記録」挙動を壊さない。
- 判定ロジックは**純粋関数**として切り出し（`videoControl` の `pickBestVideo`、`transcriptRecorder` と
  同じ「純粋コア＋薄いDOM殻」の作法に合わせる）、単体テストで広告・初回・取りこぼし等を固める。

### 不採用案

- **案A（読み込みで即消去）**: 最小変更だが、広告ありプランで広告読み込み時に誤消去し得る → 却下。
- **案B（URLのみ）**: 広告に強いが、Prime が次話で URL を変えない場合に取りこぼす → 尺で補強した C を採用。

## コンポーネント / ファイル

### 1. `src/content/contentIdentity.ts`（新規・純粋関数）

```ts
/** URL から Prime の安定した作品コードを取り出す。取れなければ ''（空文字）。 */
export function extractContentId(href: string): string;

export interface TitleSwitchInput {
  /** extractContentId(location.href) の結果。取れなければ ''。 */
  id: string;
  /** 本編 video の duration。未ロードは NaN、ライブは Infinity でよい（内部で除外する）。 */
  durationRaw: number;
}

export interface TitleSwitchDetector {
  /** 作品が切り替わったと判定したら true（＝履歴を消すべき）。基準も更新する副作用を持つ。 */
  check(input: TitleSwitchInput): boolean;
}

export function createTitleSwitchDetector(opts?: {
  /** 本編とみなす最低尺（秒）。これ未満の duration は尺シグナルとして無視。既定 300。 */
  minTitleSeconds?: number;
  /** 尺が「変わった」とみなす差の閾値（秒）。微小なゆらぎを吸収。既定 1。 */
  durationToleranceSeconds?: number;
}): TitleSwitchDetector;
```

**`extractContentId(href)` の抽出方針（優先順）:**
1. **GTI**: `amzn1.dv.gti.<token>` を href 全体から探す（エピソード単位で最も精密）。
2. **ASIN**: パスの `/(?:gp/video/detail|detail|dp)/<TOKEN>` の `<TOKEN>`（英数）を取る。
3. いずれも無ければ `''`。
- クエリ文字列・`ref=`・ハッシュ等の**揺れは比較に含めない**（同一エピソード内の URL 微変化で誤発火しない）。

**`check(input)` のロジック（純粋・副作用は内部状態の更新のみ）:**
- 内部状態 `lastId: string | null`、`lastDuration: number | null`（初期 `null`）。
- `qualifies = Number.isFinite(durationRaw) && durationRaw >= minTitleSeconds`。
  `effDur = qualifies ? durationRaw : null`（広告・短尺・NaN・Infinity は `null`）。
- `hasBaseline = lastId !== null || lastDuration !== null`。
- `idChanged  = id !== '' && lastId !== null && id !== lastId`。
- `durChanged = effDur !== null && lastDuration !== null
                && Math.abs(effDur - lastDuration) > durationToleranceSeconds`。
- `switched = hasBaseline && (idChanged || durChanged)`。
- **基準更新**: `id !== ''` なら `lastId = id`（空文字では good な基準を上書きしない）。
  `effDur !== null` なら `lastDuration = effDur`（短尺・NaN では上書きしない）。
- `switched` を返す。**初回（基準が無い間）は常に false**（基準確立のみ）。

### 2. `src/content/transcriptPanel.ts`（修正）

- 公開APIに `clear(): void` を追加。
  - `list` 内の行DOMを全削除、`rows` を空に、`jaById` を空に、`activeRow = null`、
    `following = true`（追従ON）、`lastAutoScrollTop = -1` に戻す。
  - 開いていれば**ホバーポップアップを閉じる**（`hideHoverPopup()`）。除去対象の行を指すカードが
    宙に浮かないようにする。
  - `host` / `style` / `header`（タイトル・×）/ `reopen` ボタンや表示状態（`setVisible`）は触らない。
- `TranscriptPanel` インターフェースに `clear` を追加。`destroy` は従来どおり。

### 3. `src/content/index.ts`（修正・配線）

- 生成: `const titleSwitch = createTitleSwitchDetector();`
- 判定関数:
  ```ts
  const maybeResetForNewTitle = (): void => {
    if (!panel) return; // 履歴機能OFFなら何もしない
    const v = findVideo();
    if (titleSwitch.check({ id: extractContentId(location.href), durationRaw: v?.duration ?? NaN })) {
      panel.clear();
      recorder.reset();
    }
  };
  ```
- **字幕観測コールバックの先頭**（記録の前）で `maybeResetForNewTitle()` を呼ぶ。
  → 切替時はまず履歴を空にしてから現在字幕を記録するので、**新作品の最初の字幕が先頭行**になる。
- **読み込みイベント**ハンドラを `recorder.reset()`（既存・無害）に加えて `maybeResetForNewTitle()` も呼ぶ形へ:
  ```ts
  const handleMediaLoad = (): void => { recorder.reset(); maybeResetForNewTitle(); };
  for (const ev of ['loadstart', 'emptied', 'durationchange'] as const)
    document.addEventListener(ev, handleMediaLoad, true);
  ```
- `entryId` は**連番のまま維持**（リセットしない）。`clear()` で `jaById` が空になるため、
  旧動画の遅延翻訳が届いても `setTranslation(oldId)` は no-op（新行に紛れ込まない）。

## 動作（タイムライン）

- **同一作品の通常再生**: id 不変・尺不変 → `check` は false。履歴は積み上がり続ける（従来どおり）。
- **広告（CSAI）が本編 video を差し替え**: URL 不変、本編判定された広告の尺は5分未満 → `effDur=null`。
  id も尺も動かない → **消えない**。広告明けに本編尺へ戻っても差0 → **消えない**。
- **次話/別作品へ切替**: URL の作品コードが変わる → `idChanged` で即 true → `clear()`＋`reset()`。
  仮に URL が変わらなくても、尺が変われば `durChanged` で拾う。
- **同一エピソードを最初から見直し（同id・同尺）**: `check` は false（消さない）。
  これは妥当（同じ作品なので履歴を残す）。記録はフロンティアにより重複しない。
- **取りこぼし（id も尺も同じ別物・ごく稀）**: 消えないだけ。**誤消去はしない**（安全側）。

## テスト（TDD）

### `tests/contentIdentity.test.ts`（新規）
- `extractContentId`:
  - GTI を含む URL → その GTI を返す。
  - `/gp/video/detail/B0XXXXXXXX/ref=...?autoplay=1` → `B0XXXXXXXX`（クエリ/ref を無視）。
  - `/dp/B0YYYYYYYY` → `B0YYYYYYYY`。
  - 同一作品でクエリ・ハッシュだけ違う2 URL → **同じ id**。
  - 作品コードを含まない URL → `''`。
- `createTitleSwitchDetector().check`:
  - 初回呼び出しは false（基準確立）。
  - 同 id・同尺 → false。
  - id 変化 → true。
  - 尺が閾値超で別値（両方 ≥ minTitleSeconds）→ true。
  - **広告無視**: 基準確立後に `durationRaw=30`（短尺・id 同じ）→ false、続けて本編尺に戻る → false。
  - `durationRaw` が `NaN` / `Infinity` → 尺シグナルは無視（id 不変なら false）。
  - `id=''` は good な基準を上書きしない・単独で発火しない。
  - 尺差が許容閾値内（微小ゆらぎ）→ false。

### `tests/transcriptPanel.test.ts`（追記・jsdom）
- `append()` を複数回 → `clear()` で `.row` が 0 件になる。
- `clear()` 後の `updateActiveByTime(任意)` は no-op（例外なし、active 無し）。
- `clear()` 後に `append()` すると**新しい行が先頭**になる。
- `clear()` 後に旧 id へ `setTranslation(oldId, …)` しても例外を投げず無視される。
- 可能なら: ホバーポップアップを開いた状態で `clear()` するとポップアップが閉じる。

### 手動（実機）
- Prime で作品Aを数行ぶん視聴 → 履歴に並ぶ → 作品B（または次話）へ切替 → **履歴が空になり**Bの字幕だけ並ぶ。
- （広告ありプランなら）本編途中で広告 → 広告中・広告明けで**履歴が消えない**ことを確認。

## エラー処理 / エッジ

- **本編 video 不在（`findVideo()===null`）**: `durationRaw=NaN` として扱う。id だけで判定（または基準確立）。落ちない。
- **`location.href` から id 取れず（`''`）**: 尺シグナルのみで判定（非破壊に劣化）。誤消去はしない。
- **ライブ等 `duration=Infinity`**: 尺シグナルは無視。id で判定。
- **遅延翻訳の混入**: `clear()` 後は `jaById` が空 → 旧 id への `setTranslation` は no-op。
- **既存の軽微既知事項（範囲外）**: 読み込みイベントでの無条件 `recorder.reset()` は、広告 `loadstart`
  時にフロンティアを下げて現在行が1行重複し得る（従来挙動）。本変更では触らない。

## 非ゴール（YAGNI）

- 「履歴を消す/残すの設定項目」は追加しない（他機能と同じく常時挙動）。
- 作品名テキストのスクレイピングによる判定はしない（セレクタ脆弱性を避け、URL＋尺で十分）。
- 過去履歴の保存・復元はしない（消去のみ）。

## 反映（ビルド/リロード）

- 変更後はこちらで `dist` を再ビルド（watch 起動）。**worktree では作業しない**（実機が読む dist は
  main 作業ディレクトリのもの）。
- 実機反映は拡張の再読み込み（↻）＋ページの再読み込み（F5）の**両方**（MV3 仕様）。
