## Why

条件分岐とkey付き一覧で要素を削除すると、現状は退場アニメーションを表示できない。

## What Changes

- `AnimatePresence`と`exit`をMotion拡張へ追加する。
- 条件分岐とkey付き一覧の削除時だけ、退場完了まで要素を保持する。
- 初回は`mode="sync"`だけを受け付ける。

## Capabilities

### Modified Capabilities

- `motion-extension`: 退場アニメーションを追加する。

## Impact

Motion用JSX変換、actionの破棄処理、汎用DOM更新取引の状態参照、型、ブラウザー試験に影響する。
