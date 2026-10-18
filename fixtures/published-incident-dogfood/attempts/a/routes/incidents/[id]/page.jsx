import { onMount, render, signal } from 'irisout'
import { Layout } from '../../../Layout.jsx'

export function IncidentDetail({ id, title, resolved }) {
  const done = signal(resolved)
  const memo = signal('')
  const pings = signal(0)
  const notice = signal('')

  render(
    <Layout title={title}>
      <main>
        <h1>{title}</h1>
        <p>{done() ? '解決済み' : '未解決'}</p>
        <button type="button" onClick={resolve}>
          解決する
        </button>
        <p role="status">{notice()}</p>
        <label>
          作業メモ
          <textarea value={memo()} onInput={saveMemo} />
        </label>
        <p use={observe}>監視中</p>
        <p>
          受信数: <output>{pings()}</output>
        </p>
        <a href="/">一覧へ戻る</a>
      </main>
    </Layout>,
  )

  onMount(() => {
    memo(localStorage.getItem('incident-note:' + id) || '')
  })

  function saveMemo(event) {
    memo(event.currentTarget.value)
    localStorage.setItem('incident-note:' + id, memo())
  }

  async function resolve() {
    const response = await fetch('/api/incidents/' + id + '/resolve', { method: 'POST' })
    if (response.ok) {
      done(true)
      notice('更新しました')
    } else {
      notice('更新に失敗しました')
    }
  }

  function observe(element) {
    const receive = () => {
      pings(pings() + 1)
    }
    window.addEventListener('incident-ping', receive)
    return {
      destroy() {
        window.removeEventListener('incident-ping', receive)
      },
    }
  }
}
