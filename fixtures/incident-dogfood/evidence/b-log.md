# 追試Bの記録

作業範囲: 配布brief、docs、導入パッケージの型宣言・診断、自分の作業物のみ。導入文書全10ファイルを読んだ。他試行・検証器・irisout実装は読んでいない。

## 実装前の判断

文書原文（hono-file-routing.md）: 「app定義はVite設定からも読み込まれるため、`Bun.serve()`などの待受開始は別の起動ファイルに置く。」これに従いapp.tsとstart.tsを分離した。
文書原文: 「文書ページではHonoが状態のJSONと`<script type="module" src="/irisout-client.js"></script>`を`</body>`直前へ挿入する。」起動scriptをLayoutへ書かない。
文書原文: 「HTMLはHonoが要求ごとに返し、プラグインがブラウザー入口を発行する。」構築入口を`input: {}`にする。
文書原文: 「構築されたJavaScriptの配信は、利用側のHTTPサーバーへ接続する。」文書にはBunでの配信コードがないため、Bun.fileとResponseでdist内の入口・assetsを配信することを推測した。
文書原文（events-and-actions.md）: 「非同期処理もイベント関数に置ける。古い要求の取り消しや競合結果の選択はアプリ側で管理する。」要求番号のsignalを増加し、応答で番号を照合する。古い要求は取り消さず、その結果を採用しない。
文書原文（lifecycle-and-context.md）: 「返した関数は破棄時に一度実行される。」一覧のonMount破棄でactiveをfalseにし、離れたページの応答を採用しない。
文書原文（diagnostics-and-limits.md）: 「要求単位SSRではサーバーでイベント、ライフサイクル、`use`を実行しない。」localStorage読み出しはonMount、書き込みはinputイベントに限定する。
文書原文（events-and-actions.md）: 「アクションやイベント処理の内部で監視関数を作る場合は、`const`へアロー関数を代入する。」受信関数はアロー関数とし、destroyで同じ関数を解除する。
文書原文（conditionals-and-lists.md）: 「一覧は状態を直接`.map()`したJSXとして書き、各項目のルートへ安定した`key`を指定する。」障害IDをkeyにする。

推測: Promise.then/catch内のifで最新番号とactiveを照合できると判断した。文書は「accepted control-flow forms」と記すが、対応構文の一覧や非同期競合のコード例はない。

## 導入・起動（検査回数には含めない環境操作）

`bun install`通常実行の原文:

```
bun install v1.4.2 (744846f84)
error: bun is unable to write files to tempdir: EROFS
```

権限付き再実行は成功。導入版はirisout 0.3.7、vite-plus 0.3.0、typescript 5.9.3、hono 4.13.13。
`bun run serve`通常実行の原文:

```
EPERM: operation not permitted, listen
 syscall: "listen",
   errno: -1,
    code: "EPERM"
```

権限付き再実行は成功。URLはhttp://127.0.0.1:4313。起動コマンドは`bun run serve`。

## 第1回: 型検査と本番構築

コマンド: `bun run typecheck`、`bun run build`。原文はcheck-1.txt、build-1.txtへ保存。

```
$ tsc --noEmit
$ vp build
transforming...
✓ 7 modules transformed.
rendering chunks...
computing gzip size...
dist/assets/.irisout-virtual_3Airisout-routes_3Apage_3A_252Fincidents_252F_253Aid-DI1Vm5eg.js   3.43 kB │ gzip: 1.27 kB
dist/assets/.irisout-virtual_3Airisout-routes_3Apage_3A_252F-Bp4tI8iv.js                        3.84 kB │ gzip: 1.63 kB
dist/irisout-client.js                                                                         11.39 kB │ gzip: 4.26 kB
✓ built in 67ms
```

型検査と構築は成功。初回失敗ソースはまだ発生していない。

## 第1回: 自己操作確認

コマンド: `bun self-check.mjs`。通常実行の原文はbrowser-1.txtに保存。ブラウザー起動が`setsockopt: Operation not permitted (1)`で終了した。アプリの検査へ到達していないため環境制約と判断し、権限付き実行で再試行。
コマンド: `bun self-check.mjs`（権限付き）。原文はbrowser-1-escalated.txt、機械可読結果はself-check-results.jsonに保存。8項目はすべて成功。ブラウザー例外なし。自己検査ではi1を解決済みにした。
監視は登録/解除をブラウザーで計測し、詳細で1件、一覧で0件を3周確認した。各周のincident-pingで受信数は1になった。
初回の型検査・構築・操作はアプリの修正なしで通過。通常実行の環境エラーは別に記録した。

## 独立操作役のフィードバック後の追加修正（第2回）

親から伝達された独立操作役の原文: 「失敗検索時に『検索完了』と『検索に失敗しました』が同時に残りました」。独立操作役は8項目を1回で全合格と報告したが、この表示の矛盾をアプリの誤りとして修正する。
変更前のソースはfailed/page-before-feedback.jsxに保存。変更前はpendingがfalseなら成功・失敗を問わず検索完了と表示した。変更後はpendingを優先し、その次にfailureを判定して検索失敗と表示する。
文書原文（conditionals-and-lists.md）: 「表示の切り替えには三項演算子または`&&`を使う。」既存の三項演算子へ失敗状態の判定を加えた。
注: この追加修正は8項目の初回成功を取り消す構築失敗ではなく、合格後の表示修正である。

第2回の編集コマンドは`python3: command not found`で実行できず、その後の型検査・構築は変更前のまま成功した。これは実装担当の道具選択の誤り。apply_patchで同じ差分を適用し、第3回として型検査・構築を行う。第2回の原文はcheck-2.txt、build-2.txtに保存。

## 第3回: 追加修正後の結果

コマンド: `bun run typecheck`、`bun run build`。原文はcheck-3.txt、build-3.txtに保存。どちらも成功。変更後の一覧生成物は`dist/assets/.irisout-virtual_3Airisout-routes_3Apage_3A_252F-BXIb0hYY.js`。

```
$ tsc --noEmit
$ vp build
transforming...
✓ 7 modules transformed.
rendering chunks...
computing gzip size...
dist/assets/.irisout-virtual_3Airisout-routes_3Apage_3A_252Fincidents_252F_253Aid-DI1Vm5eg.js   3.43 kB │ gzip: 1.27 kB
dist/assets/.irisout-virtual_3Airisout-routes_3Apage_3A_252F-BXIb0hYY.js                        4.34 kB │ gzip: 1.65 kB
dist/irisout-client.js                                                                         11.39 kB │ gzip: 4.26 kB
✓ built in 70ms
```

サーバーを再起動し、同じURLへ修正を反映。再起動でメモリ初期化後に自己検査がi1を再び解決済みにした。
コマンド: `bun self-check.mjs`（権限付き）。原文はbrowser-3-escalated.txt、結果はself-check-results.jsonに保存。8項目、失敗表示の修正、文書再読込なしのキーボード遷移、JavaScript無効時の一覧3件と詳細件名を確認。すべて成功。例外なし。
追加修正の確認原文:

```
PASS 追加修正: 検索失敗時は完了と表示しない
PASS 5: キーボードで文書再読込なしに詳細へ遷移
PASS 1: JavaScript無効でも一覧3件
PASS 1: JavaScript無効でも詳細件名
```

## 文書から分かったこと・残る不足

文書から分かった: Hono側に経路・loaderを集約すること、文書Layoutを相対importできること、起動scriptを自分で書かないこと、input:{}が必要なこと、SSRではuse/onMountが走らないこと、内部監視関数はconstアロー関数にすること、破棄時に同じ監視関数を解除すること。これらを反映した初回アプリは型検査・構築・8項目操作を修正なしで通過した。
文書だけでは分からなかった: Promiseコールバック内で許されるif/return/throwの一覧、非同期競合とページ破棄を併用する実例、Bunで構築ファイルを配信する実例。Bun.file配信とsignal要求番号/activeによる照合は担当者の推測を含むが、操作確認で動作を確認した。
本体の不具合は今回観測していない。通常導入・待受・Chromium起動の失敗は実行環境の制約。検索失敗と完了が同時に出る表示はアプリの誤り。python3不在による空振り検査は担当者の道具選択の誤り。
検査回数: 初回成功1回、フィードバック後の検査2回、合計3回（上限5回以内）。初回失敗ソースの代わりに、指摘対象となった変更前の一覧ソースをfailed/page-before-feedback.jsxへ保存した。未確認のbrief項目はない。

## 再確認用

URL: http://127.0.0.1:4313
起動: `cd /tmp/irisout-incident-dogfood/attempts/b && bun run serve`
起動ファイル: server/start.ts。現在稼働中。i1は自己検査で解決済み。Bunのサーバー再起動をすると3件とも未解決へ戻る（要件は実行中サーバーのメモリ保存）。
