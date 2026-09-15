// 公式文書とPlaygroundが共有するCounter入力。
import { render, signal } from 'irisout'

export function Counter() {
  const count = signal(0)

  render(
    <main>
      <h1>Counter</h1>
      <output>{count()}</output>
      <button type="button" onClick={increment}>
        増加
      </button>
    </main>,
  )

  function increment() {
    count(count() + 1)
  }
}
