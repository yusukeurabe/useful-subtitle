# 単語ポップアップの IPA を Cambridge 由来に切り替える 設計

- 日付: 2026-06-20
- 対象: useful-subtitle（Prime Video 英語学習字幕 Chrome 拡張、MV3）

## 1. 背景と目的

現状、単語クリック時に表示する IPA は無料辞書 API（`api.dictionaryapi.dev`）から取得している。
このAPIのIPAは Wiktionary 由来で記法が一貫せず、ユーザーから「ケンブリッジ辞書のIPA表記のほうが好み」という要望が出た。

そこで、IPA の取得元を **Cambridge Dictionary（英英ページの US 発音）に切り替える**。
取得は Cambridge の公開ページの HTML スクレイピングで行い、Cambridge に未収録の語に限り既存の dictionaryapi.dev にフォールバックする。
音源 mp3 も Cambridge ページから併せて取得し、IPA と音源の出所を一致させる。

両ソースとも APIキー不要・無料のため、視聴中の従量課金は発生しない（既存と同じ）。

## 2. スコープ

### 今回やる
- Cambridge 英英ページ HTML を fetch → **US 発音セクション**から IPA テキストと音源 mp3 URL を抽出
- background の `getWordInfo` を「Cambridge を試す → 取れなければ dictionaryapi.dev を試す」の直列フォールバックに変更
- `manifest.json` の `host_permissions` に `https://dictionary.cambridge.org/*` を追加

### 今回やらない（YAGNI）
- UK / US の切替設定（US 固定で確定）
- 単語IPA結果のローカルキャッシュ（HTTPキャッシュに任せる。必要になってから追加）
- フレーズの Cambridge IPA 取得（フレーズは既存どおりIPA非表示）
- Cambridge 専用のリトライ・useragent偽装
- ポップアップUI／音源再生フロー（offscreen 経由）の変更

## 3. 現状と変更後の比較

| 項目 | 現状 | 変更後 |
|---|---|---|
| IPA 一次ソース | dictionaryapi.dev | Cambridge（US固定） |
| IPA フォールバック | なし | dictionaryapi.dev |
| 音源 一次ソース | dictionaryapi.dev | Cambridge mp3（US） |
| 音源 フォールバック | なし | dictionaryapi.dev |
| 必要 host_permissions | `api.dictionaryapi.dev` | + `dictionary.cambridge.org` |
| 視聴中のAPI呼び出し | なし | なし（不変） |
| Anthropic API 利用箇所 | 既存どおり | 既存どおり（変更なし） |

## 4. データフロー

```
単語クリック → loadWordInfo（content/word.ts）
  → sendRequest({type:'lookupWord', text}) → background
    handler.ts: !isSingleWord → {ipa:null, audioUrl:null}
    単語のとき → getWordInfo(word)
      ├─ tryCambridge(word)
      │    fetch https://dictionary.cambridge.org/dictionary/english/{word}
      │    HTML → extractCambridgeWordInfo(html)
      │    IPA が取れたら return（音源無しでも採用＝部分採用）
      └─ tryDictionaryApi(word)        // 既存 getWordInfo の中身そのまま
           fetch api.dictionaryapi.dev → extractWordInfo(json)
  ← {ok:true, kind:'word', ipa, audioUrl}
  → overlay.setPopupWordInfo(ipa, audioUrl)
```

- どちらの経路も APIキー不要。
- 両方とも取れなかった語（特に固有名詞・新語）は `{null,null}` → IPA非表示・音源TTSフォールバック（既存挙動と同じ）。

## 5. Cambridge HTML 抽出

新規純関数 `extractCambridgeWordInfo(html: string): WordInfo` を `src/shared/dictionary.ts` に追加。

### 抽出方針
- MV3 service worker でも使える `DOMParser`（Chrome 124+）で HTML を解析。
- 取得対象は US 発音セクションのみ。候補セレクタ（実装時に Cambridge の実HTMLで確定）:
  - **US ブロック**: `span.us.dpron-i`、見つからなければ `.posgram .us` などの代替
  - **IPA テキスト**: 上記ブロック内の `.ipa.dipa` の `textContent`
  - **音源 mp3**: 上記ブロック内の `source[type="audio/mpeg"]` の `src` 属性
- 音源 URL が相対パスなら `https://dictionary.cambridge.org` で絶対URL化してから返す（呼び出し側の取り回しを一貫させる）。
- IPA テキストの前後空白だけ `trim`。Cambridge の補助記号・スラッシュ等はそのまま採用。

### 異常系の方針
| 状況 | 返り値 |
|---|---|
| HTML が空文字 / パース不能 | `{ipa:null, audioUrl:null}` |
| US セクションが見つからない | `{ipa:null, audioUrl:null}` |
| IPA も音源も無い | `{ipa:null, audioUrl:null}` |
| IPA あり・音源なし | `{ipa, audioUrl:null}`（部分採用） |
| 音源あり・IPA なし | `{ipa:null, audioUrl:null}`（IPA が主目的なので Cambridge 不採用 → フォールバックへ）|

## 6. アーキテクチャ

### 変更ファイル

| ファイル | 変更内容 |
|---|---|
| `src/shared/dictionary.ts` | `extractCambridgeWordInfo(html)` を追加（純関数） |
| `src/background/index.ts` | `tryCambridge(word)` と `tryDictionaryApi(word)` の2関数に分割し、`getWordInfo` を直列フォールバックに |
| `tests/dictionary.test.ts` | Cambridge HTML 抽出のユニットテスト追加（fixture 文字列ベース） |
| `manifest.json` | `host_permissions` に `https://dictionary.cambridge.org/*` を追加 |

### 触らない箇所
- `src/background/handler.ts`（`HandlerDeps.getWordInfo` シグネチャ不変）
- `src/content/*`（IPA 表示・音源再生のフロントは既存のまま）
- `src/shared/types.ts`（メッセージ型は不変）
- offscreen 関連（音源再生フローは変えない）

## 7. background 実装スケッチ

```ts
// src/background/index.ts（抜粋イメージ）
const CAMBRIDGE_BASE = 'https://dictionary.cambridge.org';
const DICT_API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';

async function tryCambridge(word: string): Promise<WordInfo> {
  try {
    const res = await fetch(`${CAMBRIDGE_BASE}/dictionary/english/${encodeURIComponent(word)}`);
    if (!res.ok) return { ipa: null, audioUrl: null };
    const html = await res.text();
    return extractCambridgeWordInfo(html);  // 相対mp3パスは内部で絶対化
  } catch {
    return { ipa: null, audioUrl: null };
  }
}

async function tryDictionaryApi(word: string): Promise<WordInfo> {
  // 既存 getWordInfo の中身そのまま
  const res = await fetch(`${DICT_API}${encodeURIComponent(word)}`);
  if (!res.ok) return { ipa: null, audioUrl: null };
  const json = (await res.json().catch(() => null)) as unknown;
  return extractWordInfo(json);
}

async function getWordInfo(word: string): Promise<WordInfo> {
  const cam = await tryCambridge(word);
  if (cam.ipa) return cam;            // IPA が取れていれば採用（音源 null 可）
  return await tryDictionaryApi(word);
}
```

## 8. テスト方針

### tests/dictionary.test.ts に追加
- US セクション付きの最小限 Cambridge HTML fixture から:
  - IPA テキストが取れる
  - 音源 mp3 URL が取れ、相対パスなら絶対URL化される
- US セクション無し HTML → `{null,null}`
- 空文字 HTML → `{null,null}`
- IPA だけあり音源なし → `{ipa, audioUrl:null}`
- 音源だけあり IPA なし → `{null,null}`

### 既存テストの扱い
- `extractWordInfo`（dictionaryapi.dev 用）は無変更 → 既存テストそのまま緑。
- `handler.test.ts` も `HandlerDeps.getWordInfo` 不変 → 既存テストそのまま緑。

### 実機確認（README の方針どおり）
- Prime Video で字幕の単語をクリックして:
  - Cambridge 収録語（例: `resilient`, `ambiguous`）で Cambridge 由来の IPA が出る
  - Cambridge 未収録の固有名詞・新語で dictionaryapi.dev へフォールバックされる
  - 🔊 で Cambridge mp3 が再生される／取れない時は TTS

## 9. エラー処理

- Cambridge fetch 失敗（ネットワーク / 404 / 5xx）→ catch して `{null,null}` → フォールバック
- HTML パース失敗 → catch して `{null,null}` → フォールバック
- 両経路とも空 → IPA 非表示・音源 TTS フォールバック（既存挙動と同じ）
- 失敗中もポップアップは既存どおり開き続け、IPA だけ静かに出ない

## 10. 権限とリリース時の注意

- `manifest.json` の `host_permissions` に `https://dictionary.cambridge.org/*` を追加する関係で、拡張更新時に Chrome から「新しい権限を許可しますか？」確認が出る。
- これは仕様。README とリリースノートに「IPA を Cambridge から取得するため Cambridge へのアクセス権限を追加」と明記する。

## 11. パフォーマンス

- Cambridge HTML は dictionaryapi.dev の JSON より重い（数百KB）。1単語あたり 200〜400ms 程度クリックから IPA 表示までの体感増を想定。
- ポップアップは即時開きヘッダだけ先に表示し、IPA は後追いで入る既存パターンを維持するため、視認上の操作ブロッキングは無い。
- 結果キャッシュは今回入れない（YAGNI）。同一語の繰り返しクリックはブラウザの HTTP キャッシュ任せ。

## 12. 実装順序

1. `extractCambridgeWordInfo` を TDD（`tests/dictionary.test.ts`）で書く。Cambridge 実HTML から最小限の fixture を切り出して固める。
2. `src/background/index.ts` を Cambridge → dictionaryapi の直列フォールバック構造にリファクタ。
3. `manifest.json` の `host_permissions` を追加。
4. ビルド・全テスト・Prime Video 実機確認。
