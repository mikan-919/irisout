---
title: イベントとuseアクション
description: DOMイベント、イベントオブジェクト、useアクションの初期化と破棄を扱う
slug: events-and-actions
section: イベント
order: 1
---

# イベントとuseアクション

## DOMイベント

`onClick`や`onInput`には関数を渡す。イベントはブラウザ標準のオブジェクトで、`currentTarget`は属性を指定した要素を指す。

```jsx
import { render, signal } from 'irisout'

export function NameField() {
  const name = signal('')

  render(
    <label>
      名前
      <input value={name()} onInput={updateName} />
      <output>{name()}</output>
    </label>,
  )

  function updateName(event) {
    name(event.currentTarget.value)
  }
}
```

非同期処理もイベント関数に置ける。古い要求の取り消しや競合結果の選択はアプリ側で管理する。

## useアクション

`use={action}`は実DOMが必要な処理を接続する。アクションは要素を受け取り、必要なら`update`と`destroy`を返す。

```jsx
import { render } from 'irisout'

export function FocusedField() {
  render(<input use={focus} />)

  function focus(element) {
    element.focus()
    return {
      destroy() {
        element.blur()
      },
    }
  }
}
```

`destroy`は条件分岐や一覧から要素が外れたとき、または部品が破棄されたときに呼ばれる。外部イベント監視、観測器、タイマーなどの解除に使う。
