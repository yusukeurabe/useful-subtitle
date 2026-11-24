# ポップアップから Claude に再ログインする — 設計

## 目的
解説ポップアップに「Claude Code で利用する Claude Pro アカウントにログインし直してください」（AUTH エラー）が出たとき、ターミナルを開かずにボタン一つで再ログインし、完了後に解説を自動で取り直す。

## 事前確認（2026-11-24 実機）
`claude auth login --claudeai < /dev/null`（TTY なし）でも「Opening browser to sign in…」と出てブラウザが自動で開き、ブラウザで許可すると `Login successful.` を出して終了コード 0 で自ら終了した。コード貼り付けは不要。

## 振る舞い
1. AUTH エラーのとき、ポップアップ上段（単語の解説）と下段（字幕全文の和訳）のエラー文の下に「ブラウザでログイン」ボタンを出す。
2. 押すと「ブラウザでログインを完了してください…」を表示し、Claude のログイン画面がブラウザで開く。
3. ログイン成功後、ポップアップがまだ同じ表示中なら、同じ選択語・字幕で意味引きをやり直す（単語・全文とも）。ポップアップを閉じていたら何もしない。
4. 失敗・4分経過時は「ログインできませんでした。もう一度お試しください。」とボタンを再表示する。
5. 接続方式が Claude サブスク以外のときはボタンを出さない（AUTH はサブスク方式でのみ発生）。

## 構成
- **native/protocol.mjs**: 依頼の形を2種類に。従来の解説依頼と、`{ id, action: 'login' }` のログイン依頼。それ以外は拒否。
- **native/claude.mjs**: `runLogin(request, options)` を追加。`claudePath` で `[...isolation, 'auth', 'login', '--claudeai']` を起動（stdin は空で閉じる、環境変数は既存の `isolatedEnv` のみ）。制限時間はログイン 225 秒＋状態確認 15 秒（拡張側 250 秒。MV3 service worker の 5 分制限より短くする）。終了後、既存と同じ `auth status --json` 判定（claude.ai／firstParty／pro・max）に通れば `{ id, ok: true, text: 'OK' }`、通らなければ `AUTH`。管理ポリシー・パス検査は `runClaude` と共通化する。
- **native/host.mjs**: `action === 'login'` なら `runLogin`、それ以外は `runClaude`。ロック・一時ディレクトリ・同時実行禁止は既存と同じ。
- **src/background/nativeClient.ts**: `login(): Promise<void>` を追加。interactive キューの先頭に入れ、ポートへは `{ id, action: 'login' }` だけを送る。タイムアウトは 250 秒。成功したら 60 秒の停止（cooldown）を解除。ログインは特定タブに属さないので `dropTab` で取り消されない。ログイン失敗では cooldown を掛けない。同時に 2 回呼ばれたら同じ Promise を返す。
- **src/shared/types.ts / requestBoundary.ts / handler.ts**: 動画ページの content script から `{ type: 'login' }` を受け付け、設定がサブスク方式なら `native.login()`、それ以外は UNKNOWN エラー。応答は通常の `ResponseMessage`。
- **src/content/overlay.ts**: `setPopupError(message, action?)` と `setPopupSentence({ ok: false, error, action? })` に任意のボタン `{ label, onClick }` を追加。ボタンは `textContent` で作る。
- **src/content/interaction.ts**: `code === 'AUTH'` のときにログインボタンを付ける。押下でログイン → 成功したら `isPopupCurrent` を確かめて意味引きをやり直す。

## 安全面
- 拡張も接続プログラムも認証情報・トークンを読まない・保存しない。ログインは公式 CLI とブラウザに任せる。
- `--console`（API 課金）は使わず `--claudeai` に固定。
- ログイン依頼に余計なフィールドが付いていても接続プログラムへは渡さない（フィールド列挙で送る）。

## テスト
- native: protocol がログイン依頼を受け付け不正形を拒否／`runLogin` の成功・CLI 失敗・status 不一致・タイムアウト／host がログイン依頼を `runLogin` へ振り分け。
- vitest: nativeClient の login（送信形・成功で cooldown 解除・失敗・重複呼び出し）／requestBoundary の `login` 受け付け／interaction の AUTH 時ボタン表示と成功後の再試行。
- 実機: ログアウト状態でボタン → ブラウザで許可 → 解説が自動で出る。
