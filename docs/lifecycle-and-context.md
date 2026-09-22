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
