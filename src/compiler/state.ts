// compile() 全体で共有するミュータブルな状態。analyze.ts / render.ts /
// decl-graph.ts はここで作った ctx を受け取って読み書きする。

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

// M1 スコープ:text マーカーのみ。attribute/conditional/list は M4/M5 で追加。
export type Marker = TextMarker

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

  markerCounter: number
  instanceCounter: number
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
    markerCounter: 0,
    instanceCounter: 0,
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
