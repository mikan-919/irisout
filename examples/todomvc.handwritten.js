// ADR-0005(factory-per-unitクロージャ)に従って人間が書いた、
// examples/todomvc.jsx の「あるべき」コンパイル後の姿(手書き試作)。
// M5 codegenの目標出力であり、このファイル自体はコンパイラの出力ではない。
// ランタイム(src/runtime.tsのmount/hydrate)は使わず、素のDOM APIのみで
// 書く(生成コードの現在の形はsrc/codegen.ts:67-79参照)。
//
// mountComponent()は本来アプリ起動時に1度だけ呼ばれる前提(ADR-0005)だが、
// テスト(test/todomvc-handwritten.test.ts)から複数回呼ばれるため、
// 呼び出しのたびにモジュール状態を初期化し直す。

let todos
let filter // 'all' | 'active' | 'completed'

let doc
let inputEl
let listEl
let countEl
let itemTemplate

// key(todo.id) -> factoryが返したハンドル。フィルタで一時的にリストから
// 外れているだけのアイテムもここには残り続ける(下のupdate_todos内の注記参照)。
let itemHandles

// initialTodosは省略可(省略時は既存の固定2件)。bench/todomvc-vs-react.ts
// がN件の初期マウントを計測するために追加した唯一の変更点で、keyed reuse
// の仕組み自体(update_todos/createTodoItem)には手を入れていない。
const defaultTodos = [
  { id: 1, text: 'irisout を書く', completed: false },
  { id: 2, text: '牛乳を買う', completed: true },
]

export function mountComponent(container, initialTodos = defaultTodos) {
  doc = container.ownerDocument
  todos = initialTodos
  filter = 'all'
  itemHandles = new Map()

  itemTemplate = doc.createElement('template')
  itemTemplate.innerHTML =
    '<li><input type="checkbox"><span></span><button>x</button></li>'

  container.innerHTML = `
    <div class="todoapp">
      <input placeholder="What needs to be done?">
      <ul class="todo-list"></ul>
      <span></span>
      <div class="filters">
        <button data-filter="all">All</button>
        <button data-filter="active">Active</button>
        <button data-filter="completed">Completed</button>
      </div>
    </div>
  `

  inputEl = container.querySelector('input')
  listEl = container.querySelector('.todo-list')
  countEl = container.querySelector('.todoapp > span')

  inputEl.addEventListener('keydown', handleInputKeyDown)
  for (const name of ['all', 'active', 'completed']) {
    container
      .querySelector(`[data-filter="${name}"]`)
      .addEventListener('click', () => setFilter(name))
  }

  update_todos()
  update_count()
}

function handleInputKeyDown(e) {
  if (e.key !== 'Enter') return
  const text = inputEl.value.trim()
  if (text === '') return
  todos = [...todos, { id: Date.now(), text, completed: false }]
  inputEl.value = ''
  update_todos()
  update_count()
}

function setFilter(next) {
  filter = next
  update_todos()
}

function visibleTodos() {
  if (filter === 'active') return todos.filter((t) => !t.completed)
  if (filter === 'completed') return todos.filter((t) => t.completed)
  return todos
}

// (06解消済み・M5.5) 空リスト時に<ul>自体を出さない条件分岐(条件分岐の
// 中にリストがネストする形)は、change `m5-5-nested-structural-units` で
// 生成器側が実DOM着脱(<template>+factory closureの再帰適用)として解決
// した。この手書き版は「手で書くには着脱の配線が手間すぎる」ための
// hiddenプロパティ妥協を意図的な人力実装の参考としてそのまま残す ―
// 生成コードの目標出力とはこの点で一致しない。
function update_todos() {
  const visible = visibleTodos()
  listEl.hidden = visible.length === 0

  // UNRESOLVED(05): フィルタで一時的にリストから外れるだけのアイテムを
  // 「削除」と区別する設計をADR-0005は規定していない。素直に
  // visibleTodos()だけをkeyed reuseの対象にすると、フィルタで隠れた
  // 瞬間にhandleがMapから落ちてローカル状態(editingなど)が失われる。
  // ここでは「todos配列からの削除」でのみhandleを破棄し、フィルタでの
  // 非表示はDOMからの着脱のみで対応する(状態保持を優先する回避策)。
  //
  // 除去判定は src/codegen.ts の generateListUpdate() と同じ __seen__ Set
  // パターンを使う(以前は`todos.some()`でO(N)走査 x Mapエントリ数でO(N^2)
  // になっていたが、実際のcodegen出力とずれていたfixtureのバグだった)。
  const seen = new Set()
  for (const todo of todos) {
    seen.add(todo.id)
    let handle = itemHandles.get(todo.id)
    if (!handle) {
      handle = createTodoItem(todo)
      itemHandles.set(todo.id, handle)
    }
    handle.update(todo)
  }
  for (const [id, handle] of itemHandles) {
    if (!seen.has(id)) {
      handle.el.remove()
      itemHandles.delete(id)
    }
  }

  const visibleIds = new Set(visible.map((t) => t.id))
  for (const todo of todos) {
    const handle = itemHandles.get(todo.id)
    if (visibleIds.has(todo.id)) {
      listEl.appendChild(handle.el) // 既存ノードの再appendは移動として働く
    } else {
      handle.el.remove() // Mapからは消さない(状態は保持したまま非表示)
    }
  }
}

function createTodoItem(todo) {
  const node = itemTemplate.content.cloneNode(true)
  const el = node.querySelector('li')
  const checkbox = el.querySelector('input')
  const textSpan = el.querySelector('span')
  const removeBtn = el.querySelector('button')

  let editing = false // このアイテム専用のローカル状態(素の変数)
  let editInput = null

  checkbox.addEventListener('change', () => toggleTodo(todo.id))
  removeBtn.addEventListener('click', () => removeTodo(todo.id))
  textSpan.addEventListener('dblclick', () => {
    editing = true
    renderEditState()
    editInput.focus()
  })

  // (07解消済み・M5.5) 編集モード(span<->inputの入れ替え)は、change
  // `m5-5-nested-structural-units` で生成器側がアイテム内のネストした
  // 条件分岐ユニット(factory closureの再帰適用、実DOM着脱)として解決
  // した。この手書き版はinput要素を都度生成してdisplay切り替えで済ませる
  // 妥協を意図的な人力実装の参考としてそのまま残す ― 生成コードの目標
  // 出力とはこの点で一致しない。
  function renderEditState() {
    if (editing) {
      if (!editInput) {
        // UNRESOLVED(08): 編集中テキストの下書きをどこに保持するかは
        // 未規定。専用のstateは持たず、編集開始時に一度だけ
        // todo.textを書き込んだinput要素自身のvalueをsource of truth
        // とする(以後の再renderでは上書きしない。読み出しは
        // commitEdit内でeditInput.valueを直接読む)。
        editInput = doc.createElement('input')
        editInput.value = todo.text
        editInput.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return
          commitEdit()
        })
        editInput.addEventListener('blur', commitEdit)
        el.insertBefore(editInput, textSpan)
      }
      textSpan.style.display = 'none'
      editInput.style.display = ''
    } else {
      textSpan.style.display = ''
      if (editInput) editInput.style.display = 'none'
    }
  }

  function commitEdit() {
    if (!editing) return
    const text = editInput.value.trim()
    if (text !== '') {
      todos = todos.map((t) => (t.id === todo.id ? { ...t, text } : t))
    }
    editing = false
    renderEditState()
    update_todos()
  }

  function update(nextTodo) {
    todo = nextTodo
    checkbox.checked = todo.completed
    el.classList.toggle('completed', todo.completed)
    textSpan.textContent = todo.text
    renderEditState()
  }

  return { el, update }
}

function toggleTodo(id) {
  todos = todos.map((t) =>
    t.id === id ? { ...t, completed: !t.completed } : t,
  )
  update_todos()
  update_count()
}

function removeTodo(id) {
  todos = todos.filter((t) => t.id !== id)
  update_todos()
  update_count()
}

function update_count() {
  const activeCount = todos.filter((t) => !t.completed).length
  countEl.textContent = `${activeCount} items left`
}
