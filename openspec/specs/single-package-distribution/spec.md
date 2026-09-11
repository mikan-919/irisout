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
梱包検査は一つの`irisout` tarballを作業領域外へ導入し、値形式と関数形式のsignal更新、配列一覧の型検査、本番構築、初期HTML、生成JavaScript、本番ソースマップ、作業領域指定の不存在を確認しなければならない(SHALL)。本番ソースマップは、生成されたイベント処理から梱包物外にある利用アプリの元JSX位置を取得できなければならない(SHALL)。

#### Scenario: 作業領域外の構築
- **WHEN** 梱包検査を実行する
- **THEN** 一つの`irisout` tarballと`vite-plus`だけを宣言した利用アプリで関数形式の配列signal更新を型検査して構築でき、生成されたイベント処理の位置から元のJSXファイルと行を取得できる

### Requirement: npm公開版の導入検査

npmへ公開した版は、版番号を固定して作業領域外へ導入し、型検査とVite構築を確認しなければ
ならない(SHALL)。ローカルtarballの検査を公開版の検査として扱ってはならない(SHALL NOT)。

#### Scenario: 公開した0.1.0の検査

- **WHEN** npm公開版の検査を実行する
- **THEN** `irisout@0.1.0`がnpmから導入され、`irisout/vite`と`irisout/jsx`を使うアプリの
  型検査と本番構築が通る
