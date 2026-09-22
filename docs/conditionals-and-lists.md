---
title: 条件分岐とキー付き一覧
description: 三項演算子、論理積、mapとkeyを使って動的な構造を記述する
slug: conditionals-and-lists
section: 条件分岐と一覧
order: 1
---

# 条件分岐とキー付き一覧

## 条件分岐

表示の切り替えには三項演算子または`&&`を使う。

```jsx
import { render, signal } from 'irisout'

export function Notice() {
  const open = signal(false)

  render(
    <section>
      <button type="button" onClick={() => open(!open())}>切り替え</button>
      {open() ? <p>表示中</p> : <p>非表示</p>}
    </section>,
  )
}
```

分岐が変わると以前のDOM範囲を破棄し、新しい範囲を作る。範囲内の`use`や`onMount`の後始末も同時に実行する。

## 一覧

一覧は状態を直接`.map()`したJSXとして書き、各項目のルートへ安定した`key`を指定する。

```jsx
import { render, signal } from 'irisout'

export function Tasks() {
  const tasks = signal([
    { id: 'write', label: '書く' },
    { id: 'check', label: '確認する' },
  ])

  render(
    <ul>
      {tasks().map((task) => (
        <li key={task.id}>{task.label}</li>
      ))}
    </ul>,
  )
}
```

`key`はDOM属性ではなく、項目の追加、移動、削除で同じDOMと局所状態を再利用するための識別子である。配列の位置をkeyにすると並べ替え時に別の項目として扱えないため、データが持つ識別子を使う。

一覧の更新は`tasks((previous) => next)`で配列全体を渡す。irisoutがkeyを照合し、必要なDOM操作だけを行う。
