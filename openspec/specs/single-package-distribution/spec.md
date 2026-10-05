# single-package-distribution

## Purpose

コンパイラ、実行時処理、Vite連携、JSX型定義を、一つの`irisout` npmパッケージから
導入する公開境界を規定する。

## Requirements

### Requirement: タグからの自動公開

公開タグはパッケージの版、変更履歴、公開版の導入検査の版と一致しなければならない(SHALL)。タグのpushから既存CI、npm公開、公開版の導入検査、GitHubリリース作成を順に実行しなければならない(SHALL)。npm公開はGitHub ActionsのOIDC認証を使い、保存した公開トークンを要求してはならない(SHALL NOT)。

#### Scenario: 版と変更履歴を準備する

- **WHEN** 現在より新しい版でrelease:prepareを実行する
- **THEN** 公開パッケージ、ロックファイル、導入文書、公開版の導入検査の版を更新する
- **AND** 過去の公開記録を保持し、変更内容の記入前はrelease:checkで拒否する

#### Scenario: タグから公開する

- **WHEN** 版が一致するタグをpushする
- **THEN** CI通過後に公開し、公開版の導入検査を通してGitHubリリースを作る

#### Scenario: 公開後に再試行する

- **WHEN** 同じ公開処理を再試行する
- **THEN** 公開済みのnpm版とGitHubリリースは再作成せず、未完了の検査と記録を続ける

#### Scenario: 公開の予行を行う

- **WHEN** Releaseワークフローを手動実行する
- **THEN** CI、梱包、公開の予行だけを行い、npmとGitHubへ公開しない

### Requirement: 単一の公開導入単位

配布物は`irisout`という一つの公開npmパッケージに、コンパイラ、実行時処理、Vite連携、
診断、JSX型定義を含めなければならない(SHALL)。内部の作業領域パッケージは公開しては
ならない(SHALL NOT)。

#### Scenario: 利用アプリへの導入

- **WHEN** 利用者が`irisout`のtarballを別の作業ディレクトリへ導入する
- **THEN** 他の`@irisout/*`パッケージを指定せず、型検査とVite構築を実行できる

### Requirement: 公開副入口

パッケージは`irisout/vite`、`irisout/ssr`、`irisout/routes`、`irisout/hono`、`irisout/runtime`、`irisout/diagnostics`、`irisout/state`、`irisout/jsx`を公開しなければならない(SHALL)。生成コードは`irisout/runtime`を参照し、同じパッケージだけでブラウザー用生成物を解決できなければならない(SHALL)。`irisout/routes`のブラウザー向け経路表はHonoとファイルシステムに依存してはならない(SHALL NOT)。`irisout/hono`はHonoをpeer依存として解決しなければならない(SHALL)。

#### Scenario: Vite連携とJSX型定義

- **WHEN** 利用者がVite設定で`irisout/vite`を読み、型設定で`irisout/jsx`を指定する
- **THEN** 連携処理とJSX型定義が同じ導入済みパッケージから解決される

#### Scenario: ファイル経路の副入口

- **WHEN** 利用者が同じ`irisout`導入物から`irisout/routes`と`irisout/hono`を読み込む
- **THEN** Node側のサブルーターとブラウザー側の経路表を追加の`@irisout/*`パッケージなしで構築できる

#### Scenario: Honoをclientへ持ち込まない

- **WHEN** `irisout/routes`からブラウザー用経路表をbundleする
- **THEN** Hono、Node fs、loader実装を依存として解決しない

### Requirement: 公開宣言の自己完結

tarballの公開宣言は、コンパイラ内部のBabel AST型と生成元の`.ts`宣言を公開APIへ持ち込まず、利用者が追加の内部ファイルなしに解決できなければならない(SHALL)。`irisout/ssr`と`irisout/hono`の公開宣言もVite+内部宣言の任意依存を型検査へ持ち込んではならない(SHALL NOT)。

#### Scenario: 公開入口をskipLibCheckなしで検査する

- **WHEN** tarballを空の外部作業ディレクトリへ導入し、`irisout`、`irisout/browser`、`irisout/ssr`、`irisout/routes`、`irisout/hono`、`irisout/state`を読み込んで`skipLibCheck:false`のTypeScript型検査を行う
- **THEN** 必要な公開宣言だけで型検査が成功し、Babel型または作業領域内の`.ts`ファイルを解決しようとしない

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
