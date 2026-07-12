// scripts/build.ts の手動確認用サンプル。テキストマーカー、derived、
// クリックハンドラのみ(静的属性・条件分岐・リストは未実装のため使わない)。
export function Counter() {
  const count = signal(0)
  const doubled = derived(() => count() * 2)
  return (
    <div>
      <p>
        count: {count()} / doubled: {doubled()}
      </p>
      <button type='button' onClick={() => count(count() + 1)}>
        increment
      </button>
    </div>
  )
}
