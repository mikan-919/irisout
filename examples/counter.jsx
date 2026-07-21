// scripts/build.ts の手動確認用サンプル。テキストマーカー、derived、
// クリックハンドラのみ(静的属性・条件分岐・リストは未実装のため使わない)。
// ADR-0008: 変数ゾーン(const)→ UIゾーン(render())→ 動きゾーン(function宣言)。
export function Counter() {
  const count = signal(0)
  const doubled = derived(() => count() * 2)

  render(
    <div>
      <p>
        count: {count()} / doubled: {doubled()}
      </p>
      <button type='button' onClick={increment}>
        increment
      </button>
    </div>,
  )

  function increment() {
    count(count() + 1)
  }
}
