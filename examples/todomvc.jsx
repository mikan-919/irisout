// このファイルは現行コンパイラではコンパイルできない仕様フィクスチャであり、
// ADR-0008(ゾーン構造のauthoring API)以降の実装マイルストーンの目標入力
// である。手書きの目標出力は examples/todomvc.handwritten.js を参照。
//
// 実装済み: 1階層のリスト・条件分岐(M5)、ネストした構造ユニット =
// UNRESOLVED-06/07(M5.5、change `m5-5-nested-structural-units`)、
// `use=`属性 = UNRESOLVED-01(ADR-0011、change `use-action-impl`)、
// 同一ファイル内の複数コンポーネント合成・ローカルsignal = UNRESOLVED-04
// (ADR-0014、change `same-file-component-composition`)。
//
// このフィクスチャ全体のコンパイルを今も妨げているのは同一ファイル内合成と
// 無関係な既存のscope limit: `{visibleTodos().length > 0 && (<ul>...)}`が
// `<div class='todoapp'>`のsole childでないこと(M5のsole-child制約)、
// および外側の条件分岐 > リスト > (ネストしていた)条件分岐という3階層の
// 入れ子がM5.5の「1階層まで」を超えること。編集モードのUIも、span/input
// のDOM入れ替え(UNRESOLVED-07、未解決のまま)ではなく、実物のTodoMVCと
// 同じCSSクラストグル方式(`<li class={editing() ? 'editing' : ...}>`)に
// している ― これは`TodoItem`のローカルsignal`editing`への同一ユニット
// 直下の依存(動的class属性バインディング)として書け、07の入れ子構造
// ユニットを必要としない。

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
    <div class='todoapp'>
      <input
        use={setupNewTodoInput}
        onKeyDown={handleInputKeyDown}
        placeholder='What needs to be done?'
      />

      {visibleTodos().length > 0 && (
        <ul class='todo-list'>
          {visibleTodos().map((todo) => (
            <TodoItem
              key={todo.id}
              todo={todo}
              onToggle={() => toggleTodo(todo.id)}
              onCommitEdit={(e) =>
                e.key === 'Enter' && commitEdit(todo.id, e.target.value)
              }
              onRemove={() => removeTodo(todo.id)}
            />
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

  function commitEdit(id, text) {
    const t = text.trim()
    if (t !== '') {
      todos(todos().map((x) => (x.id === id ? { ...x, text: t } : x)))
    }
  }
}

// same-file-component-composition(ADR-0014)で切り出したリストアイテムの
// コンポーネント。UNRESOLVED-04(アイテムごとのローカル編集状態)は、
// コンポーネント全体で1つのsignalを使い回す`editingId`ハックではなく、
// このコンポーネント自身の変数ゾーンに`editing`ローカルsignalを持たせる
// ことで解消する ― `TodoApp`の`.map()`アイテム位置へインライン化されると
// factoryクロージャ専有のローカル状態になり(CONTEXT.md「ローカルsignal」)、
// アイテムごとに自動的に独立する。呼び出し箇所の`<TodoItem key={todo.id}
// .../>`のkeyはlintのuseJsxKeyInIterable対応のみが目的で、コンパイラは
// 展開後にこのコンポーネント自身が持つ`<li key={todo.id}>`のkeyだけを見る
// (propとしては受け取らない)。
function TodoItem({ todo, onToggle, onCommitEdit, onRemove }) {
  const editing = signal(false)

  render(
    <li
      key={todo.id}
      class={`${todo.completed ? 'completed' : ''} ${editing() ? 'editing' : ''}`}
    >
      <input type='checkbox' checked={todo.completed} onChange={onToggle} />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: フィクスチャなのでa11y対応はスコープ外 */}
      <span onDblClick={() => editing(true)}>{todo.text}</span>
      {/* UNRESOLVED(08): 編集中テキストの下書き保持先は未規定のまま。
          ここではinput要素自身のvalueをsource of truthとし、確定は
          Enterでe.target.value経由に寄せる。編集開始時のtodo.textの
          プリフィルはADR-0012のvalueプロパティバインディングで書ける。
          UNRESOLVED(07、編集モードのspan/input DOM入れ替え)は未解決の
          まま ― このフィクスチャではspan/input両方を常にDOMへ出し、
          実物のTodoMVCと同じCSSクラストグル(上のclass属性)で表示を
          切り替えることで07を必要としない形にしている。
          `onCommitEdit`をこのコンポーネント自身の文でラップせず
          `onKeyDown={onCommitEdit}`のまま素通しにしているのは、
          コンポーネント合成の実装上の制約(props置換は識別子参照全体を
          呼び出し元の式で置き換える方式のため、置換対象がハンドラ属性値
          そのものである場合は正しく動くが、このコンポーネント側で
          `(e) => { onCommitEdit(...); ...; }`のように追加の文で包むと、
          置換後の呼び出し式がソース位置ベースの書き換え検出に乗らず
          置換が反映されない、実装前調査で確認した既知の制約)。
          「Enterキーのときだけ」の判定は呼び出し元(TodoApp)の引数式
          `(e) => e.key === 'Enter' && commitEdit(...)`側に持たせ、
          編集モードの終了はこのコンポーネント自身の`onBlur`(propを
          経由しない、ローカルなだけの書き込み)に委ねている。 */}
      <input
        value={todo.text}
        onKeyDown={onCommitEdit}
        onBlur={() => editing(false)}
      />
      <button type='button' onClick={onRemove}>
        x
      </button>
    </li>,
  )
}
