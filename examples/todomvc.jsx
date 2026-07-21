// このファイルは現行コンパイラではコンパイルできない仕様フィクスチャであり、
// ADR-0008(ゾーン構造のauthoring API)以降の実装マイルストーンの目標入力
// である。手書きの目標出力は examples/todomvc.handwritten.js を参照。
//
// 実装済み: 1階層のリスト・条件分岐(M5)、ネストした構造ユニット =
// UNRESOLVED-06/07(M5.5、change `m5-5-nested-structural-units`)、
// `use=`属性 = UNRESOLVED-01(ADR-0011、change `use-action-impl`)。
// 下記の `{visibleTodos().length > 0 && (<ul>...)}`(06: 条件分岐の中の
// リスト)と、編集モードのspan/input切り替え(07: リストアイテムの中の
// 条件分岐)は実際にコンパイルできる形になっている。
//
// フィクスチャ全体のコンパイルを今も妨げているのは、ハンドラ以外の動的
// (式コンテナ)属性値(UNRESOLVED-02/03)。既知のスコープ外なので
// 個別の注記は付けない。

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
  // (M5.5の判断) 07のネスト条件分岐で編集UI自体は書けるようになったが、
  // この04(アイテムごとの状態を書く構文)は解消しない ― 引き続き
  // スコープ外。editingIdの暫定代用もそのまま。
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
              {/* UNRESOLVED(02) 解消済み(ADR-0012、change
                  dynamic-attribute-bindings): 動的class は setAttribute
                  反映の動的属性バインディングとして書ける。 */}
              <input
                type='checkbox'
                checked={todo.completed}
                onChange={() => toggleTodo(todo.id)}
              />
              {/* UNRESOLVED(03) 解消済み(ADR-0012): checked は固定表により
                  DOMプロパティとして都度反映される(初期HTMLはpresence)。 */}
              {/* M5.5(UNRESOLVED-07解消): 編集モードのspan/input切り替えは、
                  リストアイテム内にネストした条件分岐ユニット(1階層ネスト)
                  として書ける。構造ユニットは親要素の唯一の子でなければ
                  ならない(M5のsole-child制約)ため、専用のdivで包む。 */}
              {/* UNRESOLVED(08): 編集中テキストの下書き保持先は未規定のまま
                  (07では解消しない)。ここではinput要素自身のvalueをsource
                  of truthとし、確定はEnterでe.target.value経由に寄せる。
                  編集開始時のtodo.textのプリフィル(value={todo.text})は
                  ADR-0012 の value プロパティバインディングで書けるように
                  なった(下書きの保持先そのものは未規定のまま)。 */}
              <div>
                {editingId() === todo.id ? (
                  <input
                    onKeyDown={(e) =>
                      e.key === 'Enter' && commitEdit(todo.id, e.target.value)
                    }
                  />
                ) : (
                  /* biome-ignore lint/a11y/noStaticElementInteractions: フィクスチャなのでa11y対応はスコープ外 */
                  <span onDblClick={() => startEditing(todo.id)}>
                    {todo.text}
                  </span>
                )}
              </div>
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

  function commitEdit(id, text) {
    const t = text.trim()
    if (t !== '') {
      todos(todos().map((x) => (x.id === id ? { ...x, text: t } : x)))
    }
    editingId(null)
  }
}
