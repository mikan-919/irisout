# ADR-0036: 利用者向け診断、型定義、配布形式

## ステータス

決定済み・実装済み(2026-09-06)

## コンテキスト

ヒートマップの代表アプリを動かす段階では、開発者が別のアプリへirisoutを組み込んだときに、
コンパイル失敗の場所と導入手順を確認できる必要がある。以前の診断は生成後の連結ソースを
対象にし、元ファイルの行と列をメッセージへ付けていなかった。JSX型定義もリポジトリ直下を
相対参照していたため、別アプリから同じ設定を使えなかった。

パッケージの公開は、利用手順の確認と同時に行う必要はない。公開先、版番号、依存パッケージの
配布条件は別の判断を必要とするため、この段階ではGitリポジトリ内で再現できる配布形式を決める。

## 決定

- `CompileDiagnostic`をcompilerの公開診断型とする。メッセージは`compile:`で始まり、
  `[file:line:column]`を末尾へ付ける。Babelの位置情報を優先し、位置を取得できない場合は
  対象元ファイルの先頭へ置く。`compile()`は`<source>`、`compileProject()`とmodule linkerは
  対象moduleの絶対pathを使う。
- 診断は`@irisout/compiler/diagnostics`から参照できる。JSXのグローバルな`JSX`型、
  `signal`、`derived`、`render`、`onMount`、`effect`などの宣言は
  `@irisout/compiler/jsx`から参照できる。packageの`exports`と`files`へ登録し、利用者側の
  `tsconfig.json`は`types: ["@irisout/compiler/jsx"]`を指定する。
- 別アプリの設定例を`examples/consumer-app`へ置く。`@irisout/vite-plugin`が入口JSXを
  コンパイルし、`@irisout/runtime`を生成moduleの実行時依存として読み込む。入口JSX、
  `index.html`のhydrate対象、Vite設定、型検査設定、build手順を同じ例へ置く。
- `bun run check`へexamplesと別アプリの型検査を含める。`bun run test`へ別アプリの
  `vp -C examples/consumer-app build`試験を含める。GitHub Actionsはlockfile固定の依存導入後に
  check、test、buildを実行する。
- irisoutのコードとworkspace packageはApache License 2.0とする。ルートの`LICENSE`と
  packageの`license`欄へ記載する。現時点の配布形式はGitリポジトリ内のprivate workspaceとし、
  npm等への公開は行わない。外部依存のライセンスは各依存元の条件に従う。
- 生成コードのソースマップはこの段階で追加しない。元ファイルの診断が不足する事例が出た
  場合に、生成moduleと元moduleの対応を別の設計として扱う。

## 結果

別アプリは`@irisout/vite-plugin`、`@irisout/runtime`、`@irisout/compiler/jsx`をworkspaceから
解決してbuildできる。コンパイル失敗は対象元ファイル、行、列を含む`CompileDiagnostic`として
受け取れる。型検査、試験、buildはローカルとGitHub Actionsで同じコマンドを使う。

パッケージの公開作業を行わずに、利用者が導入設定と検査手順を再現できる。公開に必要な版番号、
レジストリ設定、変更履歴、依存ライセンス一覧は後続の公開計画で決める。

## 検証

- `packages/compiler/test/diagnostics.test.ts`でparser失敗と相対module解決失敗のファイル・行・列を確認した。
- `packages/compiler/test/consumer-app.test.ts`で別ディレクトリからVite buildを実行し、初期HTMLと生成JavaScriptを確認した。
- `bun run check`でroot、examples、consumer exampleの型検査を実行した。
- `bun run test`と`bun run build`を実行した。
