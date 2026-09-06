# ADR-0034: ブラウザ解析の外部依存境界

## ステータス

決定済み・実装済み(2026-09-06)

## コンテキスト

ヒートマップの初期実装では、コンパイラが相対`.js`/`.jsx`をASTへ連結するため、
外部パッケージ、CSS、辞書URL、Worker入口を同じ経路へ渡せなかった。解析ライブラリ
の内部をirisoutの構文として解析すると、ライブラリの実装をコンパイラの対応範囲へ
含めることになる。ブラウザ専用のWebAssembly初期化をコンパイル時に実行することも
避ける必要がある。

## 決定

- `compileProject()`は外部moduleの静的importを解析対象へ入れず、使用されるdefault、
  named、namespace bindingだけを生成moduleへ残す。未使用の外部bindingは出力しない。
- 相対`.js`/`.jsx`以外の資源importと、`?url`、`?worker`を付けた相対importは、
  Viteへ渡すimportとして残す。実ファイルの絶対pathは`dependencies`へ含め、開発時の
  変更監視へ渡す。相対`.js`/`.jsx`のside-effect import、dynamic import、循環依存は
  引き続き拒否する。
- 日本語の形態素解析には`@libraz/suzume` 0.9.10を使う。WebAssemblyと組み込み辞書を
  ブラウザで読み込めるため、kuromojiの辞書ディレクトリを別配信しない。ライセンスは
  Apache-2.0である。仕様は[公式サイト](https://suzume.libraz.net/)とパッケージの
  型定義を参照する。
- 代表アプリ固有の用語辞書は`heatmap-dictionary.json?url`でURL化する。Suzumeの
  WebAssemblyは`@libraz/suzume/wasm?url`でURL化する。Worker入口は
  `heatmap.worker.js?worker`、CSSは`heatmap.css`のside-effect importで渡す。
- ライブラリ、辞書、Workerの生成と破棄はroot `onMount()`とcleanupへ置く。初期HTMLを
  作るbuild-time executionではブラウザAPIを呼ばない。Workerで本文解析を行う処理と
  要求競合の処理は第5段階で実装する。
- 配信時の接頭辞はViteの`base`へ委ねる。examplesは`IRISOUT_BASE`で試験できる。

## 結果

外部ライブラリの内部をコンパイルせず、生成moduleの静的importとしてViteの依存解決・
tree-shakingへ渡せる。CSS、辞書URL、Worker、WebAssemblyは開発と本番で同じ入口を使い、
接頭辞付き本番buildでも資源URLが書き換わる。

`apps/examples/heatmap.jsx`は初期HTML生成後に辞書URLを取得し、Workerへ初期化要求を送る。
SuzumeとWebAssemblyの生成はWorker内で行い、componentのunmount時に購読解除とWorker終了を
行う。本文の連続解析と古い結果の破棄はADR-0035で追加した。

## 検証

- `packages/compiler/test/multi-file-module-composition.test.ts`で外部importの通過、
  未使用bindingの除外、CSS・URL・Worker資源の依存監視を確認した。
- `packages/compiler/test/heatmap.test.ts`で代表アプリのDOM操作と、`/heatmap/`接頭辞の
  本番buildにおけるJS、CSS、WebAssembly、Worker資源を確認した。
- `bun run check`、`bun run test`、`IRISOUT_ENTRY=heatmap.jsx bun run build`を実行した。
- Worker内解析、要求競合、文字確定、破棄処理、実Chromiumの性能測定はADR-0035と
  `packages/bench/heatmap.results.md`へ記録した。
