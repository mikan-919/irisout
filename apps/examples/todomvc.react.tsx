// apps/examples/todomvc.handwritten.js と同一機能(追加・完了トグル・削除・
// フィルタ切り替え・編集)を持つ、素朴な標準React実装。
// packages/bench/todomvc-vs-react.ts から比較対象としてマウントされる。
// key付きリスト・useStateのみを使い、意図的な最適化・劣化は行わない。

import { useState } from 'react'

interface Todo {
  id: number
  text: string
  completed: boolean
}

type Filter = 'all' | 'active' | 'completed'

function visibleTodos(todos: Todo[], filter: Filter): Todo[] {
  if (filter === 'active') return todos.filter((t) => !t.completed)
  if (filter === 'completed') return todos.filter((t) => t.completed)
  return todos
}

export function TodoApp({ initialTodos }: { initialTodos: Todo[] }) {
  const [todos, setTodos] = useState<Todo[]>(initialTodos)
  const [filter, setFilter] = useState<Filter>('all')
  const [inputValue, setInputValue] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)

  const activeCount = todos.filter((t) => !t.completed).length

  function addTodo(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    const text = inputValue.trim()
    if (text === '') return
    setTodos([...todos, { id: Date.now(), text, completed: false }])
    setInputValue('')
  }

  function toggleTodo(id: number) {
    setTodos(todos.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t)))
  }

  function removeTodo(id: number) {
    setTodos(todos.filter((t) => t.id !== id))
  }

  function commitEdit(id: number, text: string) {
    const trimmed = text.trim()
    if (trimmed !== '') {
      setTodos(todos.map((t) => (t.id === id ? { ...t, text: trimmed } : t)))
    }
    setEditingId(null)
  }

  const visible = visibleTodos(todos, filter)

  return (
    <div className="todoapp">
      <input
        placeholder="What needs to be done?"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={addTodo}
      />
      <ul className="todo-list" hidden={visible.length === 0}>
        {visible.map((todo) => (
          <li key={todo.id} className={todo.completed ? 'completed' : ''}>
            <input type="checkbox" checked={todo.completed} onChange={() => toggleTodo(todo.id)} />
            {editingId === todo.id ? (
              <input
                defaultValue={todo.text}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  commitEdit(todo.id, (e.target as HTMLInputElement).value)
                }}
                onBlur={(e) => commitEdit(todo.id, e.target.value)}
              />
            ) : (
              <button type="button" onDoubleClick={() => setEditingId(todo.id)}>
                {todo.text}
              </button>
            )}
            <button type="button" onClick={() => removeTodo(todo.id)}>
              x
            </button>
          </li>
        ))}
      </ul>
      <span>{activeCount} items left</span>
      <div className="filters">
        <button type="button" data-filter="all" onClick={() => setFilter('all')}>
          All
        </button>
        <button type="button" data-filter="active" onClick={() => setFilter('active')}>
          Active
        </button>
        <button type="button" data-filter="completed" onClick={() => setFilter('completed')}>
          Completed
        </button>
      </div>
    </div>
  )
}
