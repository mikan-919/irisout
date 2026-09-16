## Why

`irisout/ssr`は単一部品を扱えるが、ページのファイル構造、サーバーの経路、ブラウザーの画面切り替えを別々に管理する必要がある。`page.jsx`を基準に一つの経路定義を生成し、要求単位のSSRと同一生成元の遷移へ接続する。

## What Changes

- `page.jsx`のディレクトリ構造から静的・動的経路を生成する。
- 静的優先、動的経路の衝突診断、末尾斜線と経路引数の正規化を共通化する。
- `irisout/hono`から既存Honoへ組み込めるサブルーターを提供する。
- ページ別のサーバー取得処理を既存の`render(input) -> { html, state }`へ要求ごとに接続する。
- 直接アクセス用HTML応答と、ブラウザー遷移用のHTML・state応答を提供する。
- `irisout/vite`へファイル経路からクライアント経路表とhydrate用ページ生成物を作る機能を追加する。
- リンク、履歴、取得競合、旧画面の破棄、失敗時の通常文書遷移を実装する。
- `irisout`の公開副入口とHonoのpeer依存を更新する。

## Capabilities

### New Capabilities

- `file-routing`: `page.jsx`から共通経路定義を生成し、サーバー用・クライアント用へ変換する。
- `client-navigation`: 生成された経路表を使い、ブラウザーの画面遷移と初回hydrateを管理する。

### Modified Capabilities

- `server-rendering-entry`: ページ経路、取得処理、直接アクセスと遷移応答を既存SSRへ追加する。
- `single-package-distribution`: `irisout/routes`、`irisout/hono`とファイル経路対応のVite機能を公開する。

## Impact

`packages/routes`、`packages/hono`、`packages/vite-plugin`、コンパイラの受入試験、`scripts/build-packages.mjs`、公開宣言、OpenSpec仕様を変更する。Honoを`irisout`のpeer依存と開発時依存へ追加する。既存の単一部品SSRとVite入口の利用方法は維持する。
