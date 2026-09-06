# ADR-0031: JSX型検査とVite連携の開発時境界

## ステータス

決定済み・実装済み(2026-09-06)

## コンテキスト

`vp check`の対象はrootのTypeScript設定であり、`apps/examples`のauthored `.jsx`は
専用の`tsconfig.json`で検査していた。そのため通常の検査が成功しても、数値signalへの
文字列代入、component propsの不足や余分な属性、イベント引数の誤用を検出できなかった。

また、examplesのVite設定は設定評価時に一度だけ`compileProject()`を呼び、生成したHTMLと
JavaScriptを閉じ込めていた。別アプリから使う設定と、入口・相対moduleの編集反映を同じ
境界へ置くには、compilerが実際に読んだ依存一覧を連携へ渡す必要がある。

## 決定

- rootの`check`と`typecheck`は、既存のVite+検査に続けて`tsc -p apps/examples/tsconfig.json`
  を実行する。JSX固有の設定は`typecheck:jsx`として直接実行できる。
- `compileProject()`の結果へ、入口と静的にリンクした全`.js`/`.jsx`の絶対pathを
  `dependencies`として含める。`compile(source)`は文字列入力なので空の一覧を返す。
- Vite連携は`@irisout/vite-plugin`へ分離する。連携は入口、HTML置換marker、hydrate対象の
  CSS selector、仮想module名を受け取り、compilerのmodule graphを自身で再実装しない。
- 連携はbuild時に依存一覧を`addWatchFile()`へ渡し、開発時にも同じ一覧を監視する。入口または
  依存が変わったら再コンパイルして生成結果を置き換え、ページ全体の再読み込みを送る。
  HMRによるDOM差分更新と状態保持は対象外とする。
- 再コンパイルが失敗した場合は直前の正常な結果を保持したままエラーをViteへ返す。後続の
  修正で再コンパイルと全体再読み込みへ復帰できる。

## 検討した代替案

- **`vp check`へJSXを無理に含める**: root設定へ`allowJs`を追加すると比較用の手書きJSまで
  対象になり、authored JSX用の`strict`設定も分離できないため採用しなかった。
- **examplesのVite設定で依存を再解析する**: compilerと連携が別々のmodule解決を持ち、
  監視対象と実際の入力がずれるため採用しなかった。
- **生成moduleだけをHMR更新する**: 初期HTML、marker、構造unitの状態を同時に作り直す必要が
  あり、現在の連携が保証する全体再読み込みより広い実行時機構になるため対象外とした。
- **正常結果を破棄してエラー時に空の生成物を返す**: 構文を修正した次の変更までViteの
  module graphを失うため、直前の結果を保持する方式を採用した。

## 結果と残る制約

別アプリは`@irisout/vite-plugin`を設定へ追加し、入口とhydrate対象を指定できる。入口や
相対moduleの変更はサーバー再起動なしでページ全体へ反映される。JSX型検査は通常の検査で
実行される。状態保持、差分HMR、外部packageのmodule解決、生成コードのsource mapは別の
ロードマップ項目である。
