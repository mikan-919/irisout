## Why

contextの静的置換は実装済みだが、PromiseLike値を扱う契約がなく、authorはcontextを
使うだけで非同期解決を明示できなかった。既存置換を再利用し、非同期処理の所有と失敗
処理をauthor側へ残した最小APIを追加する。

## What Changes

- `createAsyncContext<T>(PromiseLike<T>)`の型とcompile-time key収集を追加する。
- `provideContext`/`useContext`の置換後値をPromiseLikeとして動きゾーンへ渡す。
- await、Suspense、scheduler、task-local registryは追加しない。

## Non-goals

- 非同期provider tree、SSR、Promiseキャンセル、暗黙の再描画、module共有state。

## Impact

- `types/jsx.d.ts`、compiler context収集、module linkerのcontext判定を変更する。
- async contextのeffect受入試験とADR/OpenSpecを追加する。
