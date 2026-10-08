// 障害の解決、ID別メモ、画面の所有期間に合わせた監視解除を試す詳細。
import { render, signal, onMount } from 'irisout'
import { Layout } from '../../../Layout.jsx'

export function IncidentDetail({ incident }) {
  const resolved = signal(incident.resolved)
  const memo = signal('')
  const received = signal(0)
  const failure = signal('')
  const pending = signal(false)

  render(
    <Layout title={incident.title}>
      <main>
        <h1>{incident.title}</h1>
        <p>{resolved() ? '解決済み' : '未解決'}</p>
        <button type="button" disabled={resolved() || pending()} onClick={resolve}>
          解決する
        </button>
        <p role="alert">{failure()}</p>
        <label>
          作業メモ
          <input value={memo()} onInput={saveMemo} />
        </label>
        <p use={observe}>監視中</p>
        <p>
          受信数: <output aria-label="受信数">{received()}</output>
        </p>
        <a href="/">一覧へ戻る</a>
      </main>
    </Layout>,
  )

  onMount(() => {
    memo(localStorage.getItem('incident-memo:' + incident.id) || '')
  })

  function saveMemo(event) {
    memo(event.currentTarget.value)
    localStorage.setItem('incident-memo:' + incident.id, event.currentTarget.value)
  }

  function resolve() {
    pending(true)
    failure('')
    fetch('/api/incidents/' + incident.id + '/resolve', { method: 'POST' })
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error('解決処理に失敗しました')),
      )
      .then((result) => {
        resolved(result.resolved)
        pending(false)
      })
      .catch((error) => {
        failure(error.message)
        pending(false)
      })
  }

  function observe(element) {
    const receive = () => received((previous) => previous + 1)
    window.addEventListener('incident-ping', receive)
    return {
      destroy() {
        window.removeEventListener('incident-ping', receive)
      },
    }
  }
}
