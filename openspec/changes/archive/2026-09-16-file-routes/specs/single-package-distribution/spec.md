## MODIFIED Requirements

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
