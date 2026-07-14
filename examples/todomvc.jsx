// このファイルは現行コンパイラではコンパイルできない仕様フィクスチャであり、
// ADR-0008(ゾーン構造のauthoring API)/ M5(list・conditionalのfactory
// closure)実装の目標入力である。手書きの目標出力は
// examples/todomvc.handwritten.js を参照。
//
// M5(change `m5-list-conditional-factory-closures`)で1階層のリスト・
// 条件分岐は実装済みだが、このフィクスチャ全体は今もコンパイルできない。
// 現行コンパイラの制約として意図的に踏み越えているもの(既知のスコープ外
// なので個別の注記は付けない): `use=`属性(UNRESOLVED-01、設計は
// ADR-0011で決定済みだが未実装)、ハンドラ以外の動的(式コンテナ)属性値
// (UNRESOLVED-02/03)。
//
// UNRESOLVED(06)/(07): M5本体では対応せず、follow-up change(M5.5相当、
// design.mdのDecision 1参照)で扱う。下記の
// `{visibleTodos().length > 0 && (<ul>...)}` は条件分岐ブランチの中に
// リスト(`.map()`)がネストする06のケースそのもので、compile error
// (scope limit)になる。07(編集モードのspan/input入れ替え)は
// UNRESOLVED-04と合わせて、対応する編集UI自体をこのフィクスチャに
// まだ書いていない。

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

  // UNRESOLVED(04): アイテムごとのローカル編集状態(ダブルクリックで
  // 編集開始)をauthoring APIでどう表現するかが未決定。ADR-0005は
  // 生成コード側(factory関数内の素のローカル変数)までしか規定して
  // おらず、authored JSX側で「このアイテムだけの状態」を書く構文がない。
  // ここではコンポーネント全体で1つのsignal(editingId、編集中のtodo id
  // またはnull)を暫定的に代用する。TodoMVCは同時に1件しか編集できない
  // UIなので偶然動くが、複数アイテムが独立に状態を持つ一般形には
  // 拡張できない暫定策である。ゾーン配置規則(constは変数ゾーン)は
  // ADR-0008の決定なので、暫定扱いにせずここに置く。
  const editingId = signal(null)

  // ── UIゾーン: render() 文(returnではない) ──
  render(
    <div class='todoapp'>
      <input
        use={setupNewTodoInput}
        onKeyDown={handleInputKeyDown}
        placeholder='What needs to be done?'
      />

      {visibleTodos().length > 0 && (
        <ul class='todo-list'>
          {visibleTodos().map((todo) => (
            <li key={todo.id} class={todo.completed ? 'completed' : ''}>
              {/* UNRESOLVED(02): 完了時のclass付与は、値によって文字列が
                  変わる動的属性。M4は静的host属性のみが対象で、この
                  ケースは未計画のパリティ穴(ロードマップ「次のアクション」
                  にも記載がない)。M4後続で新規に計画が要る。 */}
              <input
                type='checkbox'
                checked={todo.completed}
                onChange={() => toggleTodo(todo.id)}
              />
              {/* UNRESOLVED(03): checkbox のchecked状態はattributeとして
                  一度書き込むだけでは以後の変更が反映されない(DOM
                  プロパティとして都度反映する必要がある)。属性値の
                  attribute/property使い分けの方針が未計画。 */}
              {/* biome-ignore lint/a11y/noStaticElementInteractions: フィクスチャなのでa11y対応はスコープ外 */}
              <span onDblClick={() => startEditing(todo.id)}>{todo.text}</span>
              <button type='button' onClick={() => removeTodo(todo.id)}>
                x
              </button>
            </li>
          ))}
        </ul>
      )}

      <span>{activeCount()} items left</span>

      <div class='filters'>
        <button type='button' onClick={() => setFilter('all')}>
          All
        </button>
        <button type='button' onClick={() => setFilter('active')}>
          Active
        </button>
        <button type='button' onClick={() => setFilter('completed')}>
          Completed
        </button>
      </div>
    </div>,
  )

  // ── 動きゾーン: function宣言とhooksのみ ──

  // UNRESOLVED(01): `use=`属性の設計はADR-0011で決定済み(ref primitiveは
  // 作らず、要素はaction関数の引数としてのみ到着する)。用途はマウント時の
  // フォーカスのみ(値の読み取り・クリアはイベント引数側 e.target 経由に
  // 寄せる、下のhandleInputKeyDown参照)。コンパイラ実装は別change。
  function setupNewTodoInput(input) {
    input.focus()
  }

  // UNRESOLVED(09): e.target.value が効くにはe.targetがHTMLInputElement
  // だと分かっている必要がある。イベントオブジェクトの型付け(addEventListener
  // ネイティブの生の`Event`型のままか、要素種別に応じて絞り込むか)は
  // Plan 004(イベント引数)側の未規定点。ここではJSの動的型付けに乗って
  // 素朴にe.target.valueへアクセスする。
  function handleInputKeyDown(e) {
    if (e.key !== 'Enter') return
    const text = e.target.value.trim()
    if (text === '') return
    todos([...todos(), { id: Date.now(), text, completed: false }])
    e.target.value = ''
  }

  function toggleTodo(id) {
    todos(
      todos().map((t) => (t.id === id ? { ...t, completed: !t.completed } : t)),
    )
  }

  function removeTodo(id) {
    todos(todos().filter((t) => t.id !== id))
  }

  function setFilter(next) {
    filter(next)
  }

  function startEditing(id) {
    editingId(id)
  }
}
