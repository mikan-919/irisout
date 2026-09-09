# single-package-distribution

## Purpose

コンパイラ、実行時処理、Vite連携、JSX型定義を、一つの`irisout` npmパッケージから
導入する公開境界を規定する。

## Requirements

### Requirement: 単一の公開導入単位

配布物は`irisout`という一つの公開npmパッケージに、コンパイラ、実行時処理、Vite連携、
診断、JSX型定義を含めなければならない(SHALL)。内部の作業領域パッケージは公開しては
ならない(SHALL NOT)。

#### Scenario: 利用アプリへの導入

- **WHEN** 利用者が`irisout`のtarballを別の作業ディレクトリへ導入する
- **THEN** 他の`@irisout/*`パッケージを指定せず、型検査とVite構築を実行できる

### Requirement: 公開副入口

パッケージは`irisout/vite`、`irisout/runtime`、`irisout/diagnostics`、`irisout/state`、
`irisout/jsx`を公開しなければならない(SHALL)。生成コードは`irisout/runtime`を参照し、
同じパッケージだけでブラウザ用生成物を解決できなければならない(SHALL)。

#### Scenario: Vite連携とJSX型定義

- **WHEN** 利用者がVite設定で`irisout/vite`を読み、型設定で`irisout/jsx`を指定する
- **THEN** 連携処理とJSX型定義が同じ導入済みパッケージから解決される

### Requirement: 単一tarballの外部導入検査

梱包検査は一つの`irisout` tarballを作業領域外へ導入し、型検査、本番構築、初期HTML、
生成JavaScript、作業領域指定の不存在を確認しなければならない(SHALL)。

#### Scenario: 作業領域外の構築

- **WHEN** 梱包検査を実行する
- **THEN** 一つの`irisout` tarballと`vite-plus`だけを宣言した利用アプリの構築が通る
