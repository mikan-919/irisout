# 公開版による障害対応ボード利用者試験

## 入力と制限

入力は `../brief.md` と `../public-docs/`。公開版を初めて使う開発者役として実装した。リポジトリの実装、既存アプリ、他試行、解答例、導入パッケージの実装JavaScriptは読んでいない。導入パッケージは型宣言とpackage.jsonのみ読んだ。装飾は行わない。

## 取得記録

- `bun --version`: インストール出力は `bun install v1.4.3 (c6da4a4d3)`。
- package.json: irisout 0.3.7、vite-plus 0.3.0、TypeScript ~5.9.0、Hono ^4.10.0。
- 解決結果: irisout 0.3.7、vite-plus 0.3.0、TypeScript 5.9.3、Hono 4.13.13。
- キャッシュは `BUN_INSTALL_CACHE_DIR=/tmp/irisout-published-bun-cache`。
- 通常権限 `bun install` は `error: DNSResolveFailed downloading package manifest irisout` 等で失敗。必要な同コマンドのみ昇格して成功。環境制約として扱った。
- 取得先: https://registry.npmjs.org/irisout/-/irisout-0.3.7.tgz 。同梱 `registry-irisout-0.3.7.json` はレジストリーの版情報。
- 梱包物 SHA-256: `76fc7b9f8b43c3166e2f669862aa2cb101cbaf606b1a1ea792d958d347f9e653`
- 梱包物 SHA-512: `3a9cd50d462e243d9c50e4e8a8596d25df50726aa9f9103c8f7f6e2776107139aacb301364372fef80cbb7dde66a2c038c91641a3f8b98115d737969ea2baa93`
- workspace、リポジトリのローカル梱包物は使用していない。

## 初回実装の根拠

`hono-file-routing.md`: 「`irisout/hono`は`page.tsx`または`page.jsx`のディレクトリ構造をHonoのサブルーターへ接続する。」、Layoutの例、loadersの例、`build: { rollupOptions: { input: {} } }` を使用。

同文書: 「構築されたJavaScriptの配信は、利用側のHTTPサーバーへ接続する。」具体的な本番Bun配信例はない。Bun.fileでdist/irisout-client.jsとdist/assets以下を返すserveは通常のBun知識から補った。Bun.serveはVite設定へ置かず別ファイルとした。

`events-and-actions.md`: 「非同期処理もイベント関数に置ける。古い要求の取り消しや競合結果の選択はアプリ側で管理する。」要求番号と一覧の破棄フラグを照合する方式をアプリの判断として選んだ。await response.json後も再確認する。

同文書: 「npm公開版0.3.7では、文種の制限と内部の関数宣言の拒否が残る。公開版では内部の監視関数に`const`のアロー関数を使う。」に従いconst receiveを登録し、同一参照で解除する。try/catchやループは使わず、503はresponse.okで判定する。

`diagnostics-and-limits.md`: 「要求単位SSRではサーバーでイベント、ライフサイクル、`use`を実行しない。」を根拠にlocalStorage読込みをonMount、保存を入力ハンドラーへ置く。

`conditionals-and-lists.md`: 「一覧は状態を直接`.map()`したJSXとして書き、各項目のルートへ安定した`key`を指定する。」に従った。

`getting-started.md`のtsconfigを流用し、includeをroutes/**/*.jsxとLayout.jsxへ変更した。サーバーTypeScriptはこの公開文書の型検査対象に含まれない。

## 第1回

コマンド: `bun run typecheck > round-1-typecheck.txt 2>&1`、`bun run build > round-1-build.txt 2>&1`。型検査は成功。本番構築は失敗し、自己検査へ進まなかった。

診断原文: `CompileDiagnostic: compile: only top-level `signal()`/`derived()` declarations are supported in this milestone (scope limit) [routes/page.jsx:4:3]`。全文はround-1-build.txtに保存。

判断: render前の通常constオブジェクト`requests`が拒否されたと推測した。公開文書は「状態宣言をrender()より前」と書くが、この範囲でsignal以外の通常変数を置けない制限は明記しない。文書不足とアプリ側の未確認構文利用の境界。要求番号と生存状態を別々のsignalへ変更した。診断はconstの位置でなく関数開始位置を示す。

## 第2回

変更用に使った`python`が存在せず `/bin/bash: line 1: python: command not found`。そのまま型検査と構築を起動したため、第1回と同じ構築失敗。`round-2-typecheck.txt`、`round-2-build.txt`へ保存した。これはアプリ修正作業の誤り。Bunで変更を書き直し、次回へ進む。最大5回にこの回も含める。

## 第3回

コマンド: `bun run typecheck > round-3-typecheck.txt 2>&1`、`bun run build > round-3-build.txt 2>&1`。両方成功。ビルドは7モジュール、3ファイルをdistへ出力した。

`DOGFOOD_PORT=4317 bun run serve` は通常権限で `EPERM: operation not permitted, listen`。同じローカル配信コマンドを昇格して起動した。

自己検査は `DOGFOOD_PORT=4317 bun self-check.mjs`。通常権限ではChromiumが `setsockopt: Operation not permitted (1)` で終了。同コマンドを昇格した。環境制約でありアプリは変更していない。

最初のブラウザー観測では詳細見出しが表示された直後に監視数を検査して `0 !== 1`。SSRの見出しが見えた時点と、動的import後の接続完了が同じであると仮定した検査側の誤りだった。監視登録が1になるまで待つよう自己検査を変更した。`round-3-self-check-escalated.txt`が途中結果、`round-3-self-check-wait.txt`が完走結果。

完走結果: 初期HTMLに3件、存在しない詳細404、APIの503、決済→通知の競合、503から回復、同一文書の詳細遷移、解決更新と一覧・再読込への反映、ID別メモ、監視登録1→0→1と1イベント1回の受信、検索中の詳細遷移後の古い応答抑止が成功。ブラウザー例外は0件。

独立操作役による検査はまだ行っていない。keyはソースに指定しているが、この自己検査はDOM同一性を測っていない。操作はラベル・役割で探索した。キーボードのTab順序は未検査。

第1回の診断を小さく再現する `repro/ordinary-local.jsx` と実行結果を保存した。コマンドはrepro/README.md。これは原因確認のための単独コンパイルであり、新しいアプリ実装回ではない。

## 分類

- 文書不足: render前に通常const変数を置けない制限と、その際の診断位置。Bunで本番構築物を配信する具体例はなかったため通常のBun知識で補った。
- 本体の不具合: この試行から確定できるものはない。
- アプリ・作業の誤り: 制限を確認せず通常constを置いたこと、python不在に気付かず第2回を実行したこと。
- 検査の誤り: SSR見出しの出現を接続完了と同一視したこと。
- 環境制約: 通常権限のDNS、listen、Chromium setsockopt。

自己検査後にサーバーを停止・再起動し、独立検査のためメモリ上の解決状態を初期化した。起動コマンドは `DOGFOOD_PORT=4317 bun run serve`。リポジトリ本体の `git status --short --branch` は `## dogfood/incident-board-2026-10-08` のみで、変更はない。
