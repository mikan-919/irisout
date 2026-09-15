// Vite+ dev/buildの最小サンプル。テキストマーカー、derived、クリックハンドラで、
// 静的HTMLの焼き込みとhydrate後の直接DOM更新を確認する。
// ADR-0008: 変数ゾーン(const)→ UIゾーン(render())→ 動きゾーン(function宣言)。
export function Counter() {
  const count = signal(0)
  const doubled = derived(() => count() * 2)

  render(
    <div>
      <p>
        count: {count()} / doubled: {doubled()}
      </p>
      <button type="button" onClick={increment}>
        increment
      </button>
    </div>,
  )

  function increment() {
    count(count() + 1)
  }
}
