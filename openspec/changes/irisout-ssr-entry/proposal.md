## Why

共有ページは要求ごとの保存データから初期HTMLを生成し、ブラウザで同じ状態へ接続する必要がある。既存のclient build入口へ要求状態を混ぜず、指定した運営側ルート部品だけをSSRする公開境界を追加する。

## What Changes

- `irisout/ssr`とVite+用`irisoutSsr()`を単一公開パッケージへ追加する。
- `irisoutSsr()`へ指定したルート部品の初期描画全体を要求ごとに実行する。
- `render(input) -> { html, state }`を生成し、JSON直列化可能なstateをhydrateへ渡す。
- 入力、テキスト、属性、条件分岐、局所signalを初期対応にする。
- module共有状態を診断で拒否する。
- イベント、`onMount`、`effect`、`use=`をSSRで実行しない。
- 子部品単位の指定とSSR可能性の自動判定を追加しない。

## Capabilities

### New Capabilities

- `server-rendering-entry`: Irisoutの要求単位SSR入口とhydrate state契約

### Modified Capabilities

なし。

## Impact

`packages/compiler`、`packages/runtime`、`packages/vite-plugin`、`packages/irisout`のexports、Vite+連携、SSRテストに影響する。既存の`irisout/vite`とclient buildの契約は維持する。
