# 字幕履歴ホバーで文まるごとの意味を表示 設計

**日付:** 2026-06-19
**ブランチ:** `worktree-feature+hover-sentence-meaning`

## ゴール

右側の「字幕の履歴」パネルで、行に**一定時間（約500ms）マウスを乗せ続ける**と、
その行の英文の**和訳＋かんたんな解説**をポップアップで表示する。**クリック不要**。
クリックは従来どおりその場面へのシーク（`onSeek`）として残す。

例（行の左側にカードが開く）:
```
字幕の履歴
──────────────
 ...
 I've been      ┌────────────────┐
 meaning to ◄── │ 和訳            │
 call you.      │ ずっと電話しよう │
 ...            │ と思ってたんだ   │
                │ ──────────     │
                │ 解説            │
                │ have been      │
                │ meaning to は  │
                │ 「ずっと〜しよう │
                │ と思っていた」… │
                └────────────────┘
```

## 方針

- **アプローチA**: 履歴パネル（`transcriptPanel.ts`）の Shadow DOM 内に専用の
  ホバーポップアップを持たせる。オーバーレイ側の単語ポップアップ（IPA/🔊/Cambridge 前提）は
  流用せず、パネル内で自己完結させる。見た目は既存ポップアップに合わせる。
- **AI 呼び出しは新メッセージ `explainSentence` を1回**。和訳と解説を1レスポンスで構造化して受け取る
  （`訳:` / `説明:` の2行形式）。既存のキャッシュ機構（`makeCacheKey`/`getCached`/`setCached`）を再利用する。
- **コスト対策**: 500ms のドウェルで誤発火を抑制 ＋ キャッシュで同じ文の2回目以降は無料。
  **新しい設定項目は追加しない**（クリックの単語解説に ON/OFF が無いのと揃える。将来必要なら小さく足せる）。
- **疎結合**: パネルは chrome.runtime を直接知らない。`onExplain(sentence)` コールバックで
  意味取得を外（`content/index.ts`）へ委譲する（`onSeek` と同じ流儀）。

## 動作（インタラクション）

- 行に `mouseenter` → 500ms タイマー開始（既存タイマーはクリア）。
- タイマー発火 → その行を対象にポップアップを開き「考え中…」表示 → `onExplain(英文)` を呼ぶ。
  - 応答が**和訳＋解説**なら本文を差し替える。**エラー**なら赤字で表示。
  - **競合ガード**: 応答到着時に「対象の行が変わっていない」ことを確認し、古い応答は破棄する
    （対象行の要素参照で照合）。
- 行から `mouseleave` → 保留中のドウェルタイマーをクリア。約200msの猶予後にポップアップを閉じる。
  ただし**ポップアップ自体にマウスが乗っていれば閉じない**（読めるようにする）。
- ポップアップ `mouseenter` で猶予クローズを取り消し、`mouseleave` で再び猶予クローズ。
- `Escape` キーでも閉じる。
- ポップアップは常に**1つだけ**。別の行へ移ると差し替える。
- **クリック（onSeek）は従来どおり**。ホバー表示はクリックを妨げない。

## AI レスポンス形式

`buildSentenceMeaningPrompt(sentence, language)` は次の厳密な2行形式を返すよう指示する:

```
訳: <文全体の自然な日本語訳（1文）>
説明: <イディオム・句動詞・文法・ニュアンスを2〜4文で>
```

- **訳**は常に**日本語の全文訳**。単語ポップアップの「訳語（最大3つ・中黒）」とは異なり、
  **丸めず全文を保持する**。
- **説明**は `explanationLanguage`（既定 `ja`）の言語で、文全体に対する補足。
- 単語ポップアップ用の `buildExplanationPrompt` / `parseExplanation` は**変更しない**（用途が違うため温存）。

## コンポーネント / ファイル

1. **`src/shared/types.ts`**（修正）
   ```ts
   export interface ExplainSentenceRequest { type: 'explainSentence'; text: string }
   ```
   を追加し、`RequestMessage` ユニオンに加える。

2. **`src/shared/messages.ts`**（修正）
   `sendRequest` の文字列系オーバーロード（`ResponseMessage` を返す群）に
   `ExplainSentenceRequest` を追加する。

3. **`src/shared/prompts.ts`**（追記）
   `buildSentenceMeaningPrompt(sentence: string, language: ExplanationLanguage): PromptParts` を追加。
   system は上記2行形式（訳=全文和訳 / 説明=`language` で2〜4文）を指示。既存関数は不変。

4. **`src/shared/explanation.ts`**（追記・純粋関数）
   ```ts
   export interface SentenceMeaning { translation: string; explanation: string }
   export function parseSentenceMeaning(raw: string): SentenceMeaning
   ```
   - `訳:`（全角/半角コロン）行から **translation を全文のまま**抽出（正規化・件数丸めはしない）。
   - `説明:` 以降から explanation を抽出。
   - ラベルが無い場合（旧キャッシュ・形式逸脱）: translation='' とし全文を explanation に（安全に劣化）。
   - 既存 `parseExplanation`/`normalizeGloss` はそのまま。

5. **`src/background/cache.ts`**（修正）
   `makeCacheKey` の引数型に `ExplainSentenceRequest` を追加し、
   `req.type === 'explainSentence'` のとき `['s', model, language, req.text].join(SEP)` を返す。

6. **`src/background/handler.ts`**（修正）
   - `makeCacheKey(req, …)` はそのまま使える（型拡張のみ）。
   - プロンプト分岐に `explainSentence` を追加:
     `req.type==='translateLine'` → translation、`'explainSentence'` → `buildSentenceMeaningPrompt`、
     既定（`explainSelection`）→ `buildExplanationPrompt`。
   - APIキー・キャッシュ・エラー処理は既存フローをそのまま通る。

7. **`src/content/transcriptPanel.ts`**（修正）
   - `TranscriptPanelCallbacks` に
     `onExplain: (sentence: string) => Promise<{ ok: true; translation: string; explanation: string } | { ok: false; error: string }>` を追加。
   - 各行に英文テキストを保持（行レコードに `english` を追加、または `.en` の textContent を読む）。
   - 行の `mouseenter`/`mouseleave` でドウェル＆猶予クローズを制御。ポップアップ要素を Shadow DOM に追加。
   - ポップアップCSS（`.hover-popup` とその子）を `STYLES` に追記。既存ポップアップに準じた配色・角丸。
   - 位置決め: 対象行の `getBoundingClientRect()` を基準に**行の左側**へ開き、ビューポート内にクランプ。
     ポップアップは `position: fixed` のため右カラム（host）の外側にもはみ出して表示できる
     （クリップが起きる場合は host を `inset:0` に広げる。pointer-events:none は維持）。
   - `destroy()` でタイマー解除・`keydown`(Escape) 解除・ポップアップ除去。

8. **`src/content/index.ts`**（修正）
   パネル生成時に `onExplain` を配線:
   ```ts
   onExplain: async (sentence) => {
     const res = await sendRequest({ type: 'explainSentence', text: sentence });
     if (!res.ok) return { ok: false, error: res.error };
     const { translation, explanation } = parseSentenceMeaning(res.text);
     return { ok: true, translation, explanation };
   }
   ```

## テスト（TDD）

- **`tests/explanation.test.ts`**（追記）: `parseSentenceMeaning`
  正常 / 全角コロン / 訳が読点を含む全文（丸められないこと）/ 説明ラベル欠如 /
  両ラベル欠如（全文が explanation）/ 複数行説明 / 空入力。
- **`tests/prompts.test.ts`**（追記）: `buildSentenceMeaningPrompt` が
  `訳:`/`説明:` 形式・全文和訳・`language` ラベルを指示していること。
- **`tests/cache.test.ts`**（追記）: `explainSentence` のキーが `'s'` 接頭・model・language・text を含み、
  translate/explainSelection と衝突しないこと。
- **`tests/handler.test.ts`**（追記）: `explainSentence` でキャッシュヒット/ミス両経路、
  `buildSentenceMeaningPrompt` 由来の system でAI呼び出しされること、NO_API_KEY を返すこと。
- **`tests/transcriptPanel.test.ts`**（追記, jsdom）: 行ホバー→（タイマー経過後）`onExplain` が呼ばれる、
  応答で和訳・解説が描画される、別行へ移ると古い応答が無視される、`mouseleave` で閉じる。
- 手動: Prime Video で履歴行に乗せ続け→カードに和訳＋解説。クリックは従来どおりシーク。

## エラー処理 / エッジ

- **APIキー未設定** → ポップアップに `NO_API_KEY` のメッセージ（赤字）。クラッシュしない。
- **AIが形式を外す** → translation 空でも explanation（全文）は表示。落ちない。
- **素早い通過** → 500ms 未満では発火しない（タイマーをクリア）。
- **連続ホバー/競合** → 対象行の参照で照合し、古い応答は捨てる。ポップアップは常に1つ。
- **長文** → ポップアップ最大幅で折り返し。内容確定後に再配置（はみ出しはクランプ）。
- **全画面** → パネルは既に全画面要素へ追従する実装。ポップアップは同じ Shadow DOM 内なので追従する。
