# js-framework-benchmark のirisout実装と比較

[上流の受入条件](https://github.com/krausest/js-framework-benchmark/tree/bf894b681fb56433ccb6efb4a3c93e35eda2b20d#4-contributing-a-new-implementation)に合わせたキー付き一覧。キーは行の識別子であり、並べ替え後も同じDOM要素を使う。6個の操作ボタン、行選択、行削除、共通CSS、単語表と乱数式を上流へ揃える。`irisout/main.jsx`を現行のコンパイラと実行時コードで構築し、手書きDOM操作は使わない。

比較対象は上流のReact Hooks、Vue、Solid、vanillajs。実装と構築設定は変更しない。測定器も上流のPuppeteer方式を使い、クリックから描画までの時間を測る。結果と測定条件は[results.md](./results.md)、公式の全試行値は[results.json](./results.json)を参照。最適化前に中断した測定値は[partial-results.json](./partial-results.json)へ分けて保存した。

## 再実行

リポジトリのルートから実行する。Bun、Node 24以降、Git、起動可能なChromiumが必要。

```sh
bun install
bun packages/bench/js-framework/setup.mjs
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome bun run bench:js-framework
```

Chromiumのパスを省略するとPlaywrightの既定のブラウザーを使う。未導入なら`bunx playwright install chromium`で導入する。NixOSでは起動に必要な共有ライブラリを用意した実行ファイルまたは起動用スクリプトを指定する。

準備は上流のコミット`bf894b681fb56433ccb6efb4a3c93e35eda2b20d`を取得し、上流の`package-lock.json`からBunで依存を導入する。導入時の処理スクリプトは実行しない。構築には各実装の既存のWebpack、Vite、Rollup設定を使う。上流の`.node-version`を自動適用する実行用代替コマンドがある環境では、実際のNode/Bun実行ファイルをPATHへ指定する。

実行は配信サーバー起動、公式のキー付き判定、CPU測定、メモリ測定、転送量測定の順で進む。CPUは3回、行選択は上流の設定によって13回、メモリは1回、転送量と初回描画は1回。CPUの事前実行と減速倍率は上流の既定を使う。Lighthouseは実行しない。測定が終わってから`report.mjs`で表を生成する。CPUの測定中に別の検査や負荷を掛けない。

```sh
# 個別に実行する場合
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome bun packages/bench/js-framework/run.mjs
bun packages/bench/js-framework/report.mjs
```

| 環境変数                              | 既定値                                | 用途                                      |
| ------------------------------------- | ------------------------------------- | ----------------------------------------- |
| `JSFB_CHECKOUT`                       | `/tmp/irisout-js-framework-benchmark` | 上流の作業ディレクトリ                    |
| `JSFB_PORT`                           | `8080`                                | 専用の配信ポート                          |
| `JSFB_COUNT`                          | `3`                                   | CPUの試行回数。行選択はこれに10回を加える |
| `JSFB_MEMORY_COUNT`                   | `1`                                   | メモリの試行回数                          |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` | Playwrightの既定                      | 比較する全実装で使うブラウザー            |

ログと元のJSONは無視対象の`results/`、ブラウザーの動作記録は上流の`webdriver-ts/traces/`へ保存する。前回の上流結果は実行時に日時付きディレクトリへ退避する。`report.mjs`は欠けた実装・試行数を検出したら失敗し、部分的な結果を完全な比較として出力しない。

## 画面検査

操作とDOM再利用は公式の`isKeyed`検査とCPU測定時の事後条件で確認する。画面の検査は、公式サーバーの起動中に次を実行する。

```sh
bunx vlmkit check integrity http://localhost:8080/frameworks/keyed/irisout/dist/index.html --no-ledger
bunx vlmkit verify flow http://localhost:8080/frameworks/keyed/irisout/dist/index.html --flow packages/bench/js-framework/flow.json --no-ledger
```

この画面は比較に必要な上流のHTMLを維持するため、通常の製品画面の設計見直しは行わない。行のリンクと削除アイコンも上流の構造に合わせている。

## 出典

単語表、操作、HTML構造はjs-framework-benchmarkを元にirisoutへ書き換えた。上流のApache-2.0ライセンスを[UPSTREAM-LICENSE](./UPSTREAM-LICENSE)へ保存した。

## 修正前後の処理時間

[optimization.json](./optimization.json)は、同じJSXを修正前のコンパイラ・実行時コード（コミット`30d856b7c47c21527236ee62f061c802a1d22edd`）と修正後で構築した比較。公式サーバー上の修正前後の画面を`probe.mjs`へ渡すと再実行できる。

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome bun packages/bench/js-framework/probe.mjs http://localhost:8080/frameworks/keyed/irisout-before/dist/index.html http://localhost:8080/frameworks/keyed/irisout/dist/index.html
```

3回の事前実行後に15回測り、各試行で修正前後の順序を交互にする。乱数の初期値を固定し、選択は200回、交換は20回の操作時間を1回当たりへ換算する。同期したイベント処理とDOM書き込みの時間を測り、レイアウト・描画は含まない。公式のクリックから描画までの時間とは別の指標である。比較用の生成物は同じJSXから各版で構築し、別のURLへ配置する。
