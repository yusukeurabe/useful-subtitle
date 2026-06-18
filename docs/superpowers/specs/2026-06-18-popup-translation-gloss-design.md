# ポップアップ訳語(一般訳)表示 + 🔊アイコン化 設計

**日付:** 2026-06-18
**ブランチ:** `feature/popup-audio-ipa-cambridge`（同じポップアップ改修のため積み増し）

## ゴール

字幕クリックで開くポップアップに、選択語句の**一般的な訳語**（辞書的な代表訳）を
単語の横へ表示する。あわせて 🔊 ボタンを**アイコンのみ**に変更する。

例:
```
×
language  言語・言葉・国語     ← 単語(青太字) + 訳語(淡色) を横並び
/ˈlæŋɡwɪdʒ/                  ← IPA
[🔊] [Cambridge ↗]
──────────
文脈での意味の説明文…          ← 従来どおり（文脈依存）
```

## 方針

- 訳語は既存の `explainSelection`（AI 1回呼び出し）を**拡張**し、1回のレスポンスで
  「一般訳」と「文脈依存の説明」の両方を構造化して受け取る。**追加API呼び出しなし**。
- **役割分担:** 訳語=文脈に依存しない一般訳（最大3つ・中黒区切り）／ 本文=従来の文脈依存解説。
- 単語・フレーズどちらでも表示する（フレーズは短い訳が出る）。
- APIキー未設定時は本文と同様に訳語も出ない（どちらもAIパート。IPA/🔊/Cambridge は鍵なしで動作）。

## AI レスポンス形式

`buildExplanationPrompt` を次の厳密形式で返すよう変更する:

```
訳: <一般訳1>・<一般訳2>・<一般訳3>
説明: <文脈に沿った2〜4文の説明>
```

- 「訳」は一般的な**日本語訳**（最大3つ・中黒「・」区切り・文脈非依存）。
- 「説明」は従来どおり `explanationLanguage` の言語で文脈依存。

## コンポーネント / ファイル

1. **`src/shared/prompts.ts`**（修正）
   `buildExplanationPrompt` の system を上記構造化形式の指示に変更。
   user（文＋選択語）は従来どおり。既存の言語ラベル（日本語/English/両方）は維持。

2. **`src/shared/explanation.ts`**（新規・純粋関数）
   ```ts
   export interface ParsedExplanation { gloss: string | null; explanation: string }
   export function parseExplanation(raw: string): ParsedExplanation
   ```
   - `訳:`(全角コロン・「訳語:」も許容) 行から gloss を、`説明:` 以降から explanation を抽出。
   - gloss は区切り（、 , ・ ／ /）を `・` に正規化し最大3つに丸める。空なら null。
   - ラベルが無い場合（旧キャッシュ・形式逸脱）: gloss=null、全文を explanation に（安全に劣化）。

3. **`src/content/overlay.ts`**（修正）
   - `.sel` を「単語(span.sel-word) + 訳語(span.gloss)」の横並びに再構成。CSS追加。
   - `setPopupMeaning(text, gloss)` に拡張（gloss が null/空なら非表示）。
   - 🔊 ボタンを `'🔊'`（アイコンのみ）に。title「発音を再生」は維持。
   - `popupGloss` 状態を追加。`hidePopup` でリセット。

4. **`src/content/interaction.ts`**（修正）
   応答を `parseExplanation` で分解し `setPopupMeaning(explanation, gloss)` に渡す。

## テスト

- `tests/explanation.test.ts`（新規）: parseExplanation の各ケース
  （正常 / 全角コロン / 訳語: 変種 / 説明ラベル欠如 / 両ラベル欠如 / 空訳語 /
  区切り正規化と3件上限 / 複数行説明 / 空入力）。
- `tests/prompts.test.ts`（追記）: system が構造化形式（`訳:` / `説明:` / 中黒・最大3）を
  指示していること。既存3アサーションは維持。
- 手動: Prime Video で単語クリック → 単語の横に訳語、本文に説明、🔊がアイコンのみ。

## エラー処理 / エッジ

- AIが形式を外す → 本文は必ず表示（訳語のみ省略）。クラッシュなし。
- 旧キャッシュ（無形式）→ 同じく gloss=null で本文表示。キャッシュキー変更は不要。
- 長い訳語 → ポップアップ最大幅で折り返し。内容確定後に再配置。
- handler は変更なし（解析は content 側）。`handler.test.ts` も不変。
