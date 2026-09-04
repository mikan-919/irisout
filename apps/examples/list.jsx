// List最小ランタイムのplayground。追加・binding更新・並べ替え・削除を通して、
// keyに対応するDOM要素を再利用しながら必要な箇所だけを更新する。
export function ListPlayground() {
  const items = collection(
    [
      { id: 1, text: 'alpha' },
      { id: 2, text: 'beta' },
      { id: 3, text: 'gamma' },
    ],
    (item) => item.id,
  )

  render(
    <main>
      <h1>irisout List playground</h1>
      <p>{items().length} items</p>
      <div class="controls">
        <button type="button" onClick={addItem}>
          add
        </button>
        <button type="button" onClick={renameFirst}>
          update first
        </button>
        <button type="button" onClick={reverseItems}>
          reverse
        </button>
        <button type="button" onClick={removeFirst}>
          remove first
        </button>
      </div>
      <ul>
        {items().map((item) => (
          <li key={item.id}>{item.text}</li>
        ))}
      </ul>
    </main>,
  )

  function addItem() {
    items([...items(), { id: Date.now(), text: 'new item' }])
  }

  function renameFirst() {
    const first = items()[0]
    if (first) items.update(first.id, (item) => ({ ...item, text: item.text + '!' }))
  }

  function reverseItems() {
    items([...items()].reverse())
  }

  function removeFirst() {
    items(items().slice(1))
  }
}
