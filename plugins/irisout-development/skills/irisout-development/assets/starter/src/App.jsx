export function App() {
  const count = signal(0)

  render(
    <button type="button" onClick={increment}>
      Count: {count()}
    </button>,
  )

  function increment() {
    count(count() + 1)
  }
}
