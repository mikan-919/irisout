// 構造ユニットの実DOM回帰検証にも使うTodoMVC入力。手書きの比較出力は
// apps/examples/todomvc.handwritten.js を参照。
//
// 実装済み: リスト・条件分岐(M5)、任意の深さの構造ユニット
// (M5.5、change `m5-5-nested-structural-units`)、要素・構造unit内の`use=`属性
// (ADR-0011/0022、change `structural-unit-use-actions`)、同一ファイル内の複数コンポーネント
// 合成・ローカルsignal(ADR-0014、change `same-file-component-composition`)。
//
// 構造ユニットは親要素の兄弟と共存できるコメント範囲として生成される。
// TodoAppの条件分岐→リストとTodoItemのローカル編集条件はこの範囲を使う。

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
        <ul class="todo-list">
          {visibleTodos().map((todo) => (
            <TodoItem
              key={todo.id}
              todo={todo}
              onToggle={() => toggleTodo(todo.id)}
              onCommitEdit={(e) => e.key === 'Enter' && commitEdit(todo.id, e.target.value)}
              onRemove={() => removeTodo(todo.id)}
            />
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

  // イベント引数のtargetはブラウザの入力要素を指す。
  function handleInputKeyDown(e) {
    if (e.key !== 'Enter') return
    const text = e.target.value.trim()
    if (text === '') return
    todos([...todos(), { id: Date.now(), text, completed: false }])
    e.target.value = ''
  }

  function toggleTodo(id) {
    todos(todos().map((t) => (t.id === id ? { ...t, completed: !t.completed } : t)))
  }

  function removeTodo(id) {
    todos(todos().filter((t) => t.id !== id))
  }

  function setFilter(next) {
    filter(next)
  }

  function commitEdit(id, text) {
    const t = text.trim()
    if (t !== '') {
      todos(todos().map((x) => (x.id === id ? { ...x, text: t } : x)))
    }
  }
}

// same-file-component-composition(ADR-0014)で切り出したリストアイテム。
// `editing`はfactoryクロージャ専有の局所状態になり、アイテムごとに独立する。
function TodoItem({ todo, onToggle, onCommitEdit, onRemove }) {
  const editing = signal(false)

  render(
    <li key={todo.id} class={`${todo.completed ? 'completed' : ''} ${editing() ? 'editing' : ''}`}>
      <input type="checkbox" checked={todo.completed} onChange={onToggle} />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: フィクスチャなのでa11y対応はスコープ外 */}
      {editing() ? (
        <input
          value={todo.text}
          onKeyDown={(e) => {
            onCommitEdit(e)
            if ('key' in e && typeof e.key === 'string' && e.key === 'Enter') editing(false)
          }}
          onBlur={() => editing(false)}
        />
      ) : (
        <span onDblClick={() => editing(true)}>{todo.text}</span>
      )}
      <button type="button" onClick={onRemove}>
        x
      </button>
    </li>,
  )
}
