import { render, signal } from 'irisout'
import { Layout } from '../Layout.jsx'

export function IncidentList({ incidents }) {
  const items = signal(incidents)
  const query = signal('')
  const message = signal('')
  const active = signal(true)
  const sequence = signal(0)

  render(
    <Layout title="障害対応ボード">
      <main use={ownRequests}>
        <h1>障害対応ボード</h1>
        <label>
          検索
          <input type="search" value={query()} onInput={search} />
        </label>
        <p role="status">{message()}</p>
        <ul>
          {items().map((incident) => (
            <li key={incident.id}>
              <h2>{incident.title}</h2>
              <p>{incident.resolved ? '解決済み' : '未解決'}</p>
              <a href={'/incidents/' + incident.id}>詳細</a>
            </li>
          ))}
        </ul>
      </main>
    </Layout>,
  )

  async function search(event) {
    query(event.currentTarget.value)
    sequence(sequence() + 1)
    const requestSequence = sequence()
    message('検索中')
    const response = await fetch('/api/incidents?q=' + encodeURIComponent(query()))
    if (active() && requestSequence === sequence()) {
      if (response.ok) {
        const results = await response.json()
        if (active() && requestSequence === sequence()) {
          items(results)
          message('')
        }
      } else {
        message('検索に失敗しました。もう一度入力してください。')
      }
    }
  }

  function ownRequests(element) {
    return {
      destroy() {
        active(false)
        sequence(sequence() + 1)
      },
    }
  }
}
