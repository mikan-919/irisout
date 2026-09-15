## Why

`signal`、`derived`、`render`などを大域関数として使うと、ソースだけでは依存先が分からない。公開入口から名前付きでimportする通常のmodule記法へ揃え、型検査でimport漏れを検出できるようにする。

## What Changes

- `irisout`の公開入口へ記述APIの型とコンパイル専用関数を追加する。
- source parserとmodule linkerで`irisout`からの記述API importを取り除く。
- `irisout/jsx`の大域記述API宣言を削除し、実例と型検査用入力を明示importへ移行する。
- 既存の`compile(source)`と`compileBrowser(source)`の裸のAPI名は互換性のため当面受理する。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `authored-jsx-type-checking`: 記述APIを`irisout`からの明示的な名前付きimportへ変更する。

## Impact

コンパイラ、公開型宣言、Vite利用例、ブラウザ用Playground初期値、型検査、source mapの期待行、公開文書が対象となる。生成物の実行時ランタイムと既存の裸の`compile(source)`入力は変更しない。
