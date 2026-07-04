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

export interface GenerateModuleInput {
  declStatements: string[]
  markers: Marker[]
  signalToMarkers: Map<DeclId, Set<MarkerId>>
  declOutputName: Map<DeclId, string>
  derivedDeps: Map<DeclId, Set<DeclId>>
  derivedRecompute: Map<DeclId, string>
  initialHtml: string
}

export function generateModule({
  declStatements,
  markers,
  signalToMarkers,
  declOutputName,
  derivedDeps,
  derivedRecompute,
  initialHtml,
}: GenerateModuleInput): string {
  const outLines: string[] = []
  outLines.push("import { mount } from '../src/runtime.js';", '')
  outLines.push(...declStatements.map((s) => `export ${s}`), '')
  outLines.push(`const __INITIAL_HTML__ = ${JSON.stringify(initialHtml)};`, '')
  outLines.push(
    'let __markers__;',
    'export function mountComponent(container) {',
    '  ({ markers: __markers__ } = mount(container, __INITIAL_HTML__));',
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
