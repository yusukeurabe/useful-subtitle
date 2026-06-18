# 字幕ポップアップに「発音記号(IPA)・音声再生・Cambridge リンク」を追加 設計

- 日付: 2026-06-18
- 対象: useful-subtitle（Prime Video 英語学習字幕 Chrome 拡張、MV3）

## 1. 背景と目的

字幕の単語/フレーズをクリックすると、意味を解説するポップアップが表示される（既存機能）。
学習効率を上げるため、このポップアップに次の3つを追加する。

1. その単語の **発音記号（IPA）** 表示（例: `/rɪˈzɪliənt/`）
2. その単語/フレーズの **音声再生ボタン**（発音を聞ける）
3. その単語の **Cambridge Dictionary（英英）ページへのリンク**

IPA と音源URLはどちらも同じ無料辞書API（`api.dictionaryapi.dev`）の1回の取得で得られるため、まとめて取得する。

## 2. スコープ

### 今回やる
- ポップアップに **IPA 行**・**操作列（🔊 発音ボタン＋ Cambridge リンク）** を追加
- ポップアップを開いた時点で（単語のとき）辞書情報（IPA＋音源URL）を **先読み取得** し、IPA を表示
- 発音再生：**単語はネイティブ人間音源**（辞書APIの音源URL）、**音源が無い/フレーズはブラウザ内蔵の読み上げ（Web Speech API）にフォールバック**
- ネイティブ音源は **offscreen document（拡張側）で再生** し、Prime Video のページCSPに妨げられず確実に鳴らす
- Cambridge は **英英（English monolingual）** ページへ。1単語は直接ページ、フレーズは検索エンドポイント

### 今回やらない（将来検討）
- 操作列やIPA表示のオン/オフ設定トグル（要望が出たら追加＝YAGNI）
- 辞書情報のアプリ内キャッシュ（HTTPキャッシュに任せる。同一語の再取得最適化は将来）
- 英和辞書・複数辞書の切替（今回は英英で確定）
- フレーズの IPA 表示（無料辞書APIは単語単位のため、フレーズはIPAなし）
- offscreen 再生失敗時の精密なエラー通知（v1 は best-effort。9章参照）

## 3. UI 設計（ポップアップ）

既存ポップアップ（`overlay.ts`）は「× / 選択語(.sel) / 意味(.body)」の構成。
これを次の構成に拡張する（ヘッダ部は安定して残り、意味本文だけが「考え中…」→結果へ更新される）。

```
┌─────────────────────────────┐
│                          ×  │
│  resilient                  │  ← .sel（選択語：既存）
│  /rɪˈzɪliənt/               │  ← ★IPA行(.ipa)：単語で取得できたとき表示
│  [ 🔊 発音 ]  [ Cambridge ↗ ]│  ← ★操作列(.actions)
│  ───────────────────────    │
│  立ち直りが早い、回復力の…    │  ← .body（意味：既存・AI生成）
└─────────────────────────────┘
```

- ヘッダ（.sel / .ipa / .actions）は **選択語があるとき常に表示**。意味の取得中（"考え中…"）でも操作列とIPAは先に使える/見える。
- IPA行は **取得できたときだけ表示**（フレーズや未収録語では非表示）。
- 操作列の **Cambridge リンクは選択語から即時生成**（取得を待たない）。
- 意味の取得が失敗しても、ヘッダ（IPA・🔊・リンク）は維持し、本文だけエラー表示にする。
- スタイルは既存ダークテーマ（背景 `#1e1e1e` / アクセント `#8ab4ff`）に合わせる。IPA は淡色・等幅寄り。
- 非同期で IPA や意味が入って高さが変わるため、内容更新後に再度位置調整（`positionPopup`）する。
- Shadow DOM 内のため、ボタン/リンクのクリックは既存の「外側クリックで閉じる」判定（`onDocMouseDown` の `e.target !== host`）に当たらず、**ポップアップは閉じない**。リンクは新規タブで開く。

## 4. データフロー

```
単語/フレーズをクリック → runLookup(interaction.ts)
  ├─ overlay.openPopup(anchor, selection)
  │     → .sel 表示 / Cambridge リンク生成 / 本文=「考え中…」/ IPA行は空
  ├─ loadWordInfo(content/word.ts)  ※単語のときのみ
  │     → sendRequest({type:'lookupWord', text})  → background（APIキー不要）
  │           normalizeWord → 単語なら 辞書API取得 → extractWordInfo()
  │           ← {ok:true, kind:'word', ipa, audioUrl}
  │     → overlay.setPopupWordInfo(ipa, audioUrl)  // IPA行表示・audioUrl保持
  └─ sendRequest({type:'explainSelection', selection, context})  → background（APIキー必須・既存）
        ← 意味テキスト
        → overlay.setPopupMeaning(text) / setPopupError(message)

🔊 クリック → overlay callbacks.onPlayAudio(selection, audioUrl)  → playPronunciation(content/audio.ts)
  ├─ audioUrl あり → sendRequest({type:'playAudio', url}) → background
  │     ensureOffscreen() → offscreenへ {target:'offscreen', url} → new Audio(url).play()
  │     ← {ok:true, kind:'audio', played:true}
  │     played:false なら ↓ へ
  └─ audioUrl なし / played:false → content で speechSynthesis 読み上げ（TTSフォールバック）
```

- 単語 → ネイティブ音源があればそれを offscreen で再生。なければ TTS。
- フレーズ → 先読みしない（IPAなし）。🔊 は TTS でフレーズ全体を読み上げ。
- いずれの経路でも「必ず何か鳴る」。

## 5. 無料辞書API と抽出

- エンドポイント: `https://api.dictionaryapi.dev/api/v2/entries/en/<word>`（APIキー不要）
- レスポンスは配列。各エントリに `phonetic?`（代表IPA）と `phonetics[]: { text?, audio? }`。
- 音源URLは多くが同ホスト `https://api.dictionaryapi.dev/media/pronunciations/...`。
- `extractWordInfo(json): { ipa: string|null, audioUrl: string|null }`（純関数）:
  1. 全エントリの `phonetics` を集約。`audio` が非空のものを候補に。
  2. 音源は **US（`-us`）→ UK（`-uk`）→ 最初の非空** の優先で1つ選ぶ。
  3. IPA は **選んだ音源と同じ要素の `text` → 最初の非空 `text` → 代表 `phonetic`** の順で1つ選ぶ（音源とアクセントを極力一致）。
  4. それぞれ無ければ `null`。不正/空JSONでも例外を投げず `{null,null}`。

## 6. Cambridge リンク（英英）

`cambridgeUrl(selection)`（純関数）で URL を生成。

- **1単語**: `https://dictionary.cambridge.org/dictionary/english/<encodeURIComponent(正規化語)>`
- **フレーズ**: 検索エンドポイント
  `https://dictionary.cambridge.org/search/direct/?datasetsearch=english&q=<encodeURIComponent(フレーズ)>`
  （最適項目へリダイレクト。正確なパラメータは実装時に実機確認）
- リンクは `<a target="_blank" rel="noopener noreferrer">`。

## 7. 単語の正規化（共通）

`normalizeWord(selection)` / `isSingleWord(selection)`（純関数）。

- 前後空白除去・連続空白を1つに。
- 前後の記号を除去（`Hello,`→`hello`）。内部の `'`（`don't`）・`-`（`well-known`）は保持。
- 小文字化（API照合・URL生成用）。`isSingleWord` は正規化後に内部空白が無ければ true。

## 8. アーキテクチャ

### 新規ファイル
- `src/shared/dictionary.ts` — 純関数: `normalizeWord` / `isSingleWord` / `cambridgeUrl` / `extractWordInfo`（戻り値型 `WordInfo`）
- `src/content/word.ts` — 単語のとき `lookupWord` を投げて IPA＋音源URLを overlay に渡す
- `src/content/audio.ts` — 🔊 の再生オーケストレーション（音源URLあれば offscreen 再生依頼／無ければ TTS）
- `src/offscreen/offscreen.html` — offscreen の最小 HTML（`offscreen.js` を読む）
- `src/offscreen/index.ts` — `{target:'offscreen', url}` を受けて `new Audio(url)` 再生
- `tests/dictionary.test.ts` — 上記純関数のユニットテスト

### 変更ファイル
- `src/content/overlay.ts` — ポップアップを「安定ヘッダ＋更新本文」構造へ。IPA行・操作列（🔊＋Cambridge）追加。`OverlayCallbacks` に `onPlayAudio` 追加。popup API を `openPopup`/`setPopupMeaning`/`setPopupError`/`setPopupWordInfo`/`hidePopup` に整理。CSS追加。
- `src/content/interaction.ts` — `runLookup` を新 popup API に合わせて更新。`loadWordInfo` を並行起動。
- `src/content/index.ts` — overlay 生成時に `onPlayAudio` を配線（`content/audio.ts` を利用）。
- `src/background/handler.ts` — `lookupWord`・`playAudio` を **APIキー確認より前** に処理。`HandlerDeps` に `getWordInfo(word)`・`playOffscreenAudio(url)` を追加（DIでテスト容易化）。
- `src/background/index.ts` — 実依存の組み立て（辞書API fetch＋`extractWordInfo`＝`getWordInfo`、offscreen 制御＝`playOffscreenAudio`）。`{target:'offscreen'}` メッセージは background では無視。
- `src/shared/types.ts` — `LookupWordRequest`/`PlayAudioRequest` と `WordInfoResponse`/`AudioResponse` を追加。`RequestMessage` に2種追加。
- `src/shared/messages.ts` — `sendRequest` をオーバーロード（`lookupWord`→`WordInfoResponse|ErrorResponse`、`playAudio`→`AudioResponse|ErrorResponse`、既存→`ResponseMessage`）。
- `manifest.json` — `permissions` に `offscreen`、`host_permissions` に `https://api.dictionaryapi.dev/*` 追加。
- `build.mjs` — entryPoints に `offscreen` 追加、`offscreen.html` を dist へコピー。

## 9. メッセージ型

```ts
// types.ts（追加）
interface LookupWordRequest { type: 'lookupWord'; text: string }
interface PlayAudioRequest  { type: 'playAudio'; url: string }

interface WordInfoResponse { ok: true; kind: 'word';  ipa: string | null; audioUrl: string | null }
interface AudioResponse    { ok: true; kind: 'audio'; played: boolean }
// 既存 ResponseMessage(= SuccessResponse{ok,text} | ErrorResponse) は変更しない。
// handleRequest 戻り値は ResponseMessage | WordInfoResponse | AudioResponse。
```

- `lookupWord`/`playAudio` は `handleRequest` の **最初** で分岐し、APIキー無しでも処理（既存の翻訳/解説は従来どおりキー必須）。
- offscreen への指示は `chrome.runtime.sendMessage({ target:'offscreen', url })`。background 自身の onMessage は `target:'offscreen'` を無視。

## 10. エラー処理・フォールバック

- **IPA/音源なし・辞書API失敗・フレーズ**: `lookupWord` は `{ipa:null,audioUrl:null}` を返す（例外は握りつぶす）。IPA行は非表示、🔊 は TTS。
- **TTS 非対応環境**: `speechSynthesis` が無ければ静かに何もしない（例外を投げない）。
- **offscreen 再生の失敗（URL 404 等）**: v1 は best-effort。`played:true` 返却後の稀な無音は許容（ログのみ）。
- **メッセージ送信失敗**: 既存 `sendRequest` の正規化に従い、content 側は TTS フォールバックへ。
- **ポップアップ表示への影響なし**: IPA/音声/リンクは意味取得と独立。失敗しても意味表示は従来どおり。

## 11. テスト方針

- `tests/dictionary.test.ts`（新規・TDD）:
  - `normalizeWord`: 前後記号除去、内部 `'`/`-` 保持、空白圧縮、空文字。
  - `isSingleWord`: 単語/フレーズ/前後空白。
  - `cambridgeUrl`: 1単語の直接URL、フレーズの検索URL、`encodeURIComponent` 適用。
  - `extractWordInfo`: US優先・UK次点の音源選択、IPAの音源一致/フォールバック（最初のtext→代表phonetic）、空`audio`/`text`スキップ、`phonetics`無し/空配列/不正JSONで`{null,null}`。
- `tests/handler.test.ts`（更新）:
  - `lookupWord` が **APIキー無し**でも処理される（NO_API_KEY を返さない）。
  - 単語で `getWordInfo` の結果（ipa,audioUrl）をそのまま返す。
  - フレーズなら `getWordInfo` を呼ばず `{ipa:null,audioUrl:null}`。
  - `playAudio` が url ありで `playOffscreenAudio` を呼び `played:true`、url 空で `played:false`。
  - `playAudio`/`lookupWord` が **APIキー無し**でもエラーにならない。
- DOM/UI 層（ポップアップのIPA行・操作列・実際の音声再生・offscreen・新規タブ遷移）は、README の方針どおり **実機（Prime Video）での動作確認**を前提とする。

## 12. 実装順序

1. `src/shared/dictionary.ts` を TDD（`tests/dictionary.test.ts`）で固める。
2. 型・メッセージ（`types.ts` / `messages.ts`）を追加。
3. background の `lookupWord`/`playAudio` 処理＋ handler テスト（DI）。
4. offscreen（html / index.ts）と `build.mjs`・`manifest.json` の配線。
5. content の `word.ts`（IPA先読み）・`audio.ts`（再生）。
6. overlay 改修（安定ヘッダ＋更新本文、IPA行、🔊、Cambridge リンク）と `interaction.ts`・`index.ts` 配線。
7. ビルド・全テスト・Prime Video 実機確認（単語のIPA表示＋ネイティブ音源／フレーズのTTS／英英リンク）。
