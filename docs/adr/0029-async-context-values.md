# ADR-0029: 非同期context値

## ステータス

**決定済み・実装済み**(2026-09-06)。非同期contextをPromiseLike値の静的置換として受理する。

## 決定

- module先頭の`const Data = createAsyncContext(PromiseLike<T>)`をcontext keyとして受理する。
- `provideContext(Data, PromiseLike<T>)`と`useContext(Data)`は通常contextと同じcompile-time
  置換を受け、置換後の値は`PromiseLike<T>`としてauthorのeffect、handler、通常の式から
  利用する。
- contextの解決後処理はauthorが`.then()`または`await`可能な動きゾーンで記述する。
  compilerはrender中のawait、Suspense、scheduler、Promiseの状態追跡を追加しない。
- async contextを使わない生成物へ型名、runtime import、context registryを出力しない。

## 境界

これは非同期値の受け渡しであり、非同期provider treeやtask-local contextではない。Promise
解決後にDOMを更新するには既存のsignal/action設計を使用する。SSR、キャンセル、Suspense、
暗黙のエラー境界は対象外である。

## 根拠

既存contextの静的置換をそのまま再利用すれば、非同期状態を追跡する汎用runtimeの固定費を
避けつつ、購読・解決・失敗処理をauthorのコードへ明示できる。
