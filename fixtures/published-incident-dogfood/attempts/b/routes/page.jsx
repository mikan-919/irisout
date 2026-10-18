import { render, signal } from 'irisout'
import { Layout } from '../Layout.jsx'
export function IncidentList({ initial }) {
  const items = signal(initial)
  const query = signal('')
  const error = signal('')
  const requestId = signal(0)
  const active = signal(true)
  render(
    <Layout title="障害一覧">
      <main use={lifetime}>
        <h1>障害一覧</h1>
        <label>
          検索
          <input value={query()} onInput={search} />
        </label>
        <p role="status">{error()}</p>
        <ul>
          {items().map((item) => (
            <li key={item.id}>
              <span>{item.title}</span> <span>{item.resolved ? '解決済み' : '対応中'}</span>{' '}
              <a href={'/incidents/' + item.id}>詳細</a>
            </li>
          ))}
        </ul>
      </main>
    </Layout>,
  )
  function search(event) {
    query(event.currentTarget.value)
    requestId(requestId() + 1)
    error('')
    const current = requestId()
    fetch('/api/incidents?q=' + encodeURIComponent(query()))
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('検索失敗'))))
      .then((data) => {
        if (active() && requestId() === current) {
          items(data)
          error('')
        }
      })
      .catch(() => {
        if (active() && requestId() === current) {
          error('検索失敗 (503)。検索語を変更してください。')
        }
      })
  }
  function lifetime(element) {
    return {
      destroy() {
        active(false)
      },
    }
  }
}
