# npm公開版による障害対応ボードの試用

[課題](./brief.md)を公開版0.3.7と公開文書だけで実装した試行Aと、修正文書で新しい実装役が作った試行Bを保存する。[Aの報告](../../docs/reports/2026-10-18-published-incident-dogfood-v1.md)と[Bの報告](../../docs/reports/2026-10-18-published-incident-dogfood-v2.md)を参照する。両方とも実装は3回であり、一組の比較から文書の効果を一般化しない。次の実装役へ、この試行のソースや検査器を渡さない。

| 試行 | 既存検査                                       | 追加検査                                   | ブラウザー例外 |
| ---- | ---------------------------------------------- | ------------------------------------------ | -------------- |
| A    | 8/8                                            | 8/8                                        | 0              |
| B    | 7/8。項目7が本文の表記と探索方法の不一致で停止 | 8/8。ラベル付き出力の0→1と監視数を別に確認 | 0              |

## 取得した公開物

- 取得先: `https://registry.npmjs.org/irisout/-/irisout-0.3.7.tgz`
- SHA-256: `76fc7b9f8b43c3166e2f669862aa2cb101cbaf606b1a1ea792d958d347f9e653`
- SHA-512: `3a9cd50d462e243d9c50e4e8a8596d25df50726aa9f9103c8f7f6e2776107139aacb301364372fef80cbb7dde66a2c038c91641a3f8b98115d737969ea2baa93`

[版情報](./attempts/a/registry-irisout-0.3.7.json)と`bun.lock`のintegrityも保存した。ローカルの梱包物、workspace、本体の未公開変更は使っていない。2026-10-08の[ローカル梱包物による試用](../incident-dogfood/README.md)とは別の検査である。

## 隔離して構築・起動する

Bun 1.4.3を使う。保存した`bun.lock`は形式2であり、Bun 1.3.13では`Unknown lockfile version`になる。Bunの版を作業場所で切り替える環境では、コピー先の`bun --version`を確認する。リポジトリのルートで次を実行する。

```sh
published_attempt=a
published_app=$(mktemp -d /tmp/irisout-published-incident-XXXXXX)
cp -R "fixtures/published-incident-dogfood/attempts/$published_attempt/." "$published_app/"
cd "$published_app"
bun --version
BUN_INSTALL_CACHE_DIR=/tmp/irisout-published-bun-cache bun install --frozen-lockfile
bun run typecheck
bun run build
DOGFOOD_PORT=4317 bun run serve
```

Bを再実行する場合は最初の`published_attempt`を`b`へ変える。`serve`は同じプロセスでHonoのページ・APIと`dist/`のJavaScriptを配信する。Aはこの起動処理をBunの知識から補い、Bは[修正文書のHono配信例](../../docs/hono-file-routing.md#本番生成物をbunで配信する)を使った。保存ソースは各試行の実装を保持している。

## 独立操作を再実行する

起動したサーバーを保ち、別の端末でリポジトリのルートから実行する。Playwrightは既存の`packages/bench`の依存を使い、fixture自身に依存を追加しない。

```sh
published_attempt=a
DOGFOOD_BASE_URL=http://127.0.0.1:4317 \
  DOGFOOD_ARTIFACT_DIR=/tmp/irisout-published-check/existing \
  bun fixtures/incident-dogfood/verify.mjs
DOGFOOD_BASE_URL=http://127.0.0.1:4317 \
  DOGFOOD_ARTIFACT_DIR=/tmp/irisout-published-check/additional \
  bun "fixtures/published-incident-dogfood/evidence/$published_attempt/additional.mjs"
```

起動したアプリがBなら、この端末でも`published_attempt=b`を選ぶ。保存時の既存検査は項目7で`詳細の受信数が0から始まりません`となり、終了コード1を返した。2026-10-19に検査器を修正し、ラベル付き出力と本文表記の両方で0→1を確認するようにした。原結果7/8は変更しない。追加検査は`output[aria-label="受信数"]`の0→1と、登録数0→1→0→1→0を確認する。

現行ソース版の梱包物でBを補助確認する場合は、ルートで次を実行する。

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium \
  bun run test:browser --incident-app fixtures/published-incident-dogfood/attempts/b
```

これは公開版の再現とは別の検査である。一時コピーの`irisout`依存を梱包物へ差し替え、そのコピーのlockだけを除いて再解決する。形式2の原lockをBun 1.3.13の`--frozen-lockfile`へ渡さず、保存したソースと原記録は変更しない。修正後の8/8は[別の検証結果](../../docs/reports/2026-10-19-continuous-browser-checks.md)へ保存した。

付属Chromiumを使えない環境では、両コマンドへ`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`を渡す。既存検査はi1、追加検査はi2を解決済みにする。上の順で一組として実行し、次の一組の前にサーバーを再起動してメモリを初期化する。検査ごとにブラウザーの保存領域を作り直す。不合格またはブラウザー例外があれば終了コード1になる。

自己検査も保存した。サーバーを再起動した後、同じ環境変数でAは`bun fixtures/published-incident-dogfood/attempts/a/self-check.mjs`、Bは`bun fixtures/published-incident-dogfood/attempts/b/selfcheck.mjs`を実行できる。

## Bの公開版の問題を再現する

Bの隔離導入先で`bun repro/check.mjs`を実行すると、同名propsとsignalのSSR生成物を作り、`title()()`の`TypeError`で終了コード1となる。`bun repro/on-error-routes.mjs`は子ルーターの`onError`なしが受理、ありは経路なしの診断で拒否される条件を出力する。[最小再現の説明](./attempts/b/repro/README.md)を参照する。内部原因と現行ソースでの再現は保存時点では未確認である。

## 保存物の範囲

[Aのアプリと実装記録](./attempts/a/)、[独立操作の報告](./evidence/a/operator-report.md)、[初回結果](./evidence/a/result.json)、[追加検査器](./evidence/a/additional.mjs)と、[Bのアプリと実装記録](./attempts/b/)、[独立操作の報告](./evidence/b/operator-report.md)、[原結果](./evidence/b/result.json)、[追加検査器](./evidence/b/additional.mjs)を保存した。自己検査器と追加検査器は配信先、出力先、Chromium、リポジトリの固定パスを再実行用に置き換えた。検査内容は変更していない。

保存用の追加検査器は、静的検査に合わせて`localStorage`を`Object.entries()`で列挙してから記録する。記録するキーと値、操作の確認条件、原結果JSONは保持する。

`log.md`と`report.md`は試行終了時の記録であり、その時点では独立検査が未実施だった。後の独立検査結果は`evidence/a/`と`evidence/b/`、各報告を参照する。記録内の一時絶対パス、URL、元のログ名は観測時の値である。`node_modules`、`dist`、梱包物、画像、重複した実行ログ、再生成できるSSR生成物は保存しない。追加検査器は再実行時に画像を指定した一時出力先へ作る。
