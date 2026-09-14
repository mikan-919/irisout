## Why

Playgroundの入力はブラウザ内で変換する必要があるが、現在の単一ソース入口と`compileProject()`はNodeのファイル読込み経路を共有している。投稿ソースをサーバーの診断処理へ渡さず、公式サイトの権限から分離した実行へ接続するため、Node非依存の入口を追加する。

## What Changes

- 単一`.jsx`を受け取るブラウザ用コンパイラ入口を公開する。
- `compileProject()`のファイル解決とNode依存をブラウザ用生成物から除く。
- 現行の対応記法、`compile:`診断、生成結果の意味を維持する。
- 単一ファイルと同一ファイル内の部品だけを初期対象にする。
- 外部module、静的・動的import、外部資源は初期Playground対象から拒否する。

## Capabilities

### New Capabilities

- `browser-compiler-entry`: 単一JSXをブラウザで変換する公開境界

### Modified Capabilities

なし。

## Impact

`packages/compiler`の公開入口、梱包物のexports、ブラウザ向け依存、Playground Workerの入力に影響する。既存の`compile()`、`compileProject()`、`irisout/vite`の利用者契約は変更しない。
