// 公式文書とPlaygroundが共有するList入力。
export function List() {
  const items = signal([
    { id: 1, label: 'alpha' },
    { id: 2, label: 'beta' },
  ])

  render(
    <main>
      <h1>List</h1>
      <button type="button" onClick={addItem}>
        追加
      </button>
      <ul>
        {items().map((item) => (
          <li key={item.id}>{item.label}</li>
        ))}
      </ul>
    </main>,
  )

  function addItem() {
    items((previous) => [...previous, { id: previous.length + 1, label: 'new' }])
  }
}
