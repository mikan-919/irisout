// signal()/derived()/collection() のauthoring accessorはビルド時専用
// (ADR-0006/0019):コンパイル中に Node 上で実行され、リアクティブ状態の発見に
// 使われるだけ。生成される出力コードはプレーン変数と専用stateを使うので、
// これらの関数は生成モジュールから一切 import
// されない。`declId` はビルド時 discovery のためだけにコンパイラが注入する
// もので、コンポーネント作者が使う公開 signal/derived/collection API の一部ではない
// (docs/adr/0006-generated-output-drops-runtime-signal-wrapper.md 参照)。
//
// mount()/hydrate() と List helper は生成モジュールから必要時に import される、
// 実際にブラウザへ出荷される最小ランタイム。List helperは仮想DOMを作らず、
// ADR-0015の更新アドレスとkeyed DOM順序だけを管理する。

type DeclId = string
type DeclKind = 'signal' | 'derived' | 'collection'

// CONCEPT.v3: List 全体を再描画せず、listId / itemId / bindingId の3段アドレスで
// 更新先を特定する。文字列の連結やハッシュはホットパスで作らず、List と item は
// Map、binding は各 item の Map で分離して保持する。
export interface ListItemState {
  readonly listId: string
  readonly itemId: unknown
  readonly bindings: Map<string, unknown>
}

export interface ListItemHandle<T = unknown> {
  el: Element
  /** 複雑なネスト構造向けの互換経路。通常のList itemは共有updaterを使う。 */
  update?(next: T): void
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

export type ListItemUpdater<T> = (handle: ListItemHandle<T>, next: T) => void

interface ListRecord<T> {
  state: ListItemState
  handle: ListItemHandle<T>
}

export interface ListRuntime<T> {
  readonly listId: string
  readonly items: Map<unknown, ListRecord<T>>
}

export function createListRuntime<T = unknown>(listId: string): ListRuntime<T> {
  return { listId, items: new Map() }
}

// bindingId はコンパイラが item factory 内の更新箇所ごとに固定する。初回、または
// Object.is で値が変わったときだけ true を返すため、生成コードは対象 DOM API
// だけを呼べる。式の評価自体は従来どおり行い、副作用の回数は変えない。
export function updateListBinding(item: ListItemState, bindingId: string, value: unknown): boolean {
  if (item.bindings.has(bindingId)) {
    const previous = item.bindings.get(bindingId)
    if (Object.is(previous, value)) return false
  }
  item.bindings.set(bindingId, value)
  return true
}

export interface CollectionState<T, K> {
  values: T[]
  readonly keyOf: (value: T) => K
  readonly index: Map<K, number>
}

function buildCollectionIndex<T, K>(values: readonly T[], keyOf: (value: T) => K): Map<K, number> {
  const index = new Map<K, number>()
  values.forEach((value, position) => {
    const key = keyOf(value)
    if (index.has(key)) throw new Error(`collection: duplicate key ${String(key)}`)
    index.set(key, position)
  })
  return index
}

export function createCollectionState<T, K>(
  initial: readonly T[],
  keyOf: (value: T) => K,
): CollectionState<T, K> {
  const values = Array.from(initial)
  return { values, keyOf, index: buildCollectionIndex(values, keyOf) }
}

export function replaceCollection<T, K>(state: CollectionState<T, K>, next: readonly T[]): T[] {
  const values = Array.from(next)
  const index = buildCollectionIndex(values, state.keyOf)
  state.values = values
  state.index.clear()
  for (const [key, position] of index) state.index.set(key, position)
  return state.values
}

export function updateCollectionItem<T, K>(
  state: CollectionState<T, K>,
  key: K,
  updater: (current: T) => T,
): T {
  const index = state.index.get(key)
  if (index === undefined) throw new Error(`collection.update: unknown key ${String(key)}`)
  const next = updater(state.values[index]!)
  const nextKey = state.keyOf(next)
  if (!Object.is(nextKey, key)) {
    throw new Error(
      `collection.update: key must remain ${String(key)}, received ${String(nextKey)}`,
    )
  }
  state.values[index] = next
  return next
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

// key の照合と DOM 順序の調整だけを共有ランタイムが担当し、item 内の細粒度更新は
// コンパイラが生成した共有 update(handle, next) に委譲する。handle 自身に関数を
// 持たせないため、List の行数に比例した update クロージャ割り当ては発生しない。
// 末尾から insertBefore() することで順序が変わっていない要素には DOM 操作を発生させない。
export function reconcileList<T>(
  runtime: ListRuntime<T>,
  container: Element | undefined,
  values: readonly T[],
  keyOf: (value: T) => unknown,
  create: (value: T, state: ListItemState) => ListItemHandle<T>,
  update?: ListItemUpdater<T>,
): void {
  const seen = new Set<unknown>()
  const ordered: ListRecord<T>[] = []

  for (const value of values) {
    const itemId = keyOf(value)
    if (seen.has(itemId)) {
      throw new Error(`reconcileList: duplicate key ${String(itemId)} in list ${runtime.listId}`)
    }
    seen.add(itemId)
    let record = runtime.items.get(itemId)
    if (record) {
      if (update) update(record.handle, value)
      else if (record.handle.update) record.handle.update(value)
      else
        throw new Error(
          `reconcileList: no updater for item ${String(itemId)} in list ${runtime.listId}`,
        )
    } else {
      const state: ListItemState = {
        listId: runtime.listId,
        itemId,
        bindings: new Map(),
      }
      record = { state, handle: create(value, state) }
      runtime.items.set(itemId, record)
    }
    ordered.push(record)
  }

  for (const [itemId, record] of runtime.items) {
    if (seen.has(itemId)) continue
    record.handle.el.remove()
    runtime.items.delete(itemId)
  }

  if (!container) return
  let anchor: ChildNode | null = null
  for (let i = ordered.length - 1; i >= 0; i--) {
    const el = ordered[i]!.handle.el
    if (el.parentNode !== container || el.nextSibling !== anchor) {
      container.insertBefore(el, anchor)
    }
    anchor = el
  }
}

export const registry = new Map<DeclId, { kind: DeclKind }>()

export function signal<T>(initial: T, declId?: DeclId): (...args: [] | [T]) => T {
  let value = initial
  function accessor(...args: [] | [T]): T {
    if (args.length === 0) return value
    value = args[0] as T
    return value
  }
  if (declId) registry.set(declId, { kind: 'signal' })
  return accessor
}

export function derived<T>(compute: () => T, declId?: DeclId): () => T {
  if (declId) registry.set(declId, { kind: 'derived' })
  return compute
}

export interface CollectionAccessor<T, K> {
  (): readonly T[]
  (next: readonly T[]): readonly T[]
  update(key: K, updater: (current: T) => T): T
}

export function collection<T, K>(
  initial: readonly T[],
  keyOf: (value: T) => K,
  declId?: DeclId,
): CollectionAccessor<T, K> {
  let values = Array.from(initial)
  const accessor = ((...args: [] | [readonly T[]]): readonly T[] => {
    if (args.length === 0) return values
    values = Array.from(args[0]!)
    return values
  }) as CollectionAccessor<T, K>
  accessor.update = (key, updater) => {
    const index = values.findIndex((value) => Object.is(keyOf(value), key))
    if (index < 0) throw new Error(`collection.update: unknown key ${String(key)}`)
    const next = updater(values[index]!)
    const nextKey = keyOf(next)
    if (!Object.is(nextKey, key)) {
      throw new Error(
        `collection.update: key must remain ${String(key)}, received ${String(nextKey)}`,
      )
    }
    values[index] = next
    return next
  }
  if (declId) registry.set(declId, { kind: 'collection' })
  return accessor
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

function collectMarkers(root: Element, markers: Map<string, Element>): void {
  const id = root.getAttribute('data-iris-id')
  if (id) markers.set(id, root)
  for (const child of root.children) collectMarkers(child, markers)
}
