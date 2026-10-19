# 障害対応ボードの利用者試験

課題は[brief.md](./brief.md)。要求単位SSR、Hono API、非同期検索、ブラウザー遷移、保存、監視解除を交差させる。結果は[初回報告](../../docs/reports/2026-10-08-incident-dogfood-v1.md)と[追試報告](../../docs/reports/2026-10-08-incident-dogfood-v2.md)にある。

## 新しい実装役へ渡す

1. 別の一時ディレクトリへbriefと公開文書をコピーする。`docs/getting-started.md`、`docs/hono-file-routing.md`、`docs/events-and-actions.md`、`docs/lifecycle-and-context.md`、`docs/components-and-modules.md`、`docs/conditionals-and-lists.md`、`docs/authoring-state.md`、`docs/diagnostics-and-limits.md`、`docs/api-reference.md`、`skills/irisout/references/authoring.md`を渡す。
2. 現在のソースを`bun run build:packages`と`bun pm pack`で梱包し、そのローカル梱包物を依存として渡す。npm公開版の試験とは区別する。
3. サブエージェントは新しい文脈で起動する。実装、型検査、構築、自己操作を最大5回で行い、各回の診断・判断の根拠・推測を記録させる。編集はBunか`apply_patch`を使う。Pythonの存在を仮定しない。
4. 禁止するパスを指示へ列挙する: `packages/compiler/`、`packages/runtime/`、`packages/vite-plugin/`、`apps/`、`skills/irisout/assets/incident-dogfood/`、この試験の`evidence/`と`verify.mjs`、`docs/reports/`、以前の一時試行。導入したirisoutの実装JavaScriptも読ませない。パッケージの型宣言と診断は読んでよい。
5. 別の操作役にbriefとURLだけを渡す。操作役は実装ソースを読まず、HTTPと画面から8項目を採点する。失敗後の修正は初回結果を消さず、別結果で記録する。

注: 実装役の推測、環境の権限制約、文書不足、本体の不具合を分ける。親は詰まりを観測するまで解法を教えない。介入が不要な待機は`wait_agent`へ1,800,000msを指定する。

## 保存した利用例を起動する

構築・梱包・隔離導入・型検査・本番構築・空きポートでの起動・操作検査・停止は、ルートの1コマンドで実行できる。

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium bun run test:browser
```

ハンドラー8項目、初期化・破棄8項目、関数境界のmount/hydrate検査を先に実行し、障害対応ボード8項目へ進む。すべて直列に実行するため、ほかの構築・梱包・試験や文書生成と同時に起動しない。`.artifacts/browser-checks/run-*/`に各検査器のJSON、ログ、生成物、画面画像と全体の`summary.json`を残す。`IRISOUT_BROWSER_ARTIFACTS`で保存先を選べる。不合格は終了コード1とし、`finally`でサーバーを停止して一時導入先を削除する。実行中のBunを子プロセスへ引き継ぐため、コピー先の版切替設定には依存しない。

CIはこの利用例を主シナリオとして変更ごとに実行する。公開版の試用Bは`--incident-app fixtures/published-incident-dogfood/attempts/b`で補助確認できる。同じ8項目を別アプリで繰り返す構築・導入の費用を避け、Bは今回の検査器修正時に追試した。試用Bを含む[検証報告](../../docs/reports/2026-10-19-continuous-browser-checks.md)を参照する。

[利用例](../../skills/irisout/assets/incident-dogfood/)は追試Bの最終ソースを保存したもの。Bunの起動番号を環境変数で選べるようにし、書式とコメントをリポジトリの規約へ合わせた。実装役へは渡さない。

リポジトリのルートで実行する。

```sh
bun run build:packages
mkdir -p /tmp/irisout-incident-pack
(cd packages/irisout && bun pm pack --destination /tmp/irisout-incident-pack --quiet)
incident_app=$(mktemp -d /tmp/irisout-incident-replay-XXXXXX)
cp -R skills/irisout/assets/incident-dogfood/. "$incident_app/"
cd "$incident_app"
bun add irisout@file:/tmp/irisout-incident-pack/irisout-0.3.7.tgz
bun run typecheck
bun run build
DOGFOOD_PORT=4315 bun run serve
```

注: 梱包名の`0.3.7`はこの試験で使用した版である。別の版を試す場合は生成された梱包名へ置き換える。`serve`は構築済みのJavaScriptとHonoを同じ配信元で提供する。`dev`はページの開発配信だけで、API中継を追加していない。

## 操作検査を再実行する

起動したサーバーを保ち、別の端末からリポジトリのルートで実行する。Playwrightは既存の`packages/bench`の依存を使う。

```sh
DOGFOOD_BASE_URL=http://127.0.0.1:4315/ \
  bun fixtures/incident-dogfood/verify.mjs
```

NixOSなど、付属ブラウザーを起動できない環境では`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`へ実行できるChromiumの場所を指定する。結果は既定で`/tmp/irisout-incident-dogfood-check/`へ保存する。`DOGFOOD_ARTIFACT_DIR`で保存先を選べる。不合格またはブラウザー例外があれば終了コード1を返す。

検査はi1を解決済みにする。再実行前にサーバーを再起動してメモリを初期化する。ブラウザーは検査ごとに新しい保存領域を使う。記録した元のJSON内の一時パスは観測時の場所で、画像自体は保存物に含めていない。

項目7は`aria-label="受信数"`で名前を付けた出力、または本文の`受信数: 0`を読み、初期値0とイベント1回後の1を確認する。文書全体を読み直さずに一覧と詳細を反復し、監視数0→1→0→1→0→1→0を確認する。過去の原結果は変更しない。
