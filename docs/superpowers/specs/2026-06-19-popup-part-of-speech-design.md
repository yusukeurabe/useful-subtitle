# ポップアップ品詞表示（品詞ごとの訳語） 設計

**日付:** 2026-06-19
**ブランチ:** `feature/popup-part-of-speech`（`main` から派生予定）

## ゴール

字幕クリックで開くポップアップに、選択語の**品詞**を Cambridge 学習英英辞典式の表記
（`Adj.` `Adv.` `V[I]` `V[I/T]` `N[C]` `N[C/U]` など）で表示する。
現在は単語の横に並んでいる一般訳を、**品詞ごとに分けて各品詞の横へ**表示する。

レイアウト（例: run）:
```
×
run                         ← 単語(青太字) を単独行
V[I/T]   走る・運営する       ← 品詞コード + その品詞の訳（中黒・最大3）
N[C]     走ること・得点
/rʌn/                       ← IPA（従来どおり）
[🔊] [Cambridge ↗]
──────────
この文では「走る」の意味で… ← 文脈依存の説明（従来どおり）
```

- 単語は1行目に単独。単語の後で改行し、その後は品詞ごとに改行する。
- 品詞コード（左・桁揃え）＋その品詞の日本語訳（右・中黒区切り・最大3つ）。
- 文脈に関係なく、その語が一般に取りうる品詞を**すべて**列挙する。

## 方針

- 品詞・訳は既存の `explainSelection`（AI 1回呼び出し）を**拡張**して取得する。**追加API呼び出しなし・追加待ち時間なし**。
- 品詞コードの `[C/U]` / `[I/T]` 表記と品詞別の和訳は、IPA/音声に使う無料辞書API（dictionaryapi.dev）では取得できないため、**AI が唯一の情報源**。
- 役割分担: 品詞行＝文脈非依存（その語が一般に取る品詞と代表訳）／ 本文＝従来の文脈依存の説明。
- フレーズ（複数語選択）は品詞行のかわりに、品詞コードなしの訳1行へフォールバックする。
- APIキー未設定時は本文と同様に品詞・訳も出ない（IPA/🔊/Cambridge は鍵なしで動作）。

## AI レスポンス形式

`buildExplanationPrompt` を次の形式で返すよう変更する。

単語の場合（品詞ごとに1行 + 説明）:
```
V[I/T]: 走る・運営する
N[C]: 走ること・得点
説明: <文脈に沿った2〜4文の説明>
```

フレーズの場合（品詞なしの訳1行 + 説明）:
```
訳: <短い訳>
説明: <文脈に沿った説明>
```

- 品詞行は `品詞コード: 訳1・訳2・訳3`。品詞コードは Cambridge 式:
  - 名詞: `N[C]`（可算）/ `N[U]`（不可算）/ `N[C/U]`（両方）
  - 動詞: `V[I]`（自動詞）/ `V[T]`（他動詞）/ `V[I/T]`（両方）
  - その他: `Adj.` `Adv.` `Pron.` `Prep.` `Conj.` `Det.` `Int.` `Num.` `Aux.` など
- 各品詞の訳は最大3つ・中黒「・」区切り・文脈非依存。
- 「説明」は従来どおり `explanationLanguage` の言語で文脈依存（2〜4文、イディオム・句動詞・スラングは補足）。
- 単語＝品詞行を列挙 / フレーズ＝`訳:` 1行、とプロンプトで指示する。

## データモデル / パーサ（`src/shared/explanation.ts`）

```ts
export interface WordSense {
  pos: string | null;   // "V[I/T]" | "N[C]" | ... / フレーズ・旧形式は null
  gloss: string;        // 中黒区切り・最大3
}
export interface ParsedExplanation {
  senses: WordSense[];  // 0件以上
  explanation: string;
}
export function parseExplanation(raw: string): ParsedExplanation
```

パース規則:
1. `説明:`（全角コロン可）行を境に、それ以降を explanation として抽出する。
2. **説明より前**の行から品詞行を抽出する。品詞行 = 行頭の任意の `- `/空白の後、品詞コード（`A-Za-z.[]/` の文字のみ）、`:`/`：`、訳。→ `{ pos, gloss }`。
3. 品詞行が1つも無く `訳:`（`訳語:` も可）行がある場合 → `{ pos: null, gloss }` の1件にする（フレーズ・旧キャッシュ）。
4. どのラベルも無い場合 → `senses=[]`、全文を explanation にする（安全に劣化）。
5. gloss は区切り（、 , ・ ／ /）を `・` に正規化し最大3つに丸める。正規化後に空になる品詞行は捨てる。

備考: 品詞コードの文字集合（`A-Za-z.[]/`）は日本語キー（`訳`/`説明`/`品詞`）と一致しないため、`説明:` 行や AI が付けがちな `品詞:` 見出し行は品詞行として誤検出されない。

## コンポーネント / ファイル

1. **`src/shared/prompts.ts`**（修正）
   `buildExplanationPrompt` の system を上記の品詞別形式に変更し、品詞コードの凡例を明記する。
   user（文＋選択語）と言語ラベル（日本語/English/両方）は従来どおり。

2. **`src/shared/explanation.ts`**（修正）
   `ParsedExplanation` を `{ senses, explanation }` に変更。`normalizeGloss`（中黒正規化・最大3）は維持し品詞ごとに適用。旧 `訳:`・ラベルなしのフォールバックを実装。

3. **`src/content/overlay.ts`**（修正）
   - `.sel-word` を単独行（block）にする。
   - `.senses` をグリッド（`grid-template-columns: auto 1fr`）で品詞列＋訳列を桁揃え表示。`pos=null` の件は訳のみ（コード列は空 or 1カラム）。
   - `setPopupMeaning(explanation: string, senses: WordSense[])` に変更。空配列ならグリッド非表示。
   - 旧 `popupGloss` 状態を `popupSenses` コンテナへ置換。`hidePopup` でリセット。
   - 品詞コードは等幅・淡色で表示する CSS を追加。
   - `Overlay` インターフェイスの `setPopupMeaning` シグネチャを更新。

4. **`src/content/interaction.ts`**（修正）
   応答を `parseExplanation` で分解し `setPopupMeaning(explanation, senses)` に渡す。

## テスト

- `tests/explanation.test.ts`（書き換え）:
  - 品詞行（複数）→ senses 配列＋explanation
  - 全角コロン
  - 中黒への正規化・3件上限（品詞ごと）
  - 複数行 explanation の保持
  - フレーズ/旧 `訳:` → `{pos:null}` 1件
  - `説明:` のみ → senses=[]、explanation=本文
  - ラベルなし（旧キャッシュ）→ senses=[]、全文 explanation
  - 空入力 → senses=[]、explanation=''
- `tests/prompts.test.ts`（更新）: system が品詞コード凡例（例: `V[I/T]` または「品詞」）と `説明:`、中黒・最大3 を指示していること。文＋選択語を含む既存アサーションは維持。
- 手動: Prime Video で単語クリック → 単語が単独行、品詞ごとに訳、IPA/🔊/Cambridge/説明は従来どおり。フレーズ選択 → 訳1行（コードなし）。

## エラー処理 / エッジ

- AI が形式を外す → 本文（説明）は必ず表示。品詞が無ければグリッド省略。クラッシュなし。
- 旧キャッシュ（`訳:`/無形式）→ 品詞なし1行 or 全文説明で表示。**キャッシュキー変更は不要**（プロンプトはキャッシュキーに含まれないため、既存語は旧形式のまま劣化表示、再クリックで新形式に置き換わる）。
- 長い訳 → ポップアップ最大幅で折り返し。内容確定後に再配置（`positionPopup`）。
- フレーズ → 品詞行なし、`訳:` 1行を品詞コードなしで表示。
- handler / cache は変更なし（解析は content 側）。`handler.test.ts`・`cache.test.ts` は不変。
