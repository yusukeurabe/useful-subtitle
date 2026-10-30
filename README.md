# Useful Subtitle — Prime Video・YouTube 英語学習字幕

Amazon Prime Video・YouTube の字幕の **単語・フレーズ・イディオム** をクリックすると、**Claude（Anthropic）が文脈に沿った日本語解説** をその場で表示する Chrome 拡張機能です。

> 個人用の英語学習ツール（非公式。Amazon / Google / Anthropic とは無関係）。

## 主な機能

- 字幕の単語クリック → 意味をポップアップ表示（日本語）
- フレーズ／イディオムはドラッグで範囲選択 → 解説
- クリックで動画を自動一時停止
- 字幕一文の日本語訳を併記（デュアル字幕）

## 仕組み

- Prime Video（`.atvwebplayersdk-captions-text`）または YouTube の標準プレイヤー（`#movie_player` 内の `.ytp-caption-segment`）が描画する字幕テキストを `MutationObserver` で読み取り、クリック可能なカスタム字幕に置き換え
- 解説・翻訳は設定した接続方式を使用。既定は Anthropic Messages API、任意でこの Mac の Claude Code を使う Claude サブスク方式に切り替え可能
- 既定モデルは Claude Haiku 5.5 / `claude-haiku-5-5`。利用できない場合もモデル・接続方式を自動で切り替えません
- API キーは `chrome.storage.local` に保持。サブスク方式ではキーを接続プログラムに渡しません

## セットアップ

```bash
npm install
npm run build      # esbuild → dist/
```

1. Chrome の `chrome://extensions` → デベロッパーモード ON
2. 「パッケージ化されていない拡張機能を読み込む」→ `dist/` を選択
3. ツールバーのアイコンから設定を開き、接続方式を選択。API 方式は Anthropic API キー（<https://console.anthropic.com> で取得）を入力 →「接続テスト」。サブスク方式は以下の登録を行います。

既存利用者は更新後に拡張機能を再読み込みしてください。保存済みの旧既定モデル（`claude-haiku-4-5-20251001` / `claude-haiku-4-5`）は次回の設定読み込み時に Haiku 5.5 へ自動移行します。API キー・その他の設定・カスタムモデルは維持します。

## Claude Pro の利用枠で接続する（macOS / Brave・Chrome）

1. Node.js と公式 Claude Code をインストールし、Claude Code で利用する **Claude Pro のアカウント** にログインします。API キーによる CLI 認証では動きません。CLI の `subscriptionType` 表示だけで契約や課金設定を判断せず、Claude アカウント側も確認してください。
2. 拡張の設定画面で「Claude サブスク（この Mac の Claude Code）」を選択。表示された拡張機能 ID とコマンドを使います。API キー・モデル・各スイッチの保存値は保持します。
3. useful-subtitle のフォルダ（`package.json` がある場所）をターミナルで開き、設定画面からコピーしたコマンドを実行します。以下の `EXTENSION_ID` は設定画面の値に置き換えます。

```bash
npm run setup:native -- --browser brave --extension-id EXTENSION_ID --dry-run
npm run setup:native -- --browser brave --extension-id EXTENSION_ID
```

Chrome は `--browser chrome` にします。Claude Code が PATH にない場合は `--claude-path /absolute/path/to/claude` を追加できます。`--dry-run` は変更せず登録先を表示します。

4. 拡張機能を再読み込みし、設定画面の「接続テスト」を実行します。動画タブも再読み込みしてください。普段はターミナルや開発サーバーを起動しておく必要はありません。

Native Messaging の名前は `com.useful_subtitle.claude`。登録先は Brave が `~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.useful_subtitle.claude.json`、Chrome が `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.useful_subtitle.claude.json` です。登録 JSON の `allowed_origins` は指定した拡張 ID のみ、`path` はアプリ専用の `launch.sh` を指します。

接続プログラムは `~/Library/Application Support/UsefulSubtitle/` 配下の `runtime/` にコピーされ、ブラウザ別の `brave/` または `chrome/` に `launch.sh` と `config.json` が保存されます。設定には Node.js・Claude Code の絶対パスを記録します。CLI のパス変更時や `native/` 更新時はセットアップを再実行してください。拡張の再読み込みだけでは、コピー済みの接続プログラムは更新されません。他のホスト登録やブラウザの Preferences は変更しません。

解除は登録時と同じブラウザ・IDを指定します。

```bash
npm run setup:native -- --browser brave --extension-id EXTENSION_ID --uninstall
```

このブラウザの登録 JSON、`launch.sh`、`config.json` を削除します。共有 `runtime/`、作業用ディレクトリとロックは残します。他ブラウザで利用中の場合もあるため、共有ファイルを自動では削除しません。

### CLI の要件と処理の境界

接続プログラムは `claude -p` のほか、`--safe-mode`、`--setting-sources`、`--settings`、`--tools`、`--disallowedTools`、`--strict-mcp-config`、`--mcp-config`、`--disable-slash-commands`、`--no-chrome`、`--no-session-persistence`、`--output-format json`、`--max-turns`、`--effort low`、`--model`、`--system-prompt` と `auth status --json` に対応する Claude Code を必要とします。未対応の場合は CLI を更新して再登録してください。隔離機能を外して実行するフォールバックはありません。

ツール・MCP・hooks・外部設定を無効化した専用作業ディレクトリで実行し、CLI セッションに字幕を保存しません。思考を無効化せず、低 effort を使用します。CLI に渡す出力トークン数の上限は最低 1024 に設定しますが、毎回 1024 トークン以上を使うという意味ではありません。接続プログラムはローカルですが、推論のため字幕・選択語句・文脈を Claude のサーバーに送信します。API への自動切り替えはありません。

接続中の CLI はアプリ全体で1件。タブごとに最新の未処理翻訳だけを残し、操作による解説・接続テストを優先します。待機は翻訳8タブ・操作8件まで。拡張側は55秒でタイムアウトし、30秒の無処理後に切断します。接続プログラム側にも45秒の要求タイムアウトと60秒の無処理終了があります。

### 接続できない場合

- **登録エラー**: 設定画面の拡張 ID・ブラウザを確認して再登録し、拡張を再読み込みします。Node.js / Claude Code のパス変更後も再登録が必要です。
- **認証エラー**: 利用する契約アカウントで Claude Code にログインし直します。API 認証からサブスクに無断で切り替えることはありません。
- **利用上限・通信エラー**: 自動の再接続を60秒停止します。認証・セットアップ・不明な CLI エラーでも同様に連続起動を抑えます。設定画面の「接続テスト」からは明示的に再確認できます。
- **モデルエラー**: 指定モデルが契約で利用できるか確認します。別のモデルへの変更はユーザーが設定画面で行います。
- **処理中が続く**: まず Useful Subtitle の要求と、このアプリが起動した Claude プロセスがすべて終了したことを確認します。それでもロックが残る場合だけ `~/Library/Application Support/UsefulSubtitle/locks/` の内容を手動で削除します。無関係の Claude プロセスは停止しないでください。永続ロックは再起動だけでは必ずしも消えません。

実際の Pro アカウントによる推論速度、Brave からの接続テスト・動画操作は実環境での確認が必要です。自動テストはモックで境界・キュー・設定を検証するもので、リアルタイム性能の保証ではありません。

## 使い方

1. Prime Video または YouTube の通常の動画ページ（`/watch?v=...`）で再生し、**英語字幕を ON**
2. YouTube では Language Reactor など他の字幕拡張を OFF にする（表示の重複・字幕取得の競合を防ぐ）
3. 単語クリック／フレーズをドラッグ選択 → 解説ポップアップ（`×` / Esc / 外側クリックで閉じる）

## 費用の目安

- API 方式は選択モデル・送受信トークン数・回数に応じた従量課金です。
- サブスク方式は Claude / Claude Code と契約の利用枠を共有し、無制限ではありません。**月額内で使うには Claude アカウントの「追加使用」を OFF にしてください。** 追加使用が有効なら上限後の課金が発生する可能性があり、この拡張だけで固定費を保証できません。
- CLI 起動の待ち時間が加わるため、全行のリアルタイム和訳は保証しません。
- デュアル字幕を OFF にすると、新しい自動翻訳の送信を停止します。拡張機能を OFF にすると、新しい翻訳・解説の送信を停止します。表示への反映や ON に戻した後の再開には、開いている動画タブの再読み込みが必要な場合があります。明示的な接続テストは OFF の状態でも使えます。
- キャッシュに残っている同一リクエストは AI を呼び出しません（方式・モデル・言語ごとに別のキャッシュになります）。

## 開発

```bash
npm test           # ユニットテスト（vitest）
npm run typecheck  # tsc --noEmit
npm run build      # esbuild → dist/
```

主要ロジック（プロンプト生成・設定・キャッシュ・API クライアント・メッセージ処理・字幕抽出・トークナイズ）は TDD で実装。DOM/UI 層は実機での動作確認を前提とする。

## 注意・既知の制約

- YouTube はデスクトップ版 `www.youtube.com` / `youtube.com` の通常動画が対象です。ホームからのページ内遷移にも対応します。Shorts・埋め込み・モバイル版は対象外です。
- 画面に現れた標準字幕だけを読みます。字幕のない動画、未再生部分の先読み、音声認識には対応しません。
- YouTube の広告中は取得・翻訳送信・履歴記録を止めます。同じ動画の広告や尺の変化では履歴を消さず、別の動画 ID へ移ると履歴をリセットします。
- YouTube の自動字幕は細かく更新されるため、履歴に途中の断片や重なる文章が残ることがあります。英語表示は即時更新し、翻訳送信は350ミリ秒まとめます（更新が続く場合は最大1.5秒待機）。途中の履歴には訳が付かない場合があります。API 応答時間も加わるため、更新が速い箇所では現在の字幕の訳が間に合わないことがあります。

- Amazon / YouTube のプレイヤー更新で字幕セレクタが変わると動作しなくなる可能性があります（`src/shared/selectors.ts` のフォールバックで吸収を試みます）
- 字幕がオフだと読み取れません（再生側で英語字幕を ON にしてください）
- 字幕テキスト・選択語句は解説のため選択した方式で Claude に送信されます

## ライセンス

[MIT License](./LICENSE) — © 2026 Yusuke Urabe
