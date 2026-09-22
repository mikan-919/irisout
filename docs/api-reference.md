---
title: 記述API一覧
description: irisoutから取り込む記述用APIの役割と呼び出し形式
slug: api
section: API
order: 1
---

# 記述API一覧

記述用APIは`irisout`から名前付きで取り込む。コンパイラが解析して生成物から取り除くため、コンパイルせずに直接実行する用途には使えない。

## 状態と描画

- `signal(initial)` — 読み書きできる状態を作る。`value()`で読み、`value(next)`または`value(previous => next)`で更新する。
- `derived(compute)` — ほかの状態から計算する読み取り専用値を作る。
- `render(element)` — 部品が所有するJSXのルートを宣言する。

## ライフサイクル

- `onMount(callback)` — DOM接続後に一度実行する。callbackは破棄関数を返せる。
- `effect(callback)` — 参照した状態の変更後に処理する。callbackは次回実行前と破棄時の後始末関数を返せる。
- `use={action}` — JSX属性として実DOMへ処理を接続する。actionは`update`と`destroy`を返せる。

## コンテキスト

- `createContext(defaultValue)` — 同期値のコンテキストを作る。
- `createAsyncContext(defaultValue)` — `PromiseLike`値のコンテキストを作る。
- `provideContext(context, value)` — 現在の部品または構造範囲から子孫へ値を渡す。
- `useContext(context)` — 最も近い提供値を読み、なければ既定値を使う。

## コンパイラ入口

アプリケーションでは通常`irisout/vite`を使う。道具を作る場合は次の入口を利用できる。

- `compile(source)` — 単一ソースを変換する。
- `compileProject(entryPath, options)` — 相対moduleをたどって変換する。
- `compileSSR(source)` — 要求単位SSR用のmoduleを生成する。
- `irisout/browser`の`compile(source)` — Workerなどブラウザ内で単一ソースを変換する。

Vite連携、ブラウザ内変換、SSRは実行環境と信頼境界が異なる。投稿コードはWorkerとsandbox付きiframeで隔離し、サーバーで直接実行しない。
