---
title: 状態と派生値
description: signalとderivedを使い、状態を読み書きしてDOMへ反映する
slug: state
section: 状態と更新
order: 1
---

# 状態と派生値

irisoutでは`signal`が変更できる状態、`derived`が状態から計算する値を表す。どちらも`irisout`から取り込む記述用APIであり、コンパイル後は通常の変数と専用のDOM更新処理へ変換される。

## 状態を読み書きする

`signal(initial)`は関数形式のアクセサーを返す。引数なしで現在値を読み、値または更新関数を渡して書き換える。

```jsx
import { render, signal } from 'irisout'

export function Counter() {
  const count = signal(0)

  render(
    <button type="button" onClick={increment}>
      {count()}
    </button>,
  )

  function increment() {
    count((previous) => previous + 1)
  }
}
```

同じ処理内で以前の値から次の値を作る場合は更新関数を使う。配列やオブジェクトも破壊的に変更せず、新しい値を返す。

```js
items((previous) => [...previous, { id: crypto.randomUUID(), label: '追加' }])
```

## 派生値を作る

`derived(() => expression)`は参照した状態から値を計算する。派生値へ直接書き込むことはできない。

```jsx
import { derived, render, signal } from 'irisout'

export function Price() {
  const amount = signal(1200)
  const taxIncluded = derived(() => Math.floor(amount() * 1.1))

  render(<output>{taxIncluded()}円</output>)
}
```

状態や派生値をJSXのテキスト、属性、条件分岐、一覧から読むと、コンパイラが更新先を確定する。仮想DOMによる画面全体の比較は行わない。

## 宣言する位置

ルート部品では状態と派生値を`render()`より前に宣言する。イベント処理など、状態を書き換える関数は`render()`より後に置ける。この配置が解析範囲を示す。

公開版0.3.7では、`render()`より前に通常の数値やオブジェクトを代入する変数宣言は置けない。例えば、次の宣言は未使用でも`compile: ... (scope limit)`で拒否される。

```jsx
const requests = { active: true }
```

部品が生きている間に保持する要求番号や生存状態は、表示に直接使わない値も`signal`で宣言する。

```jsx
const requestId = signal(0)
const active = signal(true)
```

イベント処理や`onMount`などの初期化関数の内部では、通常の`const`で一回の実行に使う値を宣言できる。例えば、イベント関数内の`const next = requestId() + 1`は受理される。関数を呼ぶたびに作り直す値と、部品の実行間で保持する値をこの配置で区別する。
