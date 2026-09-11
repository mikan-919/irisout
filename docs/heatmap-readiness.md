# 情報量ヒートマップに向けた調査(2026-09-06)

## 結論

入力、一覧、属性による色付け、段落への移動には既存機能を利用できる。
第1〜3段階で、開発中の型検査と編集反映、非同期handlerの更新、派生値の連鎖、
一覧と共通状態の接続、条件分岐内の状態付き子部品を実装した。代表アプリを
`apps/examples/heatmap.jsx`へ置いた。外部解析ライブラリ、辞書、Workerは第4段階で、長文の
非同期解析は第5段階で扱った。診断、利用者向け型定義、別アプリの導入、自動検査、配布形式は
第6段階で扱った。本調査は実装前の再現結果と実装結果を記録し、
[旧ロードマップ](./history/roadmap-through-2026-09-07.md)の優先順位を支える記録である。以下の段階番号と実装前の制約は当時のものとして読み、現在の対応範囲は[STATUS.md](../STATUS.md)、次の作業は[ROADMAP.md](../ROADMAP.md)を参照する。

## 確認できた機能と不足

| 対象                        | 現状と根拠                                                                                                                 | ツールへの影響                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 入力と表示                  | `notes.jsx`と`authoring-coverage.test.ts`で入力、一覧、条件分岐、局所状態を検証済み                                        | 貼り付けはtextareaの入力として扱える。専用の貼り付けAPIは初期段階では不要                                       |
| 色と本文への移動            | 動的な文字列属性、`use=`、DOMイベント処理がある                                                                            | class/style文字列、段落のidとリンクで初期版を構成できる。スクロールとフォーカスは実ブラウザで確認する           |
| 本文内の強調                | `Before <mark>{text()}</mark> after`の生成物を読み込み、本文を確認できた                                                   | 混在した本文をすべて未対応とは扱わない。解析位置と原文の対応はアプリ側で検証する                                |
| 解析関数の分割              | 相対`.js`の関数宣言は読み込める。ループと値を返す関数を含むモジュールのコンパイル成功を確認                                | 純粋な同期解析から開始できる。イベント本体の文種制限を解析関数全体の制限と混同しない                            |
| 派生値の連鎖                | 依存グラフを循環検査し、派生値を依存順に再計算する                                                                         | 本文→段落→集計→色を複数の`derived()`へ分けて記述できる。循環はコンパイル時に診断する                            |
| 一覧から共通状態を読む      | 一覧・条件分岐の本文と属性からルートsignal/derivedへの依存をfactoryへ接続する                                              | 選択段落や表示指標を各行のclass、style、本文へ反映できる。props経由も回帰試験で確認した                         |
| 条件付きの部品              | 条件分岐のブランチ全体をfactoryへ渡し、局所状態とライフサイクルを所有する                                                  | 詳細パネルを表示時に初期化し、非表示時に破棄して、再表示時に初期状態へ戻せる                                    |
| 子要素の受け渡し            | `inline-components.ts`と既存仕様でchildrenを拒否                                                                           | 共通パネルの作成には制約があるが、初期版を止める必須項目とはしない                                              |
| 外部の解析ライブラリ        | `@libraz/suzume`を外部importとして生成moduleへ残し、内部をirisoutのAST解析へ入れない                                       | WebAssemblyと組み込み辞書をViteでbundleできる。全文の日本語解析はブラウザ内で行う                               |
| CSS・辞書・別スレッド用資源 | CSS、`?url`、`?worker`付きimportをViteへ渡し、資源の絶対pathを依存一覧へ加えた                                             | CSS、用語辞書URL、WebAssembly URL、Worker入口を開発・本番で同じimportから解決できる                             |
| ブラウザでの初期化          | `onMount()`内で辞書URL取得とWorker生成を行い、Worker内でSuzumeとWebAssemblyを生成する。cleanupで購読解除とWorker終了を行う | build-time executionは初期HTMLだけを作り、ブラウザ専用APIを実行しない。解析結果は要求番号で最新値だけを反映する |
| 連続入力と日本語入力        | 通常の`input`をWorkerへ送り、要求番号が古い結果を捨てる。`compositionstart`から`compositionend`までは送らない              | 解析待機中も画面操作を止めない。段落移動、指標文字列、失敗表示を実ブラウザで確認する                            |
| 長文の測定                  | 3、30、100、300段落を実Chromiumで計測し、Worker解析、表示まで、表示更新の差分、ページ側ヒープを記録                        | 300段落・25,000文字を対応範囲とし、完了基準は計測結果と`heatmap.results.md`へ固定する                           |

注: 派生値は他の状態から計算する値、ルートsignalは最上位のコンポーネントの状態を指す。
形態素解析は日本語を単語に分け、品詞などを判定する処理である。
Workerは画面操作を担当する処理とは別のスレッドで計算するブラウザの仕組みである。
辞書URLは解析用データの取得先を指し、URLの生成と文章の外部送信は別の問題である。

## 非同期処理の再現結果

以下の`App`をそれぞれ`compile()`へ渡し、生成コードを既存の`loadGenerated()`で
読み込み、`createContainer()`へのmountとクリック後に待機して表示を確認した。
再現に使った補助スクリプトは一時ファイルであり、恒久的な回帰試験は修正時に追加する。

```jsx
export function App() {
  const value = signal('before')
  render(<button onClick={run}>{value()}</button>)
  async function run() {
    const next = await Promise.resolve('after')
    value(next)
  }
}
```

コンパイルは成功するが、生成ハンドラは`async`なしの関数に`await`を含む。
Bunで生成物を読み込むと`"await" can only be used inside an "async" function`となる。
未対応構文としての拒否もなく、不正な生成物が返る問題である。

上の`run`を次の関数へ置き換えると、生成物は読み込めるが、完了後も表示が
`before`のままになる。

```js
function run() {
  Promise.resolve('after').then((next) => {
    value(next)
  })
}
```

対照例として、`onMount`のブロック本体内で同じPromiseと書き込みを使うと
表示は`after`へ更新された。非同期処理全般が未対応なのではなく、更新を挿入する
位置が経路によって異なる。`createAsyncContext`の既存試験は外部ログへの書き込みを
検証しており、このハンドラ経路の更新保証にはならない。

また、ハンドラ内の`try/catch`は`TryStatement`のscope limitで拒否された。
解析の失敗表示には、成功時の更新だけでなく例外と終了処理の契約も必要になる。
連続入力時の古い結果の破棄、処理中表示、画面破棄後の応答は本調査では未検証であり、
実装時の受け入れ条件とする。これらの制御はまずアプリ側で行い、汎用の非同期実行基盤を
追加することを前提にしない。

## 開発環境の問題

| 項目               | 確認結果                                                                                                                                                            | 必要な作業                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 編集の反映         | `apps/examples/vite.config.ts`は設定評価時に一度だけ`compileProject`を呼ぶ。プラグイン生成後に入口ファイルを書き換えても`transformIndexHtml`は旧HTMLを返した        | 入口と相対依存を監視し、HTMLとJSを同じ再コンパイル結果へ更新する。まずページ全体の再読み込みでよい                        |
| 依存ファイルの取得 | `CompileResult`は依存ファイル一覧を返さず、リンカーが内部でファイルを読む                                                                                           | ビルド連携側が依存を監視できる公開結果または同等の仕組みを設ける                                                          |
| JSXの型検査        | 一時的に`types/test/`へ`signal(1)`に文字列を書き込むJSXを追加した。`bun run typecheck`は成功し、`bun run typecheck:tsc`はTS2345で失敗した。再現用ファイルは削除済み | 通常の検査手順にJSX専用の型検査を含め、誤ったpropsとイベント値も検出する                                                  |
| 利用者用の型定義   | `@irisout/compiler/jsx`を`apps/examples`と別アプリの設定から参照する。packageはworkspaceと`0.1.0`のtarballで検証する                                                | 型定義のpackage入口と梱包検査を用意する。npm等への公開は別計画とする                                                      |
| エラー位置         | `CompileDiagnostic`が対象moduleの元ファイル・行・列をメッセージへ付ける。生成結果にソースマップはない                                                               | 診断を実装済みとし、生成コードから原文へ戻るソースマップは後続で検討する                                                  |
| 型と対応範囲の差   | 任意属性はunknownで許容され、型定義のコメントには構造内onMountを未対応とする記述が残る                                                                              | 実装とコメントを揃え、型が通ってもコンパイルできない境界を説明する。SVGは型一覧に含まれないが、初期地図はHTML要素で作れる |
| 実ブラウザの検証   | 通常の試験対象はcompiler配下。ブラウザ用計測スクリプトはあるが、ヒートマップの操作試験はない                                                                        | 入力、移動、フォーカス、日本語入力中の再解析、長文での操作性をブラウザで確認する                                          |
| 自動検査と公開準備 | `.github/workflows/ci.yml`で型検査・試験・buildを実行し、別アプリのbuild試験とtarball導入検査を持つ。コードはApache-2.0                                             | Git/workspaceの導入手順と`bun run pack:smoke`を記載し、npm等への公開と手動試用は別計画とする                              |

注: ソースマップは生成コードの位置と元のソースの位置を結び付ける情報である。
開発サーバーは調査環境の待受制限(EPERM)により起動できなかったため、編集反映は
プラグインの呼び出しと実装の確認による。待受制限をプロジェクトの欠陥とは扱わない。
ブラウザでの変更通知や状態保持は未検証である。第5段階の実ブラウザ試験は
`packages/bench/heatmap.playwright.ts`で本番生成物を静的配信して行う。

## 検証範囲

変更前の`bun run check`、`bun run test`(25ファイル・231件)、`bun run build`、
`bun run typecheck:tsc`は成功した。成功している既存機能と、本調査で見つけた未検証経路を
区別する。性能値、実用的な文章量、辞書の容量、解析精度は今回測定していない。
特定ライブラリの採用や比較、自然言語処理の指標の正当性も今回の調査対象外である。

## 第1段階の実装結果(2026-09-06)

検査と編集反映を実装した。`bun run check`と`bun run typecheck`は、rootの検査に続けて
`apps/examples/tsconfig.json`を実行し、`types/test/`のsignal、props、イベントの誤用を
検出する。`compileProject()`は入口と静的にリンクした相対`.js`/`.jsx`の絶対pathを
`dependencies`として返す。

examplesの専用Vite実装は`@irisout/vite-plugin`へ移し、仮想module、初期HTML、hydrate対象、
依存監視を連携へまとめた。依存の変更は再コンパイルと全体再読み込みへつながる。構文エラー
の後にファイルを修正した場合も、直前の正常結果を保持したまま次の変更で復帰できることを
試験で確認した。状態保持とDOM差分更新はロードマップの完了条件に含めていない。

## 第2段階の実装結果(2026-09-06)

handlerの解析結果へ`async`を保持し、生成wrapperの`await`を有効な非同期関数として
出力するようにした。handlerとPromise callbackを関数スコープごとに解析し、直接の
signal書き込みはそのhandlerまたはcallbackの実行後に、入れ子callbackの書き込みは
Promise完了後に更新する。Promiseの成功callbackと拒否callbackを使う開始・結果・失敗の
代表例を実DOMで確認した。

`try`/`catch`/`finally`は更新を置く経路を静的に確定できないため、handlerでは引き続き
`scope limit`で拒否する。失敗表示はPromiseの拒否callbackで記述する。要求の競合や
Worker連携は第5段階へ残す。

## 第3段階の実装結果(2026-09-06)

ルートのsignalとderivedを解析前に登録し、キー付きsignalを区別してderivedの依存グラフを循環検査
するようにした。入力から派生値を依存順に再計算し、複数入力を同じhandlerで更新した
場合も中間値を一度ずつ更新する。循環は`derived dependency cycle`としてコンパイル時に
拒否する。

リストと条件分岐の本文、動的属性、入れ子の構造unitからルート状態への依存を親factoryへ
接続した。条件分岐内の状態付き子部品は、ブランチ全体を0引数arrowのblockへ変換し、
局所signal、動きゾーン関数、`onMount()`、`effect()`をbranch factoryの所有にした。
表示切り替え時の破棄と再表示時の初期化を回帰試験で確認した。

`apps/examples/heatmap.jsx`に本文入力、段落分割、段落長と数値割合の指標、一覧、全体地図、
選択段落の理由表示を置いた。`bun run dev:heatmap`と専用Vite buildでこの構成を読み込める。
Workerで本文解析を行う処理、連続入力、古い非同期結果の破棄は第5段階で実装した。

## 第4段階の実装結果(2026-09-06)

`compileProject()`のmodule linkerに外部moduleとVite資源の境界を追加した。外部のdefault、
named、namespace importはライブラリの内部を解析せず、使用されるbindingだけを生成moduleへ
残す。未使用bindingは出力しない。相対`.js`/`.jsx`以外のCSS、JSON、WebAssembly、Worker資源と
`?url`、`?worker`のimportは、資源の絶対pathを依存一覧へ加えてViteへ渡す。

`apps/examples/heatmap.jsx`では`@libraz/suzume`、組み込み辞書のWebAssembly URL、アプリ固有の
用語辞書URL、Worker入口、CSSを一つの例へ接続した。ライブラリと資源の初期化は`onMount()`、
破棄はcleanupへ置いたため、初期HTML生成時にはブラウザAPIを呼ばない。

通常の本番buildに加えて`IRISOUT_BASE=/heatmap/`でbuildし、HTML、CSS、WebAssembly、Workerの
URLへ接頭辞が付くことを確認した。`packages/compiler/test/heatmap.test.ts`へbuild試験を追加し、
外部importと資源importのlinker試験を追加した。Workerで本文解析を行う処理、連続入力、古い
解析結果の破棄は第5段階へ残した。

## 第5段階の実装結果(2026-09-06)

`apps/examples/heatmap.worker.js`へSuzumeとWebAssemblyを移し、本文を要求番号付きで解析する
経路を追加した。画面側は最新要求の結果だけを採用し、失敗を状態表示へ反映する。componentの
破棄時にはイベント購読を外してWorkerを終了する。日本語入力中の`input`は状態を更新するが
解析要求を送らず、`compositionend`後に一度だけ送る。

段落へ指標値を文字で表示し、段落要素へ`tabIndex`と`aria-selected`を付けた。上下左右の
矢印キーで段落を移動できる。実Chromiumで300段落・24,790文字までを測定し、Worker解析829.8ms、
入力から表示850.8ms、表示更新の差分21.0ms、ページ側JavaScriptヒープ増分432,568B、
キーボード応答0.4msだった。対応範囲と完了基準は`packages/bench/heatmap.results.md`へ記録した。

Worker連携、要求競合、文字確定、日本語入力、段落移動、性能計測の試験は
`packages/compiler/test/heatmap.test.ts`と`packages/bench/heatmap.playwright.ts`で確認した。

## 第6段階の実装結果(2026-09-06)

`CompileDiagnostic`を追加し、parser、module linker、コンパイル中の失敗へ元ファイル・行・列を
付けた。`packages/compiler`は`@irisout/compiler/diagnostics`と`@irisout/compiler/jsx`をexportsへ
追加し、JSX型定義をpackage内へ移した。`apps/examples/tsconfig.json`と別アプリの
`examples/consumer-app/tsconfig.json`はpackage入口を参照する。

`examples/consumer-app`へVite設定、入口JSX、HTML、導入手順を置いた。`vp -C examples/consumer-app build`
を実行し、初期HTMLと生成JavaScriptを確認した。回帰試験にも同じbuildを登録した。`.github/workflows/ci.yml`
へ`bun run check`、`bun run test`、`bun run build`を登録した。

開発中の配布形式はGit/workspaceで、compiler、runtime、Vite連携は単一の`irisout` 0.1.0
tarballにまとめる。`bun run pack:smoke`でworkspace外の導入とVite buildを確認し、
`irisout` 0.1.0をnpmへ公開した。手動試用は行っていない。コードのライセンスをApache License 2.0とし、ルートの`LICENSE`、root/packageの
`license`欄、READMEへ記載した。生成コードのソースマップは後続の検討とした。
