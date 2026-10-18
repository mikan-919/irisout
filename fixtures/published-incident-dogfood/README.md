# npm公開版による障害対応ボードの試用

[課題](./brief.md)を公開版0.3.7と公開文書だけで実装した試行Aを保存する。[報告](../../docs/reports/2026-10-18-published-incident-dogfood-v1.md)には実装3回と独立操作16項目を記録した。修正文書を使う次の実装役へ、この試行のソースや検査器を渡さない。

## 取得した公開物

- 取得先: `https://registry.npmjs.org/irisout/-/irisout-0.3.7.tgz`
- SHA-256: `76fc7b9f8b43c3166e2f669862aa2cb101cbaf606b1a1ea792d958d347f9e653`
- SHA-512: `3a9cd50d462e243d9c50e4e8a8596d25df50726aa9f9103c8f7f6e2776107139aacb301364372fef80cbb7dde66a2c038c91641a3f8b98115d737969ea2baa93`

[版情報](./attempts/a/registry-irisout-0.3.7.json)と`bun.lock`のintegrityも保存した。ローカルの梱包物、workspace、本体の未公開変更は使っていない。2026-10-08の[ローカル梱包物による試用](../incident-dogfood/README.md)とは別の検査である。

## 隔離して構築・起動する

Bun 1.4.3を使う。保存した`bun.lock`は形式2であり、Bun 1.3.13では`Unknown lockfile version`になる。Bunの版を作業場所で切り替える環境では、コピー先の`bun --version`を確認する。リポジトリのルートで次を実行する。

```sh
published_app=$(mktemp -d /tmp/irisout-published-incident-XXXXXX)
cp -R fixtures/published-incident-dogfood/attempts/a/. "$published_app/"
cd "$published_app"
bun --version
BUN_INSTALL_CACHE_DIR=/tmp/irisout-published-bun-cache bun install --frozen-lockfile
bun run typecheck
bun run build
DOGFOOD_PORT=4317 bun run serve
```

`serve`は同じプロセスでHonoのページ・APIと`dist/`のJavaScriptを配信する。元の試行はこの起動処理をBunの知識から補った。保存ソースは観測時の実装を保持している。[現在の公開文書](../../docs/hono-file-routing.md#本番生成物をbunで配信する)へ追加したHonoの配信例は別に検証した。

## 独立操作を再実行する

起動したサーバーを保ち、別の端末でリポジトリのルートから実行する。Playwrightは既存の`packages/bench`の依存を使い、fixture自身に依存を追加しない。

```sh
DOGFOOD_BASE_URL=http://127.0.0.1:4317 \
  DOGFOOD_ARTIFACT_DIR=/tmp/irisout-published-check/existing \
  bun fixtures/incident-dogfood/verify.mjs
DOGFOOD_BASE_URL=http://127.0.0.1:4317 \
  DOGFOOD_ARTIFACT_DIR=/tmp/irisout-published-check/additional \
  bun fixtures/published-incident-dogfood/evidence/a/additional.mjs
```

付属Chromiumを使えない環境では、両コマンドへ`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`を渡す。既存検査はi1、追加検査はi2を解決済みにする。上の順で一組として実行し、次の一組の前にサーバーを再起動してメモリを初期化する。検査ごとにブラウザーの保存領域を作り直す。不合格またはブラウザー例外があれば終了コード1になる。

試行Aの自己検査も保存した。サーバーを再起動した後、同じ環境変数で`bun fixtures/published-incident-dogfood/attempts/a/self-check.mjs`を実行できる。

## 保存物の範囲

[アプリと実装記録](./attempts/a/)、[独立操作の報告](./evidence/a/operator-report.md)、[初回結果](./evidence/a/result.json)、[追加検査器](./evidence/a/additional.mjs)を保存した。自己検査器と追加検査器は配信先、出力先、Chromium、リポジトリの固定パスを再実行用に置き換えた。検査内容は変更していない。

`log.md`と`report.md`は試行終了時の記録であり、その時点では独立検査が未実施だった。後の独立検査結果は`evidence/a/`と報告を参照する。記録内の一時絶対パス、URL、元のログ名は観測時の値である。`node_modules`、`dist`、梱包物、画像、重複した実行ログは保存しない。追加検査器は再実行時に画像を指定した一時出力先へ作る。
