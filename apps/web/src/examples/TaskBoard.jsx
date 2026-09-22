// signal、derived、key付き一覧を一画面で試せるタスク管理例。
// 永続化は持たず、入力・絞り込み・更新・削除・並べ替えに範囲を限定する。
import { derived, render, signal } from 'irisout'
import { SiteHeader } from '../SiteHeader.jsx'

export function TaskBoard() {
  const tasks = signal([
    { id: 1, title: '公開APIを確認する', done: true },
    { id: 2, title: '実ブラウザーで操作する', done: false },
    { id: 3, title: '変更内容を記録する', done: false },
  ])
  const draft = signal('')
  const filter = signal('all')
  const nextId = signal(4)
  const visibleTasks = derived(() =>
    tasks().filter((task) => filter() === 'all' || task.done === (filter() === 'done')),
  )
  const remaining = derived(() => tasks().filter((task) => !task.done).length)

  render(
    <div>
      <SiteHeader current="examples" search={false} onSearch={null} />
      <main class="task-page">
        <a class="back-link" href="/examples">
          ← 実例一覧
        </a>
        <section class="task-app" aria-labelledby="task-title">
          <header class="task-header">
            <div>
              <p>STATE EXAMPLE</p>
              <h1 id="task-title">Task Board</h1>
            </div>
            <output aria-label="未完了の件数">{remaining()} open</output>
          </header>

          <div class="task-input">
            <label for="new-task">新しいタスク</label>
            <div>
              <input
                id="new-task"
                type="text"
                value={draft()}
                placeholder="次にやること"
                onInput={(event) => draft(event.currentTarget.value)}
              />
              <button type="button" disabled={!draft().trim()} onClick={addTask}>
                追加
              </button>
            </div>
          </div>

          <div class="task-toolbar">
            <div class="filters" aria-label="表示するタスク">
              <button type="button" aria-pressed={filter() === 'all'} onClick={() => filter('all')}>
                すべて
              </button>
              <button
                type="button"
                aria-pressed={filter() === 'open'}
                onClick={() => filter('open')}
              >
                未完了
              </button>
              <button
                type="button"
                aria-pressed={filter() === 'done'}
                onClick={() => filter('done')}
              >
                完了
              </button>
            </div>
            <button
              class="reverse"
              type="button"
              onClick={() => tasks((items) => [...items].reverse())}
            >
              順序を反転
            </button>
          </div>

          <div class="task-list-wrap">
            {visibleTasks().length ? (
              <ul class="task-list">
                {visibleTasks().map((task) => (
                  <li class={task.done ? 'task is-done' : 'task'} key={task.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={task.done}
                        onChange={() => toggleTask(task.id)}
                      />
                      <span>{task.title}</span>
                    </label>
                    <button
                      class="remove"
                      type="button"
                      aria-label={`${task.title}を削除`}
                      onClick={() => removeTask(task.id)}
                    >
                      削除
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p class="empty">該当するタスクはありません。</p>
            )}
          </div>

          <footer>
            <span>signal × derived × keyed list</span>
            <span>{tasks().length} tasks</span>
          </footer>
        </section>
      </main>
    </div>,
  )

  function addTask() {
    const title = draft().trim()
    if (!title) return
    tasks((items) => [...items, { id: nextId(), title, done: false }])
    nextId(nextId() + 1)
    draft('')
  }

  function toggleTask(id) {
    tasks((items) => items.map((task) => (task.id === id ? { ...task, done: !task.done } : task)))
  }

  function removeTask(id) {
    tasks((items) => items.filter((task) => task.id !== id))
  }
}
