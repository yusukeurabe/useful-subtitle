# リアルタイム字幕の頭から再生するボタン 設計

**日付:** 2026-06-24
**ブランチ:** `feature/live-caption-replay-button`

## ゴール

画面中央に表示されている**リアルタイム字幕の先頭に再生ボタン（▶）を置く**。
押すと、**いま表示されている字幕が現れた瞬間の動画位置へ巻き戻して再生**する。
履歴パネルではなく、再生中の字幕そのものから「もう一度聞き直す」ためのワンクリック動線。

## 方針（採用＝overlay にコールバックを追加）

既存の `onLookup` / `onPlayAudio` と同じ「**overlay はコールバックを呼ぶだけ、シーク自体は `index.ts` の `seekVideo` に委ねる**」作法に合わせる。
履歴行クリックと同じ `seekVideo` を使えば、停止中の二重 play / Prime の再生ボタン押下まで含めた実証済みの巻き戻し再生がそのまま使える。

### 主な変更点
- `OverlayCallbacks` に `onSeek: (videoTime: number) => void` を追加。
- `Overlay.renderLine(sentence, tokens, videoTime)` に `videoTime` 引数を追加。overlay 内に「現在の字幕の頭時刻」として保持する。
- `.subtitle` 内、`.original` の左外に**絶対配置**で▶ボタンを描画する。`opacity:0` をデフォルトとし、`.subtitle:hover` で `opacity:0.9` まで上げる（既存の `.pos-controls` と同じトーン）。
- ボタンのクリックで `cb.onSeek(currentLineVideoTime)` を呼ぶ。
- `clearLine()` で字幕が消えたときはボタンも消す。
- `index.ts` は既に握っている `videoTime`（履歴記録用と同値）を `renderLine` に渡し、`onSeek: seekVideo` を配線する。

### 不採用案
- **B: overlay 内で `findVideo()` を直接呼ぶ** — overlay は DOM レンダリングに専念しており、`findVideo` 等の動画制御を依存に持たせると責務が混ざる。callback 経由が既存方針と整合。
- **C: 履歴パネルから再生ボタンを生やす（リアルタイム行を加える）** — ユーザー要求は「履歴ではなく、表示中の字幕そのものに」だったので不採用。

## なぜ「履歴と同じ `videoTime`」を使うか

履歴に記録するのは `startCaptionObserver` のコールバック内で `findVideo()?.currentTime ?? 0` を読んだ値（`index.ts:115`）。
これは「字幕が DOM に現れた瞬間の再生位置」で、履歴行クリックの戻り先と完全に一致する。
overlay の▶もこの値を再利用すれば、**履歴クリックと▶クリックで戻る位置がブレない**。

## なぜ▶は絶対配置か

字幕は `text-align: center` で水平中央。インラインで▶を入れるとテキストの中心が右へずれ、ホバー時に字幕全体が動いて見える。
`.original` を `position: relative` にし、▶を `position: absolute; right: 100%` で左外へ吊るすと、▶の表示／非表示でテキストの中心は動かない。

## コンポーネント / ファイル

### 1. `src/content/overlay.ts`（修正）
- `OverlayCallbacks` に `onSeek: (videoTime: number) => void` を追加。
- `Overlay.renderLine` のシグネチャを `renderLine(sentence: string, tokens: Token[], videoTime: number): void` に変更。
- 内部状態に `let currentLineVideoTime = 0;` を追加（renderLine で上書き、clearLine で 0 に戻す）。
- `subtitle` の構造に▶ボタン要素を加える：
  - `<button class="replay-btn">▶</button>` を `original` の中（先頭）に挿入し、`.original { position: relative; }` で位置基準に。
  - クリックで `cb.onSeek(currentLineVideoTime)`。
- `STYLES` に以下を追加：
  - `.original { position: relative; display: inline-block; }`（インラインブロックで中央配置の中身として扱われる幅を持つ）
  - `.replay-btn { position: absolute; right: 100%; top: 50%; transform: translateY(-50%); margin-right: 8px; opacity: 0; ... }`
  - `.subtitle:hover .replay-btn { opacity: 0.9; }`
  - 既存の `.pos-btn` と同じ寸法・色感（32x32、半透明黒、ホバーで青系）。
- `clearLine()` で `currentLineVideoTime = 0` にし、▶を非表示にする（または `replaceChildren()` で消える既存処理に乗せる）。

### 2. `src/content/index.ts`（修正・配線）
- `createOverlay` の `callbacks` に `onSeek: seekVideo` を渡す。
- `startCaptionObserver` のコールバックで、`overlay.renderLine(text, tokenizeLine(text))` の呼び出しを `overlay.renderLine(text, tokenizeLine(text), videoTime)` に変更。`videoTime` は既存の `findVideo()?.currentTime ?? 0` をその位置で読む（履歴記録と同じ値）。
- 記録ロジックは無変更（順序的に renderLine と record で `findVideo()` を二回読むことになるが、ms 単位の差なので問題なし。気になれば一度読んで両方で使う）。

## 見た目

```
通常時：
                  Hello, world.
                  こんにちは、世界。

ホバー時：
                ▶ Hello, world.
                  こんにちは、世界。
```

- ▶は字幕中央のテキストの左外側、字幕の高さの真ん中。
- 通常は不可視、字幕領域にマウスを乗せるとフェードイン（既存の▲▼と同じ）。

## 挙動

- ▶クリック → `seekVideo(videoTime)` → 字幕が出た瞬間まで巻き戻し、即再生再開。
- 動画が**停止中**でも、履歴クリックと同じ多段 play で確実に再開する（`seekVideo` の仕様）。
- 字幕が無いとき（`clearLine`）は▶も無い。
- 字幕が次の文に切り替わると、▶のクリック先も新しい文の videoTime に切り替わる。
- 全画面でも動作（overlay は既に `document.fullscreenElement` 追従済み）。

## テスト（TDD）

### `tests/overlay.test.ts`（新規・jsdom）
- `renderLine(sentence, tokens, videoTime)` を呼ぶと▶ボタンが描画され、shadow DOM 上に `replay-btn` が存在する。
- ▶のクリックで `onSeek` が `videoTime` を引数に1回呼ばれる。
- `renderLine` を別の videoTime で再度呼ぶと、次のクリックは新しい videoTime で `onSeek` を呼ぶ（古い値は引きずらない）。
- `clearLine()` 後は▶が無くなる（あるいはクリックしても `onSeek` が呼ばれない）。

### 既存テスト
- `tests/videoControl.test.ts` の `seekVideo` 既存テストでシーク挙動はカバー済み（▶は呼び出し元が増えるだけ）。

### 手動（実機）
- 通常再生中：▶クリックで字幕の頭へ戻って再生継続。
- 停止中：▶クリックで字幕の頭へ戻り、再生開始。
- 次の字幕に切り替わったあと▶クリック：新しい字幕の頭へ戻る。
- 全画面でも▶が見え、ホバーで明るくなり、クリックで効く。

## 非ゴール（YAGNI）

- ▶を常時表示にする設定項目は追加しない（ホバー表示で固定）。
- キーボードショートカット（例：「現在の字幕の頭へ」のホットキー）は追加しない。
- ▶の代わりに「字幕の各単語の頭」へ細かく戻すような機能は追加しない（字幕単位のみ）。

## 反映（ビルド/リロード）

- watch ビルド（`npm run dev`）で `dist` を再ビルド。拡張の再読み込み（↻）＋ページ再読み込み（F5）の両方（MV3 仕様）。
