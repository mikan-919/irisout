// マイルストーン1のコンパイラ:式の依存解析、単一コンポーネント、
// signal/derived から専用 update_* への codegen(docs/adr/0001-first-milestone.md)。
// 出力はプレーン変数を使う(ADR-0006、legacy との最大の差分)。
//
// パイプライン:
//   1. @babel/parser でソースを parse(静的 AST)。
//   2. トップレベルのコンポーネント関数をすべて列挙し、他から JSX タグとして
//      一度も参照されないものをルートとする(スコープ:ルートはちょうど1つ、
//      子コンポーネント参照そのものは M1 では scope-limit error)。
//   3. ルートの render ツリーを深さ優先で辿る(src/compiler/render.ts)。
//   4. フラット化・計装済みスクリプトを Node 上で1回実行し、(a) タグ付けした
//      呼び出しサイトが本当に signal/derived であることを確認し(ADR-0001 #3)、
//      (b) 実際の初期 HTML をタダで得る。ビルド時実行だけは本物の signal/
//      derived アクセサを使う - 出力コード自体がプレーン変数になるのとは
//      別の関心事(ADR-0006)。
//   5. 依存グラフ(marker -> signal、derived 経由、src/compiler/decl-graph.ts)
//      を構築し、ルート signal ごとに専用の update_<name> 関数を生成する。

import { parse } from '@babel/parser'
import type { NodePath } from '@babel/traverse'
import traverseImport from '@babel/traverse'
import type * as t from '@babel/types'
import { generateModule } from './codegen.js'
import { resolveToSignals } from './compiler/decl-graph.js'
import { compileComponent } from './compiler/render.js'
import type { DeclId, MarkerId } from './compiler/state.js'
import { createCompilerState } from './compiler/state.js'
import { derived, registry, signal } from './runtime.js'

const traverse =
  (traverseImport as unknown as { default?: typeof traverseImport }).default ??
  traverseImport

export interface CompileResult {
  code: string
  initialHtml: string
  markers: ReturnType<typeof createCompilerState>['markers']
  signalToMarkers: Map<DeclId, Set<MarkerId>>
  declName: Map<DeclId, string>
}

// トップレベルのコンポーネントをすべて列挙し、誰からも参照されない唯一の
// ルートを特定する(パイプライン手順2)。
function findRootComponent(
  ast: ReturnType<typeof parse>,
): NodePath<t.FunctionDeclaration> {
  const componentsByName = new Map<string, NodePath<t.FunctionDeclaration>>()
  traverse(ast, {
    FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
      if (
        (path.parentPath.isProgram() ||
          path.parentPath.isExportNamedDeclaration()) &&
        path.node.id
      ) {
        componentsByName.set(path.node.id.name, path)
      }
    },
  })
  if (componentsByName.size === 0)
    throw new Error('compile: no component function found')

  const referenced = new Set<string>()
  for (const path of componentsByName.values()) {
    path.traverse({
      JSXOpeningElement(jsxPath: NodePath<t.JSXOpeningElement>) {
        const name = jsxPath.node.name
        if (
          name.type === 'JSXIdentifier' &&
          /^[A-Z]/.test(name.name) &&
          componentsByName.has(name.name)
        ) {
          referenced.add(name.name)
        }
      },
    })
  }
  const rootNames = [...componentsByName.keys()].filter(
    (name) => !referenced.has(name),
  )
  if (rootNames.length !== 1) {
    throw new Error(
      `compile: expected exactly one root component, found [${rootNames.join(', ')}] (scope limit)`,
    )
  }
  return componentsByName.get(rootNames[0]!)!
}

// 推移閉包:derived の declId をルート signal まで展開し、
// signal -> それに(間接)依存するマーカー集合の逆引きを作る(パイプライン手順5)。
function buildSignalToMarkers(
  ctx: ReturnType<typeof createCompilerState>,
): Map<DeclId, Set<MarkerId>> {
  const signalToMarkers = new Map<DeclId, Set<MarkerId>>()
  for (const [markerId, deps] of ctx.markerDeps) {
    for (const dep of deps) {
      for (const sig of resolveToSignals(ctx, dep, new Set())) {
        if (!signalToMarkers.has(sig)) signalToMarkers.set(sig, new Set())
        signalToMarkers.get(sig)!.add(markerId)
      }
    }
  }
  return signalToMarkers
}

export function compile(source: string): CompileResult {
  registry.clear()

  const ast = parse(source, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  })
  const ctx = createCompilerState(source)
  const rootPath = findRootComponent(ast)

  const out = {
    declStatements: [] as string[],
    instrumentedDeclStatements: [] as string[],
  }
  const rootHtmlSource = compileComponent(
    ctx,
    rootPath,
    ctx.instanceCounter++,
    out,
  )

  const signalToMarkers = buildSignalToMarkers(ctx)

  // --- M2: ハンドラの writeDeclIds をマーカーを持つ signal だけに絞り込み、
  // update_<name>() の呼び出しリストへ変換する(legacy/src/compiler.js:139-145)。
  const handlerOutputs = ctx.handlers.map((h) => ({
    markerId: h.markerId,
    eventName: h.eventName,
    rendered: h.rendered,
    updateNames: [...h.writeDeclIds]
      .filter((id) => signalToMarkers.has(id))
      .map((id) => ctx.declOutputName.get(id)!)
      .sort(),
  }))

  // --- ビルド時実行:discovery の確認 + 実際の初期 HTML の取得 ---
  const instrumentedBody = [
    ...out.instrumentedDeclStatements,
    `return \`${rootHtmlSource}\`;`,
  ].join('\n')
  const runComponent = new Function('signal', 'derived', instrumentedBody) as (
    signalFn: typeof signal,
    derivedFn: typeof derived,
  ) => string
  const initialHtml = runComponent(signal, derived)

  for (const [id, kind] of ctx.declKind) {
    const entry = registry.get(id)
    if (!entry || entry.kind !== kind) {
      throw new Error(
        `compile: expected "${ctx.declOutputName.get(id)}" to be a ${kind}() call (ADR-0001 #3 discovery check)`,
      )
    }
  }

  const code = generateModule({
    declStatements: out.declStatements,
    markers: ctx.markers,
    signalToMarkers,
    declOutputName: ctx.declOutputName,
    derivedDeps: ctx.derivedDeps,
    derivedRecompute: ctx.derivedRecompute,
    handlers: handlerOutputs,
    initialHtml,
  })

  return {
    code,
    initialHtml,
    markers: ctx.markers,
    signalToMarkers,
    declName: ctx.declOutputName,
  }
}
