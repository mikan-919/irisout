# 相対module由来の診断で列位置がずれる

## 報告

> “Unsupported component-level if produced `compile: only top-level signal()/derived() declarations are supported in this milestone (scope limit)` at App.jsx:4:3, not the if line; this is confusing vs docs saying diagnostic identifies rejected syntax/location.”

追試で相対module内の未対応文を拒否した際、元ファイルと行は正しくても列が47と表示された。

## 受入条件

- 相対module内の拒否位置を、元ファイルの行と列で報告する。
- 入口ファイル内の既存診断位置を変えない。

修正は`packages/compiler/src/diagnostics.ts`と`packages/compiler/src/compiler/render.ts`へ反映し、`packages/compiler/test/diagnostics.test.ts`で検査した。
