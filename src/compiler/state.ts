// compile() 全体で共有するミュータブルな状態。analyze.ts / render.ts /
// decl-graph.ts はここで作った ctx を受け取って読み書きする。

import type { NodePath } from '@babel/traverse'
import type * as t from '@babel/types'

// DeclId と MarkerId はどちらも `m0`/`decl_0_42` のような文字列だが、
// 意味的に別物。ブランドしてコンパイル時に取り違えを防ぐ(実行時コストゼロ)。
export type DeclId = string & { readonly __brand: 'DeclId' }
export type MarkerId = string & { readonly __brand: 'MarkerId' }

export const toDeclId = (s: string): DeclId => s as DeclId
export const toMarkerId = (s: string): MarkerId => s as MarkerId

export type DeclKind = 'signal' | 'derived'

export interface TextContentPart {
  type: 'text'
  value: string
}
export interface ExprContentPart {
  type: 'expr'
  code: string
}
export type ContentPart = TextContentPart | ExprContentPart

export interface TextMarker {
  id: MarkerId
  kind: 'text'
  contentParts: ContentPart[]
}

// M2: onClick などのハンドラ1個分。writeDeclIds はこのハンドラが書き込む
// (呼び出しを検出した) root signal の declId 集合 -- compiler.ts の後段で
// マーカーを持つものだけに絞り込み updateNames へ変換する。
export interface HandlerDecl {
  markerId: MarkerId
  eventName: string
  rendered: string
  writeDeclIds: Set<DeclId>
  /** ADR-0009: 第1仮引数(イベントオブジェクト)の authored 名。なければ null。 */
  param: string | null
}

// ADR-0012: 動的属性バインディング1個ぶん。要素のマーカー id に相乗りする
// (text/handler と同じ前例)。deps はトップレベルでは markerDeps へ合流済み
// だが、ユニット内 splice 時の scope limit 判定にも使うため自身でも持つ。
export interface AttrBinding {
  markerId: MarkerId
  name: string
  /** 出力向け(update 用、read call を裸の識別子へ書き換え済み)。 */
  rendered: string
  deps: Set<DeclId>
}

// M5(ADR-0005): リストアイテム/条件分岐ブランチの中身。テンプレート HTML
// (data-iris-id 付き、ローカルスコープの marker/handler を含む)と、
// factory 関数生成に要る材料をまとめて持つ。ローカル marker はグローバルな
// ctx.markers には積まれない(factory 内のクローンをそのつど querySelector
// する専用スコープなので、update_<signal>() から辿る対象ではない)。
// M5.5: 1階層までネストした構造ユニット(list/conditional)も localMarkers に
// 取り込まれる ― その factory/状態は外側 factory のクロージャ内に生成される。
export interface StructuralUnitBody {
  template: string
  localMarkers: (TextMarker | ListMarker | ConditionalMarker)[]
  localHandlers: HandlerDecl[]
  /** ADR-0012: このユニット専有の動的属性バインディング。 */
  localAttrBindings: AttrBinding[]
}

// リストアイテムの key(item から導出、素の式なのでラップしない)は、
// 生成された Map<key, handle> の索引にそのまま使う。
export interface ListMarker {
  id: MarkerId
  kind: 'list'
  /** `.map((item) => ...)` の item 仮引数の authored 名。 */
  itemParam: string
  /** `.map()` を呼ぶ対象配列の出力向けレンダー結果(裸の識別子または式)。 */
  arrayRendered: string
  /** `key={...}` の出力向けレンダー結果(item 仮引数を参照する式)。 */
  keyRendered: string
  body: StructuralUnitBody
}

export interface ConditionalBranch {
  /** `&&`: 真のときのみ描画。三項: consequent/alternate それぞれに対応。 */
  body: StructuralUnitBody | null
}

export interface ConditionalMarker {
  id: MarkerId
  kind: 'conditional'
  /** 条件式の出力向けレンダー結果。 */
  condRendered: string
  /** true: branches[0]=真, false=なし(`&&`)。false: branches[0]=consequent, branches[1]=alternate(三項)。 */
  isLogical: boolean
  branches: ConditionalBranch[]
}

// ADR-0011/M6: `use={fn}`のトップレベル要素マーカー。返り値クロージャを
// 持つ場合のみ push される(design.md 決定5: 返り値が無いactionは配線を
// 生成しない)。中身(本体・クロージャのレンダー済みテキスト)は
// signalToMarkers 確定後にしか確定しない(ActionDecl.finalizeBody/
// finalizeClosure)ため、Marker 自体はワイヤリングの目印(id のみ)に留める。
export interface ActionMarker {
  id: MarkerId
  kind: 'action'
}

export type Marker = TextMarker | ListMarker | ConditionalMarker | ActionMarker

// ADR-0011: 要素の`use=`1つぶんの解析結果。読み取り書き換え・書き込みの
// assignment化・ネストした関数本体への再帰(design D4-1)は分析時に確定するが、
// 挿入される`update_*()`呼び出し名はsignalToMarkers確定後にしか分からない
// ため、本体・クロージャの最終テキストは finalize 関数として遅延する。
export interface ActionDecl {
  markerId: MarkerId
  /** action本体の第1仮引数(要素自身)の authored 名。0引数なら null。 */
  elParam: string | null
  finalizeBody: (resolveUpdateNames: (ids: Set<DeclId>) => string[]) => string
  /** 返り値クロージャ(design D4-2)。無ければ null。 */
  finalizeClosure:
    | ((resolveUpdateNames: (ids: Set<DeclId>) => string[]) => string)
    | null
}

// cross-function-handler-writes: ハンドラ/action から追跡対象として呼ばれた
// 動きゾーン関数の解析結果。writeDeclIds は自分の本体が直接書く root signal
// (推移解決済み)、calleeNames は自分が呼ぶ別の追跡関数。推移的な書き込み
// 集合は呼び出しグラフを visited-set で辿って求める(自己/相互再帰を安全に
// 打ち切る)。rendered は update_*() を含まない書き換え済み本体 — update は
// 呼び出し元ハンドラ末尾のみで発火する(design D3)。
export interface TrackedFn {
  name: string
  /** authored の仮引数テキスト(括弧なし。0引数なら空文字列)。 */
  paramSource: string
  /** 書き換え済み本体(中括弧の中身、update_*() なし)。 */
  rendered: string
  writeDeclIds: Set<DeclId>
  calleeNames: Set<string>
}

export interface CompilerState {
  source: string

  // key: `${instanceId}:${declaratorStart}` -> declId。同じ declarator ノードは
  // コンポーネントのインスタンスごとに再訪されるので複合キーにしている。
  declIdByKey: Map<string, DeclId>
  declKind: Map<DeclId, DeclKind>
  declOutputName: Map<DeclId, string> // declId -> hygienic な出力識別子
  derivedDeps: Map<DeclId, Set<DeclId>> // declId -> Set<declId>
  // declId(derived のみ) -> 出力向け(call-stripped)にレンダーされた再計算式。
  // ADR-0006: 出力側は signal()/derived() ラッパーを持たないので、依存する
  // root signal の update_* 内でこの式を直接代入して derived を再計算する。
  derivedRecompute: Map<DeclId, string>
  usedOutputNames: Set<string>

  markers: Marker[]
  markerDeps: Map<MarkerId, Set<DeclId>> // markerId -> Set<declId>(直接依存、推移閉包を取る前)
  handlers: HandlerDecl[]
  actions: ActionDecl[]
  attrBindings: AttrBinding[] // ADR-0012: 動的属性(トップレベル+splice前のユニット内)

  markerCounter: number
  instanceCounter: number

  // cross-function-handler-writes: 動きゾーン(render 後)の function 宣言表。
  // render.ts の一時 handlerFns と同じ内容を、呼び出し追跡(callee の binding
  // 同一性確認)のため analyze.ts から参照できるよう ctx へ載せる。
  movementFns: Map<string, NodePath<t.FunctionDeclaration>>
  // 追跡対象として呼ばれ、モジュールスコープへ emit する関数(名前 → 解析結果)。
  // Map の挿入順にちょうど1回ずつ codegen が emit する。
  trackedFns: Map<string, TrackedFn>
}

export function createCompilerState(source: string): CompilerState {
  return {
    source,
    declIdByKey: new Map(),
    declKind: new Map(),
    declOutputName: new Map(),
    derivedDeps: new Map(),
    derivedRecompute: new Map(),
    usedOutputNames: new Set(),
    markers: [],
    markerDeps: new Map(),
    handlers: [],
    actions: [],
    attrBindings: [],
    markerCounter: 0,
    instanceCounter: 0,
    movementFns: new Map(),
    trackedFns: new Map(),
  }
}

export const declKey = (instanceId: number, start: number): string =>
  `${instanceId}:${start}`

export function nextMarkerId(ctx: CompilerState): MarkerId {
  return toMarkerId(`m${ctx.markerCounter++}`)
}

export function assignOutputName(
  ctx: CompilerState,
  naturalName: string,
  id: DeclId,
): string {
  let candidate = naturalName
  let n = 1
  while (ctx.usedOutputNames.has(candidate)) candidate = `${naturalName}$${n++}`
  ctx.usedOutputNames.add(candidate)
  ctx.declOutputName.set(id, candidate)
  return candidate
}
