// 最終 codegen:コンパイラが収集した結果(フラット化された宣言文、マーカー、
// signal->marker 依存グラフ)から、mountComponent() とルート signal ごとの
// update_<name>() を持つ1つの ES モジュールを組み立てる。
// ここは文字列組み立てのみ - AST もコンパイラ状態も触らない。
//
// ADR-0006: 宣言はプレーン変数として出力される(signal()/derived() ラッパー
// は出力に現れない)。derived は遅延評価ではなくなるため、それが依存する
// root signal の update_* 内で先に再計算してからマーカーを更新する。

import type { DeclId, Marker, MarkerId } from './compiler/state.js'
import { innerTemplateSource } from './template.js'

// M2: compiler.ts が writeDeclIds を(マーカーを持つ signal だけに絞って)
// updateNames へ変換した後の、codegen 向けハンドラ表現。
export interface HandlerOutput {
  markerId: MarkerId
  eventName: string
  rendered: string
  updateNames: string[]
  /** ADR-0009: 第1仮引数(イベントオブジェクト)の authored 名。なければ null。 */
  param: string | null
}

export interface GenerateModuleInput {
  declStatements: string[]
  markers: Marker[]
  signalToMarkers: Map<DeclId, Set<MarkerId>>
  declOutputName: Map<DeclId, string>
  derivedDeps: Map<DeclId, Set<DeclId>>
  derivedRecompute: Map<DeclId, string>
  handlers: HandlerOutput[]
  initialHtml: string
}

export function generateModule({
  declStatements,
  markers,
  signalToMarkers,
  declOutputName,
  derivedDeps,
  derivedRecompute,
  handlers,
  initialHtml,
}: GenerateModuleInput): string {
  const outLines: string[] = []
  outLines.push("import { mount, hydrate } from '../src/runtime.js';", '')
  outLines.push(...declStatements.map((s) => `export ${s}`), '')
  outLines.push(`const __INITIAL_HTML__ = ${JSON.stringify(initialHtml)};`, '')

  // ハンドラのラッパー関数:元のハンドラ本体(書き込みは代入済み)を実行した
  // 後、そのハンドラが書き込んだ signal ぶんの update_* をまとめて呼ぶ。
  for (const h of handlers) {
    const updateCalls = h.updateNames
      .map((name) => `update_${name}();`)
      .join(' ')
    // ADR-0009 D4: 第1引数があるハンドラのみ authored 名を束縛する
    // (引数なしハンドラの出力は不変 = golden 差分ゼロ)。
    const params = h.param ? `${h.param}, ...__args` : '...__args'
    outLines.push(
      `const __handler_${h.markerId}_${h.eventName} = (${params}) => { ${h.rendered}; ${updateCalls} };`,
    )
  }
  if (handlers.length > 0) outLines.push('')

  // mountComponent と hydrateComponent で共有する addEventListener 配線行
  // (markers の取得手段だけが違う: innerHTML 書き込みありか、なしか)。
  const setupLines = handlers.map(
    (h) =>
      `  __markers__.get(${JSON.stringify(h.markerId)})?.addEventListener(${JSON.stringify(h.eventName)}, __handler_${h.markerId}_${h.eventName});`,
  )

  outLines.push(
    'let __markers__;',
    'export function mountComponent(container) {',
    '  ({ markers: __markers__ } = mount(container, __INITIAL_HTML__));',
    ...setupLines,
    '}',
    '',
    'export function hydrateComponent(container) {',
    '  ({ markers: __markers__ } = hydrate(container));',
    ...setupLines,
    '}',
    '',
  )

  // signal declId -> それに直接依存する derived declId の一覧。M1 では
  // derived-of-derived を禁止しているので、これはフラットな逆引きで足りる。
  const signalToDerivedRecomputes = new Map<DeclId, DeclId[]>()
  for (const [derivedId, deps] of derivedDeps) {
    for (const dep of deps) {
      const list = signalToDerivedRecomputes.get(dep) ?? []
      list.push(derivedId)
      signalToDerivedRecomputes.set(dep, list)
    }
  }

  for (const [signalId, markerIds] of signalToMarkers) {
    const name = declOutputName.get(signalId)
    outLines.push(`export function update_${name}() {`)
    for (const derivedId of signalToDerivedRecomputes.get(signalId) ?? []) {
      outLines.push(
        `  ${declOutputName.get(derivedId)} = ${derivedRecompute.get(derivedId)};`,
      )
    }
    for (const mId of markerIds) {
      const marker = markers.find((m) => m.id === mId)
      if (!marker) continue
      // M1 スコープ: text マーカーのみ(attribute/conditional/list は M4/M5)。
      outLines.push(
        `  { const __el = __markers__.get(${JSON.stringify(mId)}); if (__el) { __el.textContent = \`${innerTemplateSource(marker.contentParts)}\`; } }`,
      )
    }
    outLines.push('}', '')
  }

  return outLines.join('\n')
}
