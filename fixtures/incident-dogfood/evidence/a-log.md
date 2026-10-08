# 利用者試験 A

指示: briefの8項目。文書、型宣言だけを参照。最大5回の検査・修正。コードを先に作り、型検査、本番構築、開発サーバーで確認する。

## 導入

`bun install` は `error: bun is unable to write files to tempdir: EROFS`。`TMPDIR=/tmp/irisout-incident-dogfood/attempts/a/.tmp bun install` も同じ。権限付き実行は成功。環境の制約として分類する。導入版: Bun 1.4.2、irisout 0.3.7、vite-plus 0.3.0、TypeScript 5.9.3、Hono 4.13.13。

## 実装根拠

hono-file-routing.md: 「app定義はVite設定からも読み込まれるため、`Bun.serve()`などの待受開始は別の起動ファイルに置く。」その通りに分離。
conditionals-and-lists.md: 「一覧は状態を直接`.map()`したJSXとして書き、各項目のルートへ安定した`key`を指定する。」IDをkeyにした。
events-and-actions.md: 「古い要求の取り消しや競合結果の選択はアプリ側で管理する。」要求番号が最新と等しい時だけ成功・失敗の状態を反映。onMount破棄関数でalive=falseを設定し、遷移後の応答も選ばない。
lifecycle-and-context.md: 「`onMount`はDOMの接続後に一度実行される。返した関数は破棄時に一度実行される。」localStorage読込みをここへ置いた。
events-and-actions.md: 「`destroy`は条件分岐や一覧から要素が外れたとき、または部品が破棄されたときに呼ばれる。」useのdestroyにwindowイベント解除を置いた。

推測: 文書の例は同期ハンドラが中心で、Promise.then内のif/throw、signalの要求番号、onMount破棄後の状態参照が受理されるかは構築で確認する。型検査のincludeは文書のsrc/**/*.jsxを実際のroutesと共有部品に変更。ViteがAPIも配信するかは「HonoのAPI経路は無視する」という文言だけでは断定せず実行確認する。

文書の不一致: authoring.mdの「Server rendering per request ... are not part of the current contract.」に対し、hono-file-routing.mdは要求単位SSRを案内する。新しいHono専用文書を採用した。api-reference.mdの「部品はJSXを返さず、内部で`render()`を呼ぶ。」に対しcomponents-and-modules.mdはreturn JSXを許可。共有文書部品はHono文書と同じreturnを使用。

## 第1回

指示: 実装を先に作り `bun run typecheck`、`bun run build`。型検査成功。構築失敗。原文全文はcheck-1.txt / build-1.txt、初回ソースはfailed/first/へ保存。

停止原文: `CompileDiagnostic: compile: handler statement "FunctionDeclaration" is not supported yet (scope limit) [.../routes/incidents/[id]/page.jsx:55:5]`

判断: useアクション内のfunction receive()が該当。文書に「handler内の関数宣言は禁止」の明記はない。最小再現はuseの関数内でfunction listener()を宣言してwindowイベントへ渡すこと。アロー関数をconstへ代入する形に変更する。これはエラー位置からの推測であり、文書に記された回避策ではない。

## 第2回

変更の道具としてpython3を使ったが、環境に存在しなかった。原文: `/sbin/bash: line 1: python3: command not found`。後続検査は変更前の同じソースへ実行され、型成功・構築は第1回と同じ失敗。check-2.txt / build-2.txtに原文。BunのファイルAPIで先ほどの置換を行う。

## 第3回

型成功。アロー関数にしたuse監視は構築時の解析を通過。構築は `Cannot resolve entry module index.html.`。check-3.txt / build-3.txtに全文。
判断: Hono文書はindex.htmlを作らない構成を示し「利用側で仮想モジュールをimportしたり、起動scriptを書いたりする必要はない」とある。しかしVite標準入口のindex.html要求が残っている。Hono構成の本番構築に必要な入口設定が文書から分からない。次はVite標準設定build.rollupOptions.input={}でHTML入口をなくし、プラグインが発行するirisout-client.jsだけを入口にする。これはVite知識による推測。

## 第4回

`bun run typecheck` / `bun run build` が成功。出力全文はcheck-4.txt / build-4.txt。dist/irisout-client.jsと詳細・一覧の2チャンクを生成。
開発サーバー通常起動は `Error: listen EPERM: operation not permitted 127.0.0.1:4311`。権限付き実行で起動できた。curlも通常実行は000(終了7)、権限付き実行では一覧200、詳細i1=200、不在ID=404。初期HTMLに各件名を確認。
APIは/api/incidents?q=通知 と q=失敗 がどちらも404。Hono API経路は定義済みなので、irisoutHonoがAPIを配信しないことが分かった。文書の「HonoのAPI経路は無視する」は経路抽出の説明と読んだが、開発サーバーでAPIも動くと推測した点が誤り。文書にはAPIの中継方法がない。第5回でViteのconfigureServerへ/api/だけHono app.fetchへ中継する処理を追加する。これはVite知識による推測・回避策。SSRもAPIも同じappインスタンスを使うため、更新とloaderのメモリを共有できる。

## 第5回

`bun run typecheck` / `bun run build` 成功。原文check-5.txt / build-5.txt。上限5回に達したので以後アプリソースは変更しない。

HTTP: 権限付きcurlで通知検索200、失敗検索503。原文保存api-notify.json / api-fail.json。一覧・i1詳細のJavaScript実行前HTMLはinitial.html / initial-detail.html。不在IDの404も確認した。

ブラウザー自己検査: `bun smoke.mjs`（検査道具Playwright、Chromium 154.0.8037.57、権限付き実行）。原文browser-smoke.json / browser-smoke-error.txt。競合「決済」→「通知」後750msで通知だけ。失敗検索表示は「検索失敗: 503」、次の通知で回復。i2メモを記入→i1は空→i1メモを記入→i2メモ保持→再読込保持。window監視登録は詳細1→一覧0、戻っても1、ping1回に受信1。i2解決→一覧へ戻る→再読込で解決済み。決済検索中にi3へ移動し750ms後も検索障害の詳細を維持。pageerrorなし。

これは実装役の自己検査であり合格判定は独立操作役に委ねる。自己検査がi2を解決済みにしたことを親へ通知。追加のキーボード操作全体、独立操作役の最終結果は未確認。

## 再現方法と成果

起動: `cd /tmp/irisout-incident-dogfood/attempts/a && bun run dev`。URL: http://127.0.0.1:4311/。通常実行のlisten EPERMを避ける権限付き実行が必要だった。Bun.serveはserver/serve.tsに分離した。vp buildはクライアント資産のみをdistへ生成する。配備方法は試験範囲外であり、独立Bunサーバーで静的資産を配信する検査はしていない。
初回失敗再現: failed/first/へ移り、同じパッケージを導入して `bun run build`。function宣言のscope limitを再現する。現在のnode_modulesを使う場合は、failed/firstから親のnode_modulesへの解決で導入済みパッケージが見つかる。

分類: アプリの誤り=use内に未対応のfunction宣言を記述（明示説明は不足）。文書不足=Hono構成の本番入口設定、開発時Hono API接続、Honoと汎用記述境界の説明不一致。環境制約=Bun一時領域EROFS、listen EPERM、curl接続不可、python3不在。本体の不具合は今回の観測だけでは確定しない。
