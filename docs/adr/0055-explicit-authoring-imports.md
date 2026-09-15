# ADR-0055: 記述APIを`irisout`から明示的にimportする

- **状態**: 決定済み・実装済み
- **日付**: 2026-09-15

## コンテキスト

`signal`、`derived`、`render`などを大域関数として使うと、
ソースだけを見たときの依存先が分からず、通常のJavaScript/TypeScriptの
module境界とも合わない。Solidなどの一般的な記述では、状態APIを公開入口から
名前付きでimportする。

IrisoutのこれらのAPIは実行時ランタイムではなく、コンパイラが解析して消す
記述用の印である。この性質は維持しながら、依存先だけをソース上で明示する。

## 決定

- 記述APIは公開入口`irisout`から名前付きvalue importで提供する。
  `import { signal, derived, render } from 'irisout'`を正規の記法とする。
- コンパイラは`irisout`からの記述API importをASTから取り除き、別名は
  コンパイラが認識する名前へ戻してから既存の解析へ渡す。
- `irisout`の公開入口には型検査とmodule解決のための記述API関数を置くが、
  コンパイルを通さず実行された場合は明示的に例外を投げる。生成物には
  `irisout`の記述API importを残さない。
- `irisout/jsx`はJSX namespaceと要素属性の型だけを提供し、記述APIを
  大域宣言しない。型検査対象のauthored JSXでは明示importを要求する。
- 既存の`compile(source)`、`compileBrowser(source)`へ渡される裸の
  `signal()`、`derived()`、`render()`は互換性のため当面認識する。これは
  型検査対象のauthored JSXの正規記法を変更するものではない。
- root入口以外のimport、default import、namespace import、未知の名前は
  記述API importとして扱わず、`compile:` scope limitで拒否する。

## 検討した代替案

- **大域宣言を残す**: 依存先がソースから分からず、今回の問題を解決しないため採用しない。
- **`irisout/authoring`を追加する**: import先が増え、通常の利用例で必要な記述が増えるため、
  既存の公開入口へまとめる。
- **ブラウザ実行用のsignal/derived実装を公開する**: 現在の静的HTML生成と直接DOM更新の
  契約を変え、生成物の責務を増やすため採用しない。

## 結果

authored JSXは通常のmodule importとして依存を明示でき、型検査でimport漏れを検出できる。
コンパイル時のビルド実行と生成物は従来どおり記述APIへ依存しない。裸の入力を許す互換性は
残るため、将来完全に廃止する場合は別の変更としてcompiler入口とPlayground入力を同時に移行する。

---
