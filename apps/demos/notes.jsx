import { derived, onMount, render, signal } from 'irisout'
import { loadVerificationLogs, saveVerificationLogs } from './notes-storage.js'
import './notes.css'

export function NotesApp() {
  const logs = signal([])
  const statusFilter = signal('open')
  const query = signal('')
  const title = signal('')
  const reproduction = signal('')
  const expected = signal('')
  const actual = signal('')
  const status = signal('open')
  const editingId = signal(null)
  const message = signal('')
  const visibleLogs = derived(() =>
    logs().filter(
      (log) =>
        log.status === statusFilter() &&
        `${log.title}\n${log.reproduction}\n${log.expected}\n${log.actual}`
          .toLocaleLowerCase()
          .includes(query().trim().toLocaleLowerCase()),
    ),
  )

  render(
    <main class="project-notes">
      <header class="notes-heading">
        <p class="eyebrow">irisout 開発の記録</p>
        <h1>検証ログ</h1>
        <p>再現手順、期待する動作、実際の結果を記録します。</p>
      </header>

      <form class="note-form" onSubmit={saveLog}>
        <h2>{editingId() === null ? '検証を記録する' : '検証ログを編集'}</h2>
        <label>
          タイトル
          <input
            value={title()}
            onInput={(event) => title(event.currentTarget.value)}
            placeholder="例: 条件分岐内の一覧更新で表示が崩れる"
            required
          />
        </label>
        <label>
          再現内容（JSXまたは手順）
          <textarea
            value={reproduction()}
            onInput={(event) => reproduction(event.currentTarget.value)}
            placeholder="再現に使う最小のJSX、または操作手順"
            rows="5"
          />
        </label>
        <div class="result-fields">
          <label>
            期待する結果
            <textarea
              value={expected()}
              onInput={(event) => expected(event.currentTarget.value)}
              rows="3"
            />
          </label>
          <label>
            実際の結果
            <textarea
              value={actual()}
              onInput={(event) => actual(event.currentTarget.value)}
              rows="3"
            />
          </label>
        </div>
        <label class="status-field">
          状態
          <select value={status()} onChange={(event) => status(event.currentTarget.value)}>
            <option value="open">未解決</option>
            <option value="resolved">解決済み</option>
          </select>
        </label>
        <div class="form-actions">
          <button type="submit">{editingId() === null ? '保存する' : '変更を保存'}</button>
          {editingId() !== null ? (
            <button type="button" class="quiet-button" onClick={cancelEdit}>
              編集をやめる
            </button>
          ) : null}
        </div>
      </form>

      <section class="notes-section" aria-label="検証ログ一覧">
        <div class="list-heading">
          <nav class="tabs" aria-label="ログの状態">
            <button
              type="button"
              aria-pressed={statusFilter() === 'open'}
              class={statusFilter() === 'open' ? 'selected' : ''}
              onClick={() => statusFilter('open')}
            >
              未解決
            </button>
            <button
              type="button"
              aria-pressed={statusFilter() === 'resolved'}
              class={statusFilter() === 'resolved' ? 'selected' : ''}
              onClick={() => statusFilter('resolved')}
            >
              解決済み
            </button>
          </nav>
          <label class="search-label">
            <span>ログを検索</span>
            <input
              value={query()}
              onInput={(event) => query(event.currentTarget.value)}
              placeholder="タイトル・再現・期待・実際"
              type="search"
            />
          </label>
        </div>
        {visibleLogs().length ? (
          <ul class="note-list">
            {visibleLogs().map((log) => (
              <li key={log.id}>
                <article class="note-card">
                  <div class="card-heading">
                    <h3>{log.title}</h3>
                    <span class="status-badge">
                      {log.status === 'open' ? '未解決' : '解決済み'}
                    </span>
                  </div>
                  <section>
                    <h4>再現内容</h4>
                    <pre>{log.reproduction}</pre>
                  </section>
                  <div class="result-fields">
                    <section>
                      <h4>期待する結果</h4>
                      <p>{log.expected}</p>
                    </section>
                    <section>
                      <h4>実際の結果</h4>
                      <p>{log.actual}</p>
                    </section>
                  </div>
                  <div class="note-actions">
                    <button type="button" class="quiet-button" onClick={() => startEdit(log)}>
                      編集
                    </button>
                    <button type="button" class="quiet-button" onClick={() => toggleStatus(log)}>
                      {log.status === 'open' ? '解決済みにする' : '未解決に戻す'}
                    </button>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        ) : (
          <p class="empty-state">
            {query().trim()
              ? '一致する検証ログはありません。'
              : statusFilter() === 'open'
                ? '未解決の検証ログはありません。上のフォームから最初の記録を作成できます。'
                : '解決済みの検証ログはありません。'}
          </p>
        )}
      </section>
      {message() ? (
        <p class="note-message" role="status">
          {message()}
        </p>
      ) : null}
      <p class="storage-note">このブラウザーに保存されます。</p>
    </main>,
  )

  onMount(() => {
    const result = loadVerificationLogs()
    if (result.ok) {
      logs(result.value)
    } else {
      message('保存済みログを読み込めませんでした。入力内容はこの画面に保持されます。')
    }
  })

  function saveLog(event) {
    event.preventDefault()
    if (!title().trim()) {
      message('タイトルを入力してください。')
    } else {
      const currentId = editingId()
      const value = {
        id: currentId ?? Date.now(),
        title: title().trim(),
        reproduction: reproduction().trim(),
        expected: expected().trim(),
        actual: actual().trim(),
        status: status(),
      }
      const next =
        currentId === null
          ? [...logs(), value]
          : logs().map((log) => (log.id === currentId ? value : log))
      if (!saveVerificationLogs(next)) {
        message(
          '保存できませんでした。入力内容を残しています。ブラウザーの保存領域を確認して再度お試しください。',
        )
      } else {
        logs(next)
        clearForm()
        message('検証ログを保存しました。')
      }
    }
  }

  function startEdit(log) {
    editingId(log.id)
    title(log.title)
    reproduction(log.reproduction)
    expected(log.expected)
    actual(log.actual)
    status(log.status)
    message('')
  }

  function cancelEdit() {
    clearForm()
    message('')
  }

  function toggleStatus(log) {
    const next = logs().map((item) =>
      item.id === log.id ? { ...item, status: item.status === 'open' ? 'resolved' : 'open' } : item,
    )
    if (!saveVerificationLogs(next)) {
      message(
        '保存できませんでした。入力内容を残しています。ブラウザーの保存領域を確認して再度お試しください。',
      )
    } else {
      logs(next)
      message(log.status === 'open' ? '解決済み一覧に移動しました。' : '未解決一覧に戻しました。')
    }
  }

  function clearForm() {
    editingId(null)
    title('')
    reproduction('')
    expected('')
    actual('')
    status('open')
  }
}
