# ADR-0047: 単一公開パッケージ

## ステータス

**決定済み・実装済み**(2026-09-09)

## 背景

ADR-0043ではコンパイラ、実行時処理、Vite連携を三つのnpmパッケージとして梱包した。
利用者は三つの依存と、`@irisout/compiler/jsx`などの入口を設定する必要があった。
内部責務を分割することと、利用者へ複数の導入単位を見せることは別の判断である。

## 決定

- npmでの公開単位を版`0.1.0`の`irisout`一つにする。
- 内部の作業領域は`compiler`、`runtime`、`vite-plugin`に分けたまま維持し、三つの内部
  パッケージは`private`にする。
- 公開入口を`irisout`、`irisout/vite`、`irisout/runtime`、`irisout/diagnostics`、
  `irisout/state`、`irisout/jsx`とする。
- 生成コードは`irisout/runtime`を参照する。Vite連携の配布物は同じパッケージ内の
  コンパイラを相対参照する。
- `bun run pack:smoke`は一つのtarballだけを別ディレクトリへ導入し、型検査、Vite構築、
  初期HTML、生成JavaScript、作業領域依存の不存在を確認する。
- npmへの登録はこの変更に含めない。2026-09-09時点で`npm view irisout`は404を返したが、
  公開時の名前確保を保証するものではない。

## 結果

利用者は`irisout`と対等依存の`vite-plus`を導入し、Vite設定では`irisout/vite`、型設定では
`irisout/jsx`を指定する。内部パッケージを個別に選ぶ必要はない。

注: 対等依存とは、連携先の版を利用アプリ側で選び、パッケージ側が対応範囲だけを宣言する
npmの依存関係である。ここでは`vite-plus >=0.3.0`を指す。
