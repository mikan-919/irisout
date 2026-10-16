// signal()/derived() のauthoring accessorはビルド時専用
// (ADR-0006/0019):コンパイル中に Node 上で実行され、リアクティブ状態の発見に
// 使われるだけ。生成される出力コードはプレーン変数と専用stateを使うので、
// これらの関数は生成モジュールから一切 import
// されない。`declId` はビルド時 discovery のためだけにコンパイラが注入する
// もので、コンポーネント作者が使う公開 signal/derived API の一部ではない
// (docs/adr/0006-generated-output-drops-runtime-signal-wrapper.md 参照)。
//
// mount()/hydrate() と List helper は生成モジュールから必要時に import される、
// 実際にブラウザへ出荷される最小ランタイム。List helperは仮想DOMを作らず、
// ADR-0015の更新アドレスとkeyed DOM順序だけを管理する。

type DeclId = string
type DeclKind = 'signal' | 'derived'

export interface DomUpdateObserver {
  before(): void
  after(): void
}

const domUpdateObservers = new Set<DomUpdateObserver>()
let domUpdateDepth = 0

export function isDomUpdateInProgress(): boolean {
  return domUpdateDepth > 0
}

// DOM更新の前後を一つの測定単位として外部機能へ通知する。入れ子更新は最外周だけを
// 通知し、コンパイラ本体へ配置測定などの用途別処理を持ち込まない。
export function observeDomUpdates(observer: DomUpdateObserver): () => void {
  domUpdateObservers.add(observer)
  return () => domUpdateObservers.delete(observer)
}

export function beginDomUpdate(): void {
  if (domUpdateDepth++ > 0) return
  try {
    for (const observer of domUpdateObservers) observer.before()
  } catch (error) {
    domUpdateDepth = 0
    throw error
  }
}

export function endDomUpdate(): void {
  if (domUpdateDepth === 0) throw new Error('endDomUpdate called without beginDomUpdate')
  if (--domUpdateDepth > 0) return
  let firstError: unknown
  for (const observer of domUpdateObservers) {
    try {
      observer.after()
    } catch (error) {
      firstError ??= error
    }
  }
  if (firstError) throw firstError
}

// CONCEPT.v3: List 全体を再描画せず、listId / itemId / bindingId の3段アドレスで
// 更新先を特定する。文字列の連結やハッシュはホットパスで作らず、List と item は
// Map、binding は各 item の Map で分離して保持する。
export interface ListItemState {
  readonly listId: string
  readonly itemId: unknown
  readonly bindings: Map<string, unknown>
}

// 固定プロパティを使う生成行では値保存用のMapを作らず、必要な項目だけで確保する。
class ItemState implements ListItemState {
  #bindings?: Map<string, unknown>

  constructor(
    readonly listId: string,
    readonly itemId: unknown,
  ) {}

  get bindings(): Map<string, unknown> {
    return (this.#bindings ??= new Map())
  }
}

export interface ListItemHandle<T = unknown> {
  el: Element
  /** 複雑なネスト構造向けの互換経路。通常のList itemは共有updaterを使う。 */
  update?(next: T): void
  /** DOMへ接続された後に、このitemが所有するactionを初期化する。 */
  mount?(): void
  /** itemと子unitの所有資源を解放する。複数回呼び出しても安全であること。 */
  destroy?(): void
}

// Structural units own the sibling range between these comments. Keeping the
// anchors as a pair (rather than a wrapper element) lets generated JSX retain
// its authored DOM shape while List/conditional updates stay local to one
// unit. The comments are also present in statically baked HTML, so hydration
// can recover the same range without rebuilding the tree.
export interface DomRange {
  readonly start: Comment
  readonly end: Comment
}

// `use=` action の返り値。関数形式は既存の「リアクティブ update closure」
// と完全に同じ意味を持ち、object 形式では unmount 専用の destroy を追加できる。
export type UseActionUpdate = () => void
export type UseActionDestroy = () => void
export type UseActionResult =
  | void
  | UseActionUpdate
  | { update?: UseActionUpdate; destroy?: UseActionDestroy }

export interface NormalizedUseActionResult {
  update?: UseActionUpdate
  destroy?: UseActionDestroy
}

// 生成コードの action 呼び出し境界で返り値を検証する。関数を先に判定する
// のは、既存の `() => void` が持つ update 意味論を object のプロパティとして
// 解釈しないためである。未知の object key も黙って無視せず、action の契約違反を
// mount 時に明示する。
export function normalizeUseActionResult(
  value: unknown,
  actionId: string,
): NormalizedUseActionResult {
  if (value === undefined) return {}
  if (typeof value === 'function') return { update: value as UseActionUpdate }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(
      `use action ${actionId} must return void, a zero-argument update function, or { update?, destroy? }`,
    )
  }

  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (key !== 'update' && key !== 'destroy') {
      throw new Error(`use action ${actionId} returned an unsupported property: ${key}`)
    }
  }
  if (record.update !== undefined && typeof record.update !== 'function') {
    throw new Error(`use action ${actionId}.update must be a function when provided`)
  }
  if (record.destroy !== undefined && typeof record.destroy !== 'function') {
    throw new Error(`use action ${actionId}.destroy must be a function when provided`)
  }
  return {
    update: record.update as UseActionUpdate | undefined,
    destroy: record.destroy as UseActionDestroy | undefined,
  }
}

export type ListItemUpdater<T> = (
  handle: ListItemHandle<T>,
  next: T,
  fields?: readonly string[],
) => void

interface ListRecord<T> {
  state: ListItemState
  handle: ListItemHandle<T>
  seen?: object
}

type ListRecordFactory<T> = (
  listId: string,
  itemId: unknown,
  value: T,
  create: (value: T, state: ListItemState) => ListItemHandle<T>,
) => ListRecord<T>

// ADR-0068: 平坦な生成関数は状態を読まない。外から状態を参照する互換経路だけで確保する。
class FlatListRecord<T> implements ListRecord<T> {
  #state?: ListItemState
  seen?: object

  constructor(
    private readonly listId: string,
    private readonly itemId: unknown,
    readonly handle: ListItemHandle<T>,
  ) {}

  get state(): ListItemState {
    return (this.#state ??= new ItemState(this.listId, this.itemId))
  }
}

export function createFlatListRecord<T>(
  listId: string,
  itemId: unknown,
  value: T,
  create: (value: T, state: ListItemState) => ListItemHandle<T>,
): ListRecord<T> {
  return new FlatListRecord(listId, itemId, (create as (value: T) => ListItemHandle<T>)(value))
}

function createListRecord<T>(
  listId: string,
  itemId: unknown,
  value: T,
  create: (value: T, state: ListItemState) => ListItemHandle<T>,
): ListRecord<T> {
  const state = new ItemState(listId, itemId)
  return { state, handle: create(value, state), seen: undefined }
}

export interface ListRuntime<T> {
  readonly listId: string
  readonly items: Map<unknown, ListRecord<T>>
}

export function createListRuntime<T = unknown>(listId: string): ListRuntime<T> {
  return { listId, items: new Map() }
}

interface ListChangeBase {
  token: object
  base?: object
}

type ListMapChange = ListChangeBase &
  (
    | { kind: 'base' }
    | { kind: 'map'; changes: [unknown, unknown][]; fields?: readonly string[] }
    | { kind: 'append'; start: number }
    | { kind: 'filter'; removed: unknown[] }
    | { kind: 'swap'; indexes: [number, number]; before: [unknown, unknown]; length: number }
  )

// ADR-0067: 元の配列を保持すると更新履歴が連鎖して残るため、基点は識別子だけを持つ。
const listMapChanges = new WeakMap<readonly unknown[], ListMapChange>()
const listMapBases = new WeakMap<object, object>()

function listToken(values: readonly unknown[]): object {
  let change = listMapChanges.get(values)
  if (!change) {
    change = { kind: 'base', token: {} }
    listMapChanges.set(values, change)
  }
  return change.token
}

// ADR-0068: 配列の複製と式の評価順は維持し、保持行の再照合だけを省く。
export function beginListAppend<T>(values: readonly T[]): T[] {
  const next = [...values]
  listMapChanges.set(next, {
    kind: 'append',
    token: {},
    base: listToken(values),
    start: values.length,
  })
  return next
}

export function appendListValues<T>(
  values: readonly T[],
  added: readonly T[],
  prepared = false,
): T[] {
  if (prepared) {
    const next = values as T[]
    const length = added.length
    for (let index = 0; index < length; index++) next.push(added[index]!)
    return next
  }
  const next = [...values, ...added]
  listMapChanges.set(next, {
    kind: 'append',
    token: {},
    base: listToken(values),
    start: values.length,
  })
  return next
}

export function filterListValues<T>(
  values: readonly T[],
  predicate: (value: T, index: number) => unknown,
): T[] {
  const removed: T[] = []
  const next = values.filter((value, index) => {
    const keep = predicate(value, index)
    if (!keep) removed.push(value)
    return keep
  })
  listMapChanges.set(next, { kind: 'filter', token: {}, base: listToken(values), removed })
  return next
}

export function copyListValues<T>(
  values: readonly T[],
  first: number,
  second: number,
  inPlace = false,
): T[] {
  const valid =
    first !== second && first >= 0 && second >= 0 && first < values.length && second < values.length
  const base = listToken(values)
  const next = inPlace && valid ? (values as T[]) : values.slice()
  if (valid) {
    listMapChanges.set(next, {
      kind: 'swap',
      token: {},
      base,
      indexes: [first, second],
      before: [values[first], values[second]],
      length: values.length,
    })
  }
  return next
}

// コンパイラが所有権とmap本体を検証した場合だけ呼ぶ。公開signalの契約は変えない。
export function mapListValues<T>(
  values: readonly T[],
  map: (value: T, index: number) => T,
  stride?: number,
  offset = 0,
  fields?: readonly string[],
): T[] {
  const base = listToken(values)
  const changes: [unknown, unknown][] = []
  const apply = (value: T, index: number): T => {
    const result = map(value, index)
    if (result !== value) changes.push([value, result])
    return result
  }
  const next = stride === undefined ? values.map(apply) : values.slice()
  if (stride !== undefined) {
    const length = values.length
    for (let index = offset; index < length; index += stride === undefined ? 1 : stride || length) {
      if (index in values) {
        next[index] = apply(values[index]!, index)
      }
    }
  }
  listMapChanges.set(next, { kind: 'map', token: {}, base, changes, fields })
  return next
}

export function reconcileListMap<T>(
  runtime: ListRuntime<T>,
  container: Element | DomRange | undefined,
  values: readonly T[],
  keyOf: (value: T) => unknown,
  create: (value: T, state: ListItemState) => ListItemHandle<T>,
  update: ListItemUpdater<T>,
  allowMap: boolean,
  recordFactory?: ListRecordFactory<T>,
  keyField?: string,
): void {
  const previous = listMapBases.get(runtime)
  listMapBases.delete(runtime)
  const change = listMapChanges.get(values)
  if (allowMap && previous && change?.base === previous) {
    const parent =
      container && change.kind !== 'map'
        ? isDomRange(container)
          ? container.start.parentNode
          : container
        : null
    if (change.kind === 'append' && change.start === runtime.items.size) {
      const fragment = parent?.ownerDocument?.createDocumentFragment()
      for (let index = change.start; index < values.length; index++) {
        const value = values[index]!
        const itemId = keyOf(value)
        if (runtime.items.has(itemId))
          throw new Error(
            `reconcileList: duplicate key ${String(itemId)} in list ${runtime.listId}`,
          )
        const record = (recordFactory ?? createListRecord)(runtime.listId, itemId, value, create)
        runtime.items.set(itemId, record)
        fragment?.append(record.handle.el)
      }
      if (parent && fragment)
        parent.insertBefore(fragment, container && isDomRange(container) ? container.end : null)
      listMapBases.set(runtime, change.token)
      return
    }
    if (change.kind === 'filter') {
      for (const value of change.removed) {
        const itemId = keyOf(value as T)
        const record = runtime.items.get(itemId)
        record?.handle.el.remove()
        runtime.items.delete(itemId)
      }
      listMapBases.set(runtime, change.token)
      return
    }
    if (
      change.kind === 'swap' &&
      values.length === change.length &&
      values[change.indexes[0]] === change.before[1] &&
      values[change.indexes[1]] === change.before[0]
    ) {
      const first = runtime.items.get(keyOf(change.before[0] as T))?.handle.el
      const second = runtime.items.get(keyOf(change.before[1] as T))?.handle.el
      if (
        first &&
        second &&
        (!parent || (first.parentNode === parent && second.parentNode === parent))
      ) {
        if (parent) {
          const afterFirst = first.nextSibling
          const afterSecond = second.nextSibling
          if (afterFirst === second) parent.insertBefore(second, first)
          else if (afterSecond === first) parent.insertBefore(first, second)
          else {
            parent.insertBefore(second, afterFirst)
            parent.insertBefore(first, afterSecond)
          }
        }
        listMapBases.set(runtime, change.token)
        return
      }
    }
    // キー変更は構造変更なので、更新前に全変更行を検査して通常照合へ戻す。
    if (
      change.kind === 'map' &&
      ((keyField !== undefined &&
        change.fields !== undefined &&
        !change.fields.includes(keyField)) ||
        change.changes.every(
          ([before, after]) =>
            Object.is(keyOf(before as T), keyOf(after as T)) &&
            runtime.items.has(keyOf(before as T)),
        ))
    ) {
      for (const [, next] of change.changes)
        update(runtime.items.get(keyOf(next as T))!.handle, next as T, change.fields)
      listMapBases.set(runtime, change.token)
      return
    }
  }
  reconcileList(runtime, container, values, keyOf, create, update, recordFactory)
  listMapBases.set(runtime, listToken(values))
}

// bindingId はコンパイラが item factory 内の更新箇所ごとに固定する。初回、または
// Object.is で値が変わったときだけ true を返すため、生成コードは対象 DOM API
// だけを呼べる。式の評価自体は従来どおり行い、副作用の回数は変えない。
export function updateListBinding(item: ListItemState, bindingId: string, value: unknown): boolean {
  const bindings = item.bindings
  const previous = bindings.get(bindingId)
  if (Object.is(previous, value) && (value !== undefined || bindings.has(bindingId))) return false
  bindings.set(bindingId, value)
  return true
}

export function updateListItem<T>(
  runtime: ListRuntime<T>,
  itemId: unknown,
  next: T,
  update?: ListItemUpdater<T>,
): void {
  const record = runtime.items.get(itemId)
  if (!record) {
    throw new Error(`updateListItem: unknown item ${String(itemId)} in list ${runtime.listId}`)
  }
  if (update) update(record.handle, next)
  else if (record.handle.update) record.handle.update(next)
  else
    throw new Error(
      `updateListItem: no updater for item ${String(itemId)} in list ${runtime.listId}`,
    )
}

function insertListRecords<T>(
  parent: Node,
  boundary: ChildNode | null,
  ordered: readonly ListRecord<T>[],
  batch: boolean,
  start?: ChildNode,
): void {
  if (batch && ordered.length > 0) {
    const ownerDocument = parent.ownerDocument
    if (ownerDocument) {
      const fragment = ownerDocument.createDocumentFragment()
      for (const record of ordered) fragment.append(record.handle.el)
      parent.insertBefore(fragment, boundary)
      return
    }
  }

  // ADR-0066: 一致する両端は触らず、残った区間だけを最長増加部分列で並べる。
  // これにより離れた2行の交換でも、中間の行を移動させない。
  if (start) {
    let left = 0
    let right = ordered.length - 1
    let first = start.nextSibling
    let anchor = boundary
    while (left <= right && ordered[left]!.handle.el === first) {
      first = first.nextSibling
      left++
    }
    while (left <= right && ordered[right]!.handle.el === anchor?.previousSibling) {
      anchor = ordered[right]!.handle.el
      right--
    }
    if (left > right) return
    // 一致する両端の間が空なら、新しい区間だけを順方向にまとめて挿入する。
    if (first === anchor) {
      const fragment = parent.ownerDocument!.createDocumentFragment()
      for (let index = left; index <= right; index++) fragment.append(ordered[index]!.handle.el)
      parent.insertBefore(fragment, anchor)
      return
    }
    // 両端の交換だけなら中間を照合し、配置用Mapと部分列の配列を作らない。
    const leftEl = ordered[left]!.handle.el
    const rightEl = ordered[right]!.handle.el
    if (leftEl === anchor?.previousSibling && rightEl === first) {
      let node = first.nextSibling
      let index = left + 1
      while (index < right && ordered[index]!.handle.el === node) {
        node = node.nextSibling
        index++
      }
      if (index === right) {
        parent.insertBefore(leftEl, first)
        if (rightEl.nextSibling !== anchor) parent.insertBefore(rightEl, anchor)
        return
      }
    }
    const positions = new Map<Node, number>()
    for (let node = first; node && node !== anchor; node = node.nextSibling) {
      positions.set(node, positions.size)
    }
    const tails: number[] = []
    const previous: number[] = []
    const indices: number[] = []
    for (let i = left; i <= right; i++) {
      const position = positions.get(ordered[i]!.handle.el)
      if (position === undefined) continue
      let low = 0
      let high = tails.length
      while (low < high) {
        const middle = (low + high) >>> 1
        if (tails[middle]! < position) low = middle + 1
        else high = middle
      }
      previous[i] = low > 0 ? indices[low - 1]! : -1
      tails[low] = position
      indices[low] = i
    }
    let stable = indices.at(-1) ?? -1
    let fragment: DocumentFragment | null = null
    const flush = () => {
      if (fragment) parent.insertBefore(fragment, anchor)
      fragment = null
    }
    for (let i = right; i >= left; i--) {
      const el = ordered[i]!.handle.el
      if (!positions.has(el)) {
        fragment ??= parent.ownerDocument!.createDocumentFragment()
        fragment.insertBefore(el, fragment.firstChild)
        continue
      }
      flush()
      if (i === stable) stable = previous[i]!
      else parent.insertBefore(el, anchor)
      anchor = el
    }
    flush()
    return
  }

  let anchor: ChildNode | null = null
  for (let i = ordered.length - 1; i >= 0; i--) {
    const el = ordered[i]!.handle.el
    if (el.parentNode !== parent || el.nextSibling !== (anchor ?? boundary)) {
      parent.insertBefore(el, anchor ?? boundary)
    }
    anchor = el
  }
}

// 範囲が親の全内容を所有する場合だけ、一括置換して隣接する静的要素を守る。
function replaceListContents<T>(
  container: Element | DomRange | undefined,
  ordered: readonly ListRecord<T>[],
): boolean {
  if (!container || !isDomRange(container)) return false
  const parent = container.start.parentNode
  if (!parent || parent.firstChild !== container.start || parent.lastChild !== container.end)
    return false
  const fragment = parent.ownerDocument!.createDocumentFragment()
  for (const record of ordered) fragment.append(record.handle.el)
  parent.replaceChildren(container.start, fragment, container.end)
  return true
}

// key の照合と DOM 順序の調整だけを共有ランタイムが担当し、item 内の細粒度更新は
// コンパイラが生成した共有 update(handle, next) に委譲する。handle 自身に関数を
// 持たせないため、List の行数に比例した update クロージャ割り当ては発生しない。
// 末尾から insertBefore() することで順序が変わっていない要素には DOM 操作を発生させない。
export function reconcileList<T>(
  runtime: ListRuntime<T>,
  container: Element | DomRange | undefined,
  values: readonly T[],
  keyOf: (value: T) => unknown,
  create: (value: T, state: ListItemState) => ListItemHandle<T>,
  update?: ListItemUpdater<T>,
  recordFactory: ListRecordFactory<T> = createListRecord,
): void {
  const initiallyEmpty = runtime.items.size === 0
  const ordered: ListRecord<T>[] = []
  if (values.length === 0 && !initiallyEmpty && replaceListContents(container, ordered)) {
    runtime.items.clear()
    return
  }

  // 初回は既存keyの削除走査と全体Setを省き、Map存在確認だけを残す。
  // 更新経路は下の従来分岐でkeyed reuseと削除を処理する。
  if (initiallyEmpty) {
    for (const value of values) {
      const itemId = keyOf(value)
      if (runtime.items.get(itemId) !== undefined) {
        throw new Error(`reconcileList: duplicate key ${String(itemId)} in list ${runtime.listId}`)
      }
      const record = recordFactory(runtime.listId, itemId, value, create)
      runtime.items.set(itemId, record)
      ordered.push(record)
    }
  } else {
    const seen = {}
    let reused = false
    for (const value of values) {
      const itemId = keyOf(value)
      const record = runtime.items.get(itemId)
      if (record?.seen === seen) {
        throw new Error(`reconcileList: duplicate key ${String(itemId)} in list ${runtime.listId}`)
      }
      if (record) {
        record.seen = seen
        reused = true
        if (update) update(record.handle, value)
        else if (record.handle.update) record.handle.update(value)
        else
          throw new Error(
            `reconcileList: no updater for item ${String(itemId)} in list ${runtime.listId}`,
          )
      } else {
        const created = recordFactory(runtime.listId, itemId, value, create)
        created.seen = seen
        runtime.items.set(itemId, created)
        ordered.push(created)
        continue
      }
      ordered.push(record)
    }
    const replaced = !reused && replaceListContents(container, ordered)
    if (values.length !== runtime.items.size) {
      for (const [itemId, record] of runtime.items) {
        if (record.seen === seen) continue
        if (!replaced) record.handle.el.remove()
        runtime.items.delete(itemId)
      }
    }
    if (replaced) return
  }

  if (!container) return
  const parent = isDomRange(container) ? container.start.parentNode : container
  if (!parent) return
  const boundary = isDomRange(container) ? container.end : null
  insertListRecords(
    parent,
    boundary,
    ordered,
    initiallyEmpty && ordered.length > 0,
    isDomRange(container) ? container.start : undefined,
  )
}

// actionを持つ構造unit用のreconcile経路。通常のreconcileListへaction管理を
// 混ぜず、actionを含む生成モジュールだけがこの関数をimportすることで、
// action未使用の出力サイズと実行経路を維持する。
export function reconcileListWithLifecycle<T>(
  runtime: ListRuntime<T>,
  container: Element | DomRange | undefined,
  values: readonly T[],
  keyOf: (value: T) => unknown,
  create: (value: T, state: ListItemState) => ListItemHandle<T>,
  update?: ListItemUpdater<T>,
  mountItems = true,
): void {
  const initiallyEmpty = runtime.items.size === 0
  const seen = {}
  const ordered: ListRecord<T>[] = []
  const created: ListRecord<T>[] = []

  const releaseCreated = (error: unknown): never => {
    let firstError = error
    for (let i = created.length - 1; i >= 0; i--) {
      const record = created[i]!
      try {
        record.handle.destroy?.()
      } catch (cleanupError) {
        firstError ??= cleanupError
      }
      try {
        record.handle.el.remove()
      } catch (cleanupError) {
        firstError ??= cleanupError
      }
      if (runtime.items.get(record.state.itemId) === record) {
        runtime.items.delete(record.state.itemId)
      }
    }
    throw firstError
  }

  try {
    for (const value of values) {
      const itemId = keyOf(value)
      let record = runtime.items.get(itemId)
      if (initiallyEmpty ? record !== undefined : record?.seen === seen) {
        throw new Error(
          'reconcileList: duplicate key ' + String(itemId) + ' in list ' + runtime.listId,
        )
      }
      if (record) {
        record.seen = seen
        if (update) update(record.handle, value)
        else if (record.handle.update) record.handle.update(value)
        else
          throw new Error(
            'reconcileList: no updater for item ' + String(itemId) + ' in list ' + runtime.listId,
          )
      } else {
        const state = new ItemState(runtime.listId, itemId)
        record = { state, handle: create(value, state), seen }
        runtime.items.set(itemId, record)
        created.push(record)
      }
      ordered.push(record)
    }
  } catch (error) {
    releaseCreated(error)
  }

  let firstError: unknown
  const removed = initiallyEmpty
    ? []
    : [...runtime.items].filter(([, record]) => record.seen !== seen)
  for (let i = removed.length - 1; i >= 0; i--) {
    const [itemId, record] = removed[i]!
    try {
      record.handle.destroy?.()
    } catch (error) {
      firstError ??= error
    }
    try {
      record.handle.el.remove()
    } catch (error) {
      firstError ??= error
    }
    runtime.items.delete(itemId)
  }

  let parent: Node | null = null
  let layoutError: unknown
  if (container) {
    parent = isDomRange(container) ? container.start.parentNode : container
    if (parent) {
      const boundary = isDomRange(container) ? container.end : null
      try {
        insertListRecords(
          parent,
          boundary,
          ordered,
          initiallyEmpty && created.length > 0,
          isDomRange(container) ? container.start : undefined,
        )
      } catch (error) {
        firstError ??= error
        layoutError ??= error
      }
    }
  }

  if (layoutError && created.length > 0) releaseCreated(firstError ?? layoutError)
  if (mountItems) {
    if (!parent) {
      if (created.length > 0)
        releaseCreated(firstError ?? new Error('reconcileList: range is detached'))
    }
    for (const record of created) {
      if (!runtime.items.has(record.state.itemId)) continue
      if (record.handle.el.parentNode !== parent) continue
      try {
        record.handle.mount?.()
      } catch (error) {
        releaseCreated(firstError ?? error)
      }
    }
  }
  if (firstError) throw firstError
}

// 親unitがDOMへ接続された時点で、作成済みの子itemを一度だけ接続する。
// 各factoryのmount()は自分で二重初期化を防ぐため、この呼び出しは再入安全である。
export function mountListRuntime<T>(runtime: ListRuntime<T>): void {
  try {
    for (const record of runtime.items.values()) record.handle.mount?.()
  } catch (error) {
    let firstError = error
    try {
      destroyListRuntime(runtime)
    } catch (cleanupError) {
      firstError ??= cleanupError
    }
    throw firstError
  }
}

// listの所有者が破棄されるとき、itemを逆順に解放する。destroy例外があっても
// 残りのitemを必ず処理し、最初の例外だけを呼び出し元へ返す。
export function destroyListRuntime<T>(runtime: ListRuntime<T>): void {
  let firstError: unknown
  const records = [...runtime.items.values()]
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i]!
    try {
      record.handle.destroy?.()
    } catch (error) {
      firstError ??= error
    }
    try {
      record.handle.el.remove()
    } catch (error) {
      firstError ??= error
    }
  }
  runtime.items.clear()
  if (firstError) throw firstError
}

function isDomRange(value: Element | DomRange): value is DomRange {
  return !('nodeType' in value)
}

export const registry = new Map<DeclId, { kind: DeclKind }>()

export interface SignalAccessor<T> {
  (): T
  (next: T | ((previous: T) => T)): T
}

export function signal<T>(initial: T, declId?: DeclId): SignalAccessor<T> {
  let value = initial
  function accessor(...args: [] | [T | ((previous: T) => T)]): T {
    if (args.length === 0) return value
    const next = args[0]!
    value = typeof next === 'function' ? (next as (previous: T) => T)(value) : next
    return value
  }
  if (declId) registry.set(declId, { kind: 'signal' })
  return accessor
}

// compileProjectのmodule scopeで使う共有signal。component instanceごとの購読だけを
// 管理し、共有signalを使わない生成moduleへはimportされない。汎用schedulerやregistry
// ではなく、値の設定時に現在の購読者へ同期通知する専用境界である。
export interface SharedSignal<T> {
  (): T
  (next: T | ((previous: T) => T)): T
  subscribe(listener: () => void): () => void
}

export function sharedSignal<T>(initial: T): SharedSignal<T> {
  let value = initial
  const listeners = new Set<() => void>()
  const accessor = ((...args: [] | [T | ((previous: T) => T)]): T => {
    if (args.length === 0) return value
    const next = args[0]!
    value = typeof next === 'function' ? (next as (previous: T) => T)(value) : next
    for (const listener of Array.from(listeners)) listener()
    return value
  }) as SharedSignal<T>
  accessor.subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    let active = true
    return () => {
      if (!active) return
      active = false
      listeners.delete(listener)
    }
  }
  return accessor
}

export function derived<T>(compute: () => T, declId?: DeclId): () => T {
  if (declId) registry.set(declId, { kind: 'derived' })
  return compute
}

// すでに DOM 上に存在する(静的ビルドで焼き込み済みの)HTML から
// `data-iris-id` を持つ要素をすべて収集する。innerHTML の書き換えは
// 一切行わない - dist/index.html のように初期 HTML がすでにブラウザへ
// 届いているケース(ADR-0003 相当)向け。
//
// expectedIds(生成コードがコンパイル時に確定したマーカー ID 集合)が
// 渡された場合、収集結果に無い ID があれば即 throw する。不一致は続行しても
// 正しく動かない(更新が届かない DOM を放置する)ので、黙って no-op に
// させない。省略時は検証スキップ(後方互換)。
export function hydrate(
  container: Element,
  expectedIds?: readonly string[],
): { markers: Map<string, Element> } {
  const markers = new Map<string, Element>()
  collectMarkers(container, markers)
  if (expectedIds) {
    const missing = expectedIds.filter((id) => !markers.has(id))
    if (missing.length > 0) {
      throw new Error(
        `hydrate: missing marker(s): ${missing.join(', ')} — initial HTML does not match compiled output`,
      )
    }
  }
  return { markers }
}

// 焼き込み済みの初期 HTML を1回描画し、`data-iris-id` を持つ要素をすべて
// キャッシュして、生成された update_* 関数が二度と DOM を探索しなくて
// 済むようにする。expectedIds の検証は hydrate() に委譲する。
export function mount(
  container: Element,
  html: string,
  expectedIds?: readonly string[],
): { markers: Map<string, Element> } {
  container.innerHTML = html
  return hydrate(container, expectedIds)
}

// Structural modules opt into the range-aware entry points explicitly. Keeping
// the old mount/hydrate path separate means a component without List or
// conditional output does not pull the comment-anchor scanner into its bundle.
export function hydrateWithRanges(
  container: Element,
  expectedIds?: readonly string[],
  expectedRangeIds?: readonly string[],
): { markers: Map<string, Element>; ranges: Map<string, DomRange> } {
  const { markers } = hydrate(container, expectedIds)
  const ranges = new Map<string, DomRange>()
  if (expectedRangeIds) collectRanges(container, ranges)
  if (expectedRangeIds) {
    const missing = expectedRangeIds.filter((id) => !ranges.has(id))
    if (missing.length > 0) {
      throw new Error(
        `hydrate: missing range anchor(s): ${missing.join(', ')} — initial HTML does not match compiled output`,
      )
    }
  }
  return { markers, ranges }
}

export function mountWithRanges(
  container: Element,
  html: string,
  expectedIds?: readonly string[],
  expectedRangeIds?: readonly string[],
): { markers: Map<string, Element>; ranges: Map<string, DomRange> } {
  container.innerHTML = html
  return hydrateWithRanges(container, expectedIds, expectedRangeIds)
}

// ADR-0063: 文書ページだけがhtml属性とhead/bodyの置換を使う。
// DOMParserのscriptは実行されないため、追加の実行可能scriptを持つページは
// ブラウザー標準の文書遷移へ委ね、実行順を再実装しない。
export function replaceDocument(container: Element, html: string): void {
  const document = container.ownerDocument
  if (container !== document.documentElement || !document.defaultView) {
    throw new Error('replaceDocument: container must be document.documentElement')
  }
  const parsed = new document.defaultView.DOMParser().parseFromString(html, 'text/html')
  if (Array.from(parsed.scripts).some((script) => script.type !== 'application/json')) {
    throw new Error('replaceDocument: executable scripts require document navigation')
  }
  for (const attribute of Array.from(container.attributes))
    container.removeAttribute(attribute.name)
  for (const attribute of Array.from(parsed.documentElement.attributes)) {
    container.setAttribute(attribute.name, attribute.value)
  }
  container.replaceChildren(
    ...Array.from(parsed.documentElement.childNodes, (node) => document.importNode(node, true)),
  )
}

/** 文書属性を復元してから、通常のマーカー収集へ合流する。 */
export function mountDocument(
  container: Element,
  html: string,
  expectedIds?: readonly string[],
): { markers: Map<string, Element> } {
  replaceDocument(container, html)
  return hydrate(container, expectedIds)
}

/** 構造単位を持つ文書だけが範囲アンカーの収集を使う。 */
export function mountDocumentWithRanges(
  container: Element,
  html: string,
  expectedIds?: readonly string[],
  expectedRangeIds?: readonly string[],
): { markers: Map<string, Element>; ranges: Map<string, DomRange> } {
  replaceDocument(container, html)
  return hydrateWithRanges(container, expectedIds, expectedRangeIds)
}

function collectMarkers(root: Element, markers: Map<string, Element>): void {
  const id = root.getAttribute('data-iris-id')
  if (id) markers.set(id, root)
  for (const child of root.children) collectMarkers(child, markers)
}

function collectRanges(root: Element, ranges: Map<string, DomRange>): void {
  const starts = new Map<string, Comment>()
  const visit = (node: Node): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 8) {
        const value = (child as Comment).data
        if (value.startsWith('irisout:start:')) {
          starts.set(value.slice('irisout:start:'.length), child as Comment)
        } else if (value.startsWith('irisout:end:')) {
          const id = value.slice('irisout:end:'.length)
          const start = starts.get(id)
          if (start && start.parentNode === child.parentNode) {
            ranges.set(id, { start, end: child as Comment })
          }
        }
      }
      visit(child)
    }
  }
  visit(root)
}
