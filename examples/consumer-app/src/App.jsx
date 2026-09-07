// 別アプリ側で書く最小の authored JSX。実行時のsignal/render APIは
// compilerが解析し、生成moduleには同じ形のランタイムAPIを送らない。
export function App() {
  const text = signal('別アプリからの文章')
  const characterCount = derived(() => text().length)

  render(
    <main>
      <label>
        本文
        <textarea value={text()} onInput={(event) => text(event.currentTarget.value)} />
      </label>
      <p>{text()}</p>
      <output>文字数: {characterCount()}</output>
    </main>,
  )
}
