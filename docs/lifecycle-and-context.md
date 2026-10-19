---
title: ライフサイクルとコンテキスト
description: onMount、effect、useアクション、コンテキストの所有範囲を説明する
slug: lifecycle-and-context
section: ライフサイクル
order: 1
---

# ライフサイクルとコンテキスト

## onMount

`onMount`はDOMの接続後に一度実行される。返した関数は破棄時に一度実行される。

```jsx
import { onMount, render, signal } from 'irisout'

export function Clock() {
  const now = signal(new Date())
  render(<time>{now().toLocaleTimeString()}</time>)

  onMount(() => {
    const timer = setInterval(() => now(new Date()), 1000)
    return () => clearInterval(timer)
  })
}
```

## effect

`effect`は関数内で読んだ状態の変更後に実行される。初回もDOM接続後に実行され、返した後始末関数は再実行前と破棄時に呼ばれる。

```jsx
import { effect, render, signal } from 'irisout'

export function Preference() {
  const theme = signal('light')
  render(<button onClick={() => theme(theme() === 'light' ? 'dark' : 'light')}>{theme()}</button>)

  effect(() => {
    document.documentElement.dataset.theme = theme()
    return () => delete document.documentElement.dataset.theme
  })
}
```

ソース版の`onMount`・`effect`では、`const cleanup = () => ...; return cleanup;`のように保存した後始末も返せる。局所変数を参照する閉包と宣言の実行位置を保持する。effectの依存には初期化中に実行する補助関数の読取りを含め、後始末だけの読取りは含めない。const別名と引数を経由する条件、公開版0.3.7との違い、残る制限は[イベントとアクション](./events-and-actions.md)を参照する。

## コンテキスト

`createContext`でキーと既定値を作り、`provideContext`で子孫へ値を渡し、`useContext`で最も近い値を読む。これらはコンパイル時に接続され、汎用の実行時登録表は追加されない。

```jsx
import { createContext, provideContext, render, useContext } from 'irisout'

const Locale = createContext('ja')

function Label() {
  render(<span>{useContext(Locale)}</span>)
}

export function App() {
  provideContext(Locale, 'en')
  render(<Label />)
}
```
