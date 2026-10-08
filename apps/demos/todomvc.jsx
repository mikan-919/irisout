// 構造ユニットの実DOM回帰検証にも使うTodoMVC入力。手書きの比較出力は
// apps/demos/todomvc.handwritten.js を参照。
//
// 実装済み: リスト・条件分岐(M5)、任意の深さの構造ユニット
// (M5.5、change `m5-5-nested-structural-units`)、要素・構造unit内の`use=`属性
// (ADR-0011/0022、change `structural-unit-use-actions`)、同一ファイル内の複数コンポーネント
// 合成・ローカルsignal(ADR-0014、change `same-file-component-composition`)。
//
// 構造ユニットは親要素の兄弟と共存できるコメント範囲として生成される。
// TodoAppの条件分岐→リストはこの範囲を使う。TodoItemは単純な行として生成する。

import { derived, render, signal } from 'irisout'

/**
 * @typedef {object} Todo
 * @property {number} id
 * @property {string} text
 * @property {boolean} completed
 */

/**
 * @typedef {object} TodoItemProps
 * @property {Todo} todo
 */

/** @typedef {HTMLInputElement & { __todoSpan?: HTMLSpanElement }} TodoEditInput */

export function TodoApp() {
  // ── 変数ゾーン: const のみ(signal/derived) ──
  const todos = signal([
    { id: 1, text: 'irisout を書く', completed: false },
    { id: 2, text: '牛乳を買う', completed: true },
  ])

  const filter = signal('all') // 'all' | 'active' | 'completed'

  const visibleTodos = derived(() =>
    filter() === 'active'
      ? todos().filter((t) => !t.completed)
      : filter() === 'completed'
        ? todos().filter((t) => t.completed)
        : todos(),
  )

  const activeCount = derived(() => todos().filter((t) => !t.completed).length)

  // ── UIゾーン: render() 文(returnではない) ──
  render(
    <div class="todoapp">
      <input
        use={setupNewTodoInput}
        onKeyDown={handleInputKeyDown}
        placeholder="What needs to be done?"
      />

      {visibleTodos().length > 0 && (
        <ul
          class="todo-list"
          onChange={handleTodoChange}
          onClick={handleTodoClick}
          onDblClick={handleTodoDoubleClick}
          onKeyDown={handleTodoKeyDown}
          onFocusOut={handleTodoFocusOut}
        >
          {visibleTodos().map((todo) => (
            <TodoItem key={todo.id} todo={todo} />
          ))}
        </ul>
      )}

      <span>{activeCount()} items left</span>

      <div class="filters">
        <button type="button" onClick={() => setFilter('all')}>
          All
        </button>
        <button type="button" onClick={() => setFilter('active')}>
          Active
        </button>
        <button type="button" onClick={() => setFilter('completed')}>
          Completed
        </button>
      </div>
    </div>,
  )

  // ── 動きゾーン: function宣言とhooksのみ ──

  // `use=`の引数はマウント時の入力要素で、フォーカスに使う。
  function setupNewTodoInput(input) {
    input.focus()
  }

  // currentTargetは処理関数を直接登録した入力要素として型付けされる。
  /** @param {IrisElementEvent<KeyboardEvent, HTMLInputElement>} e */
  function handleInputKeyDown(e) {
    if (e.key !== 'Enter') return
    const text = e.currentTarget.value.trim()
    if (text === '') return
    todos([...todos(), { id: Date.now(), text, completed: false }])
    e.currentTarget.value = ''
  }

  function toggleTodo(id) {
    todos(todos().map((t) => (t.id === id ? { ...t, completed: !t.completed } : t)))
  }

  function removeTodo(id) {
    todos(todos().filter((t) => t.id !== id))
  }

  /** @param {IrisElementEvent<Event, HTMLUListElement>} e */
  function handleTodoChange(e) {
    const target = /** @type {HTMLInputElement | null} */ (e.target)
    if (!target || target.tagName !== 'INPUT' || target.type !== 'checkbox') return
    const item = target.closest('[data-todo-id]')
    const id = item ? Number(item.getAttribute('data-todo-id')) : null
    if (id != null) toggleTodo(id)
  }

  /** @param {IrisElementEvent<MouseEvent, HTMLUListElement>} e */
  function handleTodoClick(e) {
    const target = /** @type {Element | null} */ (e.target)
    if (!target || typeof target.closest !== 'function') return
    if (!target.closest('button[data-todo-action="remove"]')) return
    const item = target.closest('[data-todo-id]')
    const id = item ? Number(item.getAttribute('data-todo-id')) : null
    if (id != null) removeTodo(id)
  }

  /** @param {IrisElementEvent<MouseEvent, HTMLUListElement>} e */
  function handleTodoDoubleClick(e) {
    const target = /** @type {Element | null} */ (e.target)
    if (
      !target ||
      typeof target.closest !== 'function' ||
      !target.closest('[data-todo-action="edit"]')
    )
      return
    const span = /** @type {HTMLSpanElement | null} */ (
      target.closest('span[data-todo-action="edit"]')
    )
    if (!span) return
    /** @type {TodoEditInput} */
    const input = span.ownerDocument.createElement('input')
    input.value = span.textContent ?? ''
    // compilerが更新するspanを退避し、確定後に同じノードを戻す。
    input.__todoSpan = span
    span.closest('[data-todo-id]')?.classList.add('editing')
    span.replaceWith(input)
  }

  /** @param {IrisElementEvent<KeyboardEvent, HTMLUListElement>} e */
  function handleTodoKeyDown(e) {
    const input = /** @type {TodoEditInput | null} */ (e.target)
    if (!input || input.tagName !== 'INPUT') return
    if (e.key === 'Enter' && input.__todoSpan) {
      finishTodoEdit(input)
    }
  }

  /** @param {IrisElementEvent<FocusEvent, HTMLUListElement>} e */
  function handleTodoFocusOut(e) {
    const input = /** @type {TodoEditInput | null} */ (e.target)
    if (!input || input.tagName !== 'INPUT') return
    if (!input.__todoSpan) return
    finishTodoEdit(input)
  }

  function finishTodoEdit(input) {
    const span = input.__todoSpan
    if (!span) return
    delete input.__todoSpan
    const item = input.closest('[data-todo-id]')
    const id = item ? Number(item.getAttribute('data-todo-id')) : null
    if (id != null) commitEdit(id, input.value)
    input.replaceWith(span)
    item?.classList.remove('editing')
  }

  function setFilter(next) {
    filter(next)
  }

  function commitEdit(id, text) {
    const t = text.trim()
    if (t !== '') todos(todos().map((x) => (x.id === id ? { ...x, text: t } : x)))
  }
}

// same-file-component-composition(ADR-0014)で切り出したリストアイテム。
/** @param {TodoItemProps} props */
function TodoItem({ todo }) {
  render(
    <li key={todo.id} data-todo-id={todo.id} class={todo.completed ? 'completed' : ''}>
      <input type="checkbox" checked={todo.completed} />
      <span data-todo-action="edit">{todo.text}</span>
      <button type="button" data-todo-action="remove">
        x
      </button>
    </li>,
  )
}
