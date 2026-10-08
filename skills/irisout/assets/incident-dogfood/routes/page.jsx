// 要求番号と破棄状態で検索応答を選ぶ一覧。遅延と失敗は試験用APIで再現する。
import { render, signal, onMount } from 'irisout'
import { Layout } from '../Layout.jsx'

export function IncidentList({ incidents }) {
  const items = signal(incidents)
  const query = signal('')
  const failure = signal('')
  const pending = signal(false)
  const sequence = signal(0)
  const active = signal(true)

  render(
    <Layout title="障害一覧">
      <main>
        <h1>障害一覧</h1>
        <label>
          検索
          <input type="search" value={query()} onInput={search} />
        </label>
        <p role="status">{pending() ? '検索中' : failure() ? '検索失敗' : '検索完了'}</p>
        <p role="alert">{failure()}</p>
        <ul>
          {items().map((item) => (
            <li key={item.id}>
              <span>{item.title}</span>
              <span>{item.resolved ? '解決済み' : '未解決'}</span>
              <a href={'/incidents/' + item.id}>詳細</a>
            </li>
          ))}
        </ul>
      </main>
    </Layout>,
  )

  onMount(() => {
    return () => active(false)
  })

  function search(event) {
    const value = event.currentTarget.value
    const requestNumber = sequence() + 1
    query(value)
    sequence(requestNumber)
    pending(true)
    failure('')
    fetch('/api/incidents?q=' + encodeURIComponent(value))
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error('検索に失敗しました')),
      )
      .then((result) => {
        if (active() && sequence() === requestNumber) {
          items(result)
          pending(false)
        }
      })
      .catch((error) => {
        if (active() && sequence() === requestNumber) {
          failure(error.message)
          pending(false)
        }
      })
  }
}
