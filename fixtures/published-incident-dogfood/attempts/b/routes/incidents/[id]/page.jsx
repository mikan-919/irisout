import { render, signal, onMount } from 'irisout'
import { Layout } from '../../../Layout.jsx'
export function IncidentDetail({ incident }) {
  const id = signal(incident.id)
  const subject = signal(incident.title)
  const resolved = signal(incident.resolved)
  const memo = signal('')
  const received = signal(0)
  const error = signal('')
  const active = signal(true)
  render(
    <Layout title={subject()}>
      <main>
        <h1>{subject()}</h1>
        <p role="status">{resolved() ? '解決済み' : '対応中'}</p>
        <button type="button" onClick={resolve}>
          解決する
        </button>
        <p role="alert">{error()}</p>
        <label>
          作業メモ
          <input value={memo()} onInput={saveMemo} />
        </label>
        <p use={observe}>
          監視中 <output aria-label="受信数">{received()}</output>
        </p>
        <a href="/">一覧へ戻る</a>
      </main>
    </Layout>,
  )
  function resolve() {
    fetch('/api/incidents/' + id() + '/resolve', { method: 'POST' })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('更新失敗'))))
      .then((data) => {
        if (active()) {
          resolved(data.resolved)
        }
      })
      .catch(() => {
        if (active()) {
          error('更新失敗')
        }
      })
  }
  function saveMemo(event) {
    memo(event.currentTarget.value)
    localStorage.setItem('incident-memo:' + id(), memo())
  }
  function observe(element) {
    const receive = () => {
      received(received() + 1)
    }
    window.addEventListener('incident-ping', receive)
    return {
      destroy() {
        window.removeEventListener('incident-ping', receive)
      },
    }
  }
  onMount(() => {
    memo(localStorage.getItem('incident-memo:' + id()) ?? '')
    return () => {
      active(false)
    }
  })
}
