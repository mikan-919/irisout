---
title: 部品とファイル分割
description: props、children、相対importを使ってJSXを分割する
slug: components-and-modules
section: 部品とファイル分割
order: 1
---

# 部品とファイル分割

## 同じファイルの部品

部品はpropsを分割代入で受け取り、内部で`render()`を呼ぶ。コンパイラは部品境界を展開し、不要な実行時部品オブジェクトを残さない。

```jsx
import { render } from 'irisout'

function Badge({ label }) {
  render(<span class="badge">{label}</span>)
}

export function App() {
  render(<Badge label="安定版" />)
}
```

`children`は直接の子位置で使える。

```jsx
function Panel({ children }) {
  render(<section class="panel">{children}</section>)
}
```

propsの別名分割、spread props、再帰部品、部品を変数として受け渡す記述は対応範囲外である。

## ファイルを分ける

`.js`、`.jsx`、`.ts`、`.tsx`の相対importを`compileProject()`とVite連携がたどる。部品や値は通常のES moduleとしてexport/importする。

```jsx
// Card.jsx
import { render } from 'irisout'

export function Card({ title }) {
  render(<article><h2>{title}</h2></article>)
}
```

```jsx
// App.jsx
import { render } from 'irisout'
import { Card } from './Card.jsx'

export function App() {
  render(<main><Card title="概要" /></main>)
}
```

循環importは拒否される。ブラウザ内コンパイラ`irisout/browser`は単一のソース文字列だけを扱うため、相対importや外部importを解決しない。
