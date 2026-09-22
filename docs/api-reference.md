---
title: APIリファレンス
description: 記述用API、JSX属性、コンパイラ、Vite連携、SSR、Hono経路の公開入口
slug: api
section: API
order: 1
---

# APIリファレンス

画面の記述には`irisout`を使う。記述用APIはコンパイラが解析し、ブラウザー用の直接DOM操作へ変換する。未変換のまま実行する関数ではない。

## 記述用API

### `signal(initial)`

```ts
function signal<T>(initial: T): IrisSignal<T>
```

読み出しと更新を一つの関数で行う状態を作る。引数なしで読み出し、値または更新関数を渡して更新する。

### `derived(compute)`

```ts
function derived<T>(compute: () => T): () => T
```

ほかの状態から計算する読み取り専用値を作る。

### `render(element)`

部品が所有するJSXのルートを宣言する。部品はJSXを返さず、内部で`render()`を呼ぶ。

### `onMount(callback)`と`effect(callback)`

`onMount`はDOM接続後に一度実行する。`effect`はコールバック内で参照した状態の変更に反応する。どちらも破棄関数を返せる。

### `use={action}`

`use`は取り込む関数ではなくJSX属性である。接続時に実DOMを受け取り、更新関数または`update`と`destroy`を持つオブジェクトを返せる。

## コンテキスト

```ts
createContext<T>(defaultValue: T): IrisContext<T>
createAsyncContext<T>(defaultValue: PromiseLike<T>): IrisAsyncContext<T>
provideContext<T>(context: IrisContext<T>, value: T): void
useContext<T>(context: IrisContext<T>): T
```

最も近い提供値を子孫から読み、提供値がなければ作成時の既定値を使う。

## JSX共通属性

- `onXxx` — DOMイベントを接続する。
- `key` — 一覧内の要素や部品を識別する。
- `use` — 実DOMへアクションを接続する。
- `children` — 部品へ子要素を渡す。
- `class`、`data-*`、`aria-*` — DOM属性へ反映する。

## コンパイラ

```ts
compile(source: string): CompileResult
compileSSR(source: string): CompileResult
compileProject(entryPath: string, options?): CompileResult
```

`CompileResult`にはブラウザー用の`code`、ソースマップ`map`、初期描画`initialHtml`、SSR用の`ssrCode`、読み込んだ`dependencies`が入る。

`irisout/browser`の`compile()`はNode.jsのファイル機能を使わず、Workerなどで単一ソースを変換する。

## ViteとSSR

- `irisout/vite`の`irisout(options)` — 入口、対象要素、HTML差し込み位置、仮想モジュール、前処理を設定する。
- `irisout/ssr`の`irisoutSsr(options)` — 要求単位のSSRモジュールをViteへ接続する。
- `serializeSsrState(value)` — 状態を`script`要素へ埋め込める形へ変換する。

## Honoファイル経路

- `createFileRouter(directory, options)` — `page.tsx`と`page.jsx`をHonoサブルーターへ接続する。
- `notFound()` — loaderから404を返す。
- `redirect(location, status?)` — loaderからHTTP転送を返す。
- `createRouteStateScript(routeId, state)` — 初期状態を安全な`script`要素へ変換する。

## 診断

`irisout/diagnostics`の`CompileDiagnostic`は`filePath`、`line`、`column`、`message`を持つ。対応範囲外の記述や構文エラーを位置情報付きで扱える。
