// apps/demos/todomvc.handwritten.js と同一機能(追加・完了トグル・削除・
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

  function todoIdFromTarget(target: EventTarget): number | null {
    const element = target as Element | null
    if (!element || typeof element.closest !== 'function') return null
    const item = element.closest('[data-todo-id]')
    return item ? Number(item.getAttribute('data-todo-id')) : null
  }

  function handleListChange(e: React.ChangeEvent<HTMLUListElement>) {
    const target = e.target as unknown as HTMLInputElement | null
    if (!target || target.tagName !== 'INPUT' || target.type !== 'checkbox') return
    const id = todoIdFromTarget(target)
    if (id != null) toggleTodo(id)
  }

  function handleListClick(e: React.MouseEvent<HTMLUListElement>) {
    const target = e.target as Element | null
    if (!target || typeof target.closest !== 'function') return
    if (!target.closest('button[data-todo-action="remove"]')) return
    const id = todoIdFromTarget(target)
    if (id != null) removeTodo(id)
  }

  function handleListDoubleClick(e: React.MouseEvent<HTMLUListElement>) {
    const target = e.target as Element | null
    if (
      !target ||
      typeof target.closest !== 'function' ||
      !target.closest('[data-todo-action="edit"]')
    )
      return
    const id = todoIdFromTarget(target)
    if (id != null) setEditingId(id)
  }

  function handleListKeyDown(e: React.KeyboardEvent<HTMLUListElement>) {
    const target = e.target as unknown as HTMLInputElement | null
    if (e.key !== 'Enter' || !target || target.tagName !== 'INPUT') return
    const id = todoIdFromTarget(target)
    if (id != null) commitEdit(id, target.value)
  }

  function handleListBlur(e: React.FocusEvent<HTMLUListElement>) {
    const target = e.target as unknown as HTMLInputElement | null
    if (!target || target.tagName !== 'INPUT') return
    const id = todoIdFromTarget(target)
    if (id != null) commitEdit(id, target.value)
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
      <ul
        className="todo-list"
        hidden={visible.length === 0}
        onChange={handleListChange}
        onClick={handleListClick}
        onDoubleClick={handleListDoubleClick}
        onKeyDown={handleListKeyDown}
        onBlur={handleListBlur}
      >
        {visible.map((todo) => (
          <li key={todo.id} data-todo-id={todo.id} className={todo.completed ? 'completed' : ''}>
            <input type="checkbox" checked={todo.completed} />
            {editingId === todo.id ? (
              <input defaultValue={todo.text} />
            ) : (
              <button type="button" data-todo-action="edit">
                {todo.text}
              </button>
            )}
            <button type="button" data-todo-action="remove">
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
