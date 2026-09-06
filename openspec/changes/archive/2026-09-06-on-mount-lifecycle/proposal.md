## Why

`use=` actionは要素単位の初期化と破棄を扱えるが、timer・購読・WebSocketなど
要素に紐付かない処理をcomponent instanceのmount/unmountへ接続するAPIがない。
既存の`unmount()`とaction cleanupの所有権を利用し、ルートcomponentだけに
`onMount`を追加する。

## What Changes

- 動きゾーンで`onMount(() => void | (() => void))`を受理する。
- mount/hydrate完了後にcallbackを一度呼び、返されたcleanupをunmount時に逆順で一度呼ぶ。
- callback初期化失敗時も、登録済みcleanupを実行する。
- `types/jsx.d.ts`、ADR、STATUS、ROADMAP、README、受入仕様を更新する。

## Non-goals

- `effect`、context、SSR、再mount、汎用lifecycle registry。
- 構造unit内のonMount、inline化される子componentのonMount。
- object形式や引数付きcleanupなど、`onMount`の契約外の返り値。
