function TodoApp() {
  const items = signal([
    { id: 1, name: 'Buy milk' },
    { id: 2, name: 'Walk the dog' },
  ]);
  const count = derived(() => items().length);

  return (
    <div>
      <h1>Todos ({count()})</h1>
      {items().length === 0 && <p>No items yet</p>}
      <ul>{items().map((item) => <li key={item.id}>{item.name}</li>)}</ul>
    </div>
  );
}
