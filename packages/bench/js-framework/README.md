# js-framework-benchmark のirisout実装と比較

[上流の受入条件](https://github.com/krausest/js-framework-benchmark/tree/bf894b681fb56433ccb6efb4a3c93e35eda2b20d#4-contributing-a-new-implementation)に合わせたキー付き一覧。キーは行の識別子であり、並べ替え後も同じDOM要素を使う。6個の操作ボタン、行選択、行削除、共通CSS、単語表と乱数式を上流へ揃える。`irisout/main.jsx`を現行のコンパイラと実行時コードで構築し、手書きDOM操作は使わない。

比較対象は上流のReact Hooks、Vue、Solid、vanillajs。実装と構築設定は変更しない。測定器も上流のPuppeteer方式を使い、クリックから描画までの時間を測る。結果と測定条件は[results.md](./results.md)、公式の全試行値は[results.json](./results.json)を参照。最適化前に中断した測定値は[partial-results.json](./partial-results.json)へ分けて保存した。

2026-10-16の全操作の再測定はCPU各10回、選択20回、メモリ各3回、同期比較各100回で行った。Vanillaとの差と処理回数の調査は[vanilla-audit.md](./vanilla-audit.md)に記録する。

一覧高速化計画の実装、採用しなかった配列複製省略、段階ごとの全試行値は[work-results.md](./work-results.md)を参照する。基準版は`390f84a`である。

Vanillaのソースと生成物の比較は[vanilla-code-review.md](./vanilla-code-review.md)、断片への追加と子節点の参照を含めた呼出し回数は[vanilla-code-work.json](./vanilla-code-work.json)を参照する。コード上の差と未測定の削減候補を区別して記録する。

所有する配列のmapを変更行へ接続した後の測定は[map-results.md](./map-results.md)に分けて保存する。修正前後とSolidとの同期比較、および公式測定器による部分更新の再測定であり、既存の全操作の公式比較を置き換えない。

Vanillaのコード調査を受けた修正後は、構築設定で`listEvents: 'delegated'`を明示する。行の引数なしclickを親で処理し、JSXへDOM操作を追加しない。コンパイラとViteの既定は直接配線である。`JSFB_LIST_EVENTS=direct bun packages/bench/js-framework/irisout/build.mjs`で直接配線の比較用生成物を構築できる。非バブルのclickや外部リスナーとの順序の違いは[ADR-0069](../../../docs/adr/0069-list-storage-and-explicit-click-delegation.md)を参照する。過去の`results.md`は直接配線の測定として保持する。

修正と検証は[code-work-results.md](./code-work-results.md)、公式5実装の比較は[results-code.md](./results-code.md)に記録する。同期比較は各操作100試行で、直接配線の修正前後、直接配線と委譲、Vanillaとの独立2組を分けた。作成・置換・部分更新・追加の短縮と、選択・削除の増加、転送量の増加を併記する。

## 再実行

2026-10-17の残差削減は[residual-results.md](./residual-results.md)と[residual-analysis.json](./residual-analysis.json)を参照する。最終版の公式対象はirisoutとVanillaで、実際の実行順を反転した2組を保存した。同期比較と公式比較、修正前後とVanillaとの差、採用しなかった試作を分けている。

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

# 今回と同じ試行数
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome JSFB_COUNT=10 JSFB_MEMORY_COUNT=3 bun packages/bench/js-framework/run.mjs
```

| 環境変数                              | 既定値                                | 用途                                                                        |
| ------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------- |
| `JSFB_CHECKOUT`                       | `/tmp/irisout-js-framework-benchmark` | 上流の作業ディレクトリ                                                      |
| `JSFB_PORT`                           | `8080`                                | 専用の配信ポート                                                            |
| `JSFB_RESULT_TAG`                     | 空                                    | 公式結果を`results-<tag>/`と同名のJSON・Markdownへ分けて保存する            |
| `JSFB_COUNT`                          | `3`                                   | CPUの試行回数。行選択はこれに10回を加える                                   |
| `JSFB_MEMORY_COUNT`                   | `1`                                   | メモリの試行回数                                                            |
| `JSFB_FRAMEWORKS`                     | 5実装すべて                           | 対象のカンマ区切り。例: `irisout,vanillajs`                                 |
| `JSFB_REVERSE_FRAMEWORK_ORDER`        | `0`                                   | `1`で公式サーバーの/lsの返却順を反転。CLIの列挙順だけでは実行順は変わらない |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` | Playwrightの既定                      | 比較する全実装で使うブラウザー                                              |
| `JSFB_PROBE_OUTPUT`                   | `optimization.json`                   | 同期比較のJSON保存先                                                        |
| `JSFB_PROBE_SAMPLES`                  | `15`                                  | 同期比較の試行数                                                            |
| `JSFB_PROBE_SCENARIOS`                | 全9操作                               | 同期比較の対象。カンマ区切り                                                |
| `JSFB_PROBE_REVERSE`                  | `0`                                   | `1`で各試行の実装順を反転                                                   |
| `JSFB_PROBE_CPU_RATE`                 | `1`                                   | ChromiumのCPU減速倍率                                                       |
| `JSFB_PROBE_CLEAR_ROWS`               | `1000`                                | 全削除前の行数。0・1000・10000                                              |
| `JSFB_PROBE_DISABLE_ROW_LISTENERS`    | `0`                                   | `1`で第2ページの行イベント登録を省く比較実験。選択・個別削除には使用不可    |
| `JSFB_WORK_PROBE_OUTPUT`              | `vanilla-work.json`                   | 処理回数のJSON保存先                                                        |

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

[optimization.json](./optimization.json)は、同じJSXを最初の基準版（コミット`390f84a`）と修正後で構築した比較。公式サーバー上の修正前後の画面を`probe.mjs`へ渡すと再実行できる。2026-10-15の最初の改善値はGitの`fbb8601:packages/bench/js-framework/optimization.json`に保存している。

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome bun packages/bench/js-framework/probe.mjs http://localhost:8080/frameworks/keyed/irisout-before-work/dist/index.html http://localhost:8080/frameworks/keyed/irisout/dist/index.html
```

3回の事前実行後に15回測り、各試行で修正前後の順序を交互にする。乱数の初期値を固定し、選択は200回、交換は20回の操作時間を1回当たりへ換算する。同期したイベント処理とDOM書き込みの時間を測り、レイアウト・描画は含まない。両ページのconsole.logを抑止して、上流の手書き実装に残る開発用ログの転送費用を除く。公式測定ではログの挙動を変えない。比較するスクリプトのURLとSHA-256をJSONへ記録する。

公式のクリックから描画までの時間とは別の指標である。比較用の生成物は同じJSXから各版で構築し、別のURLへ配置する。[vanilla-comparison.json](./vanilla-comparison.json)は、同じ方法で第1URLに上流の`frameworks/keyed/vanillajs/`、第2URLにirisoutを渡した値である。

## Vanillaとの差の調査

公式サーバーの起動中に次を順に実行する。時間測定中には処理回数の計測や他の検査を並行させない。

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome JSFB_PROBE_SAMPLES=100 JSFB_PROBE_OUTPUT=packages/bench/js-framework/vanilla-comparison.json bun packages/bench/js-framework/probe.mjs http://localhost:8080/frameworks/keyed/vanillajs/index.html http://localhost:8080/frameworks/keyed/irisout/dist/index.html
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome bun packages/bench/js-framework/work-probe.mjs http://localhost:8080/frameworks/keyed/vanillajs/index.html http://localhost:8080/frameworks/keyed/irisout/dist/index.html
bun packages/bench/js-framework/report.mjs
```

`work-probe.mjs`は別のページで組込み関数とDOM操作を計装し、9操作の呼出し回数を[vanilla-work.json](./vanilla-work.json)へ保存する。計装した値を時間の比較には使わない。配列操作は長さ100以上を対象とし、`inputItems`は入力の長さの合計であって、実際の要素評価回数ではない。各操作は初期状態から1回だけ実行し、初回作成には遅延初期化も含む。

現在の計装は`DocumentFragment.append`、`createDocumentFragment`、`Node.childNodes`も含む。これらは既存の`vanilla-work.json`には含まれず、追加後の実測は`vanilla-code-work.json`に保存した。JavaScriptからの呼出し回数であり、ブラウザー内部の処理回数や所要時間は示さない。

`report.mjs`は同期比較のスクリプトのSHA-256を公式測定の生成物と照合し、版が異なる過去の比較を除外する。中央値差の95%区間は同じ試行の組を再抽出する方法で求める。0を含む場合は同等と断定せず「差未確定」と記録する。

今回の公式値は`JSFB_RESULT_TAG=code`で保存した。対応する同期値は`optimization-code.json`と`vanilla-comparison-code.json`を使う。`JSFB_RESULT_TAG=code bun packages/bench/js-framework/report.mjs`に続けて`bun packages/bench/js-framework/code-report.mjs`を実行すると、保存済みの全試行値を照合し、直接配線・委譲・先行比較・公式値の95%区間と資源量を再集計する。旧結果は上書きしない。

残差削減の最終値は`residual-final`、実行順の反転は`residual-final-reverse`で保存した。`JSFB_RESULT_TAG=residual-final bun packages/bench/js-framework/report.mjs`、`JSFB_RESULT_TAG=residual-final-reverse bun packages/bench/js-framework/report.mjs`、`bun packages/bench/js-framework/residual-report.mjs`で再集計する。最終版の生成物と全試行数を照合する。再測定には`JSFB_FRAMEWORKS=irisout,vanillajs JSFB_RESULT_TAG=<新しい名前> JSFB_COUNT=10 JSFB_MEMORY_COUNT=3`を指定し、順序の反転時は`JSFB_REVERSE_FRAMEWORK_ORDER=1`を加える。`residual`と`residual-specialized`は中間段階の結果として保持する。

## 一覧高速化計画の最終集計

`bun packages/bench/js-framework/report.mjs`に続いて`bun packages/bench/js-framework/work-report.mjs`を実行する。後者は同期比較3組、中間段階、行数・CPU減速別の全削除、行イベント登録の比較実験を読み、`work-results.md`と`work-analysis.json`へ中央値・絶対差・比率・95%区間を出力する。最終生成物のSHA-256と各100試行を照合し、中間段階は各段階の保存済みSHA-256へ照合する。

最初の調査の公式値は[baseline-results.md](./baseline-results.md)と[baseline-results.json](./baseline-results.json)、同期値は[baseline-vanilla-comparison.json](./baseline-vanilla-comparison.json)へ保存した。最新結果で基準版の値を上書きしない。
