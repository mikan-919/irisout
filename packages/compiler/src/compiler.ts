// マイルストーン1のコンパイラ:式の依存解析、単一コンポーネント、
// signal/derived から専用 update_* への codegen(docs/adr/0001-first-milestone.md)。
// 出力はプレーン変数を使う(ADR-0006、legacy との最大の差分)。
//
// パイプライン:
//   1. @babel/parser でソースを parse(静的 AST)。
//   2. トップレベルのコンポーネント関数をすべて列挙し、他から JSX タグとして
//      一度も参照されないものをルートとする(スコープ:ルートはちょうど1つ、
//      子コンポーネント参照そのものは M1 では scope-limit error)。
//   3. ルートの render ツリーを深さ優先で辿る(packages/compiler/src/compiler/render.ts)。
//   4. フラット化・計装済みスクリプトを Node 上で1回実行し、(a) タグ付けした
//      呼び出しサイトが本当に signal/derived であることを確認し(ADR-0001 #3)、
//      (b) 実際の初期 HTML をタダで得る。ビルド時実行だけは本物の signal/
//      derived アクセサを使う - 出力コード自体がプレーン変数になるのとは
//      別の関心事(ADR-0006)。
//   5. 依存グラフ(marker -> signal、derived 経由、packages/compiler/src/compiler/decl-graph.ts)
//      を構築し、ルート signal ごとに専用の update_<name> 関数を生成する。

import { parse } from '@babel/parser'
import type { NodePath } from '@babel/traverse'
import type * as t from '@babel/types'
import type {
  ActionOutput,
  ConditionalMarkerOutput,
  HandlerOutput,
  ListMarkerOutput,
  MarkerOutput,
  StructuralUnitBodyOutput,
  UpdateBatchOutput,
} from './codegen.ts'
import { generateModule } from './codegen.ts'
import { resolveToSignals } from './compiler/decl-graph.ts'
import { collectTopLevelComponents, inlineComponents } from './compiler/inline-components.ts'
import { compileComponent } from './compiler/render.ts'
import type {
  ConditionalMarker,
  DeclId,
  HandlerDecl,
  ListMarker,
  MarkerId,
  StructuralUnitBody,
} from './compiler/state.ts'
import { createCompilerState } from './compiler/state.ts'
import { collection, derived, registry, signal } from '@irisout/runtime'

export interface CompileResult {
  code: string
  initialHtml: string
  markers: ReturnType<typeof createCompilerState>['markers']
  signalToMarkers: Map<DeclId, Set<MarkerId>>
  declName: Map<DeclId, string>
}

// Program 直下は関数宣言(export 付き含む)のみ受理する。import 文・
// トップレベル const・副作用式は現状の実装では出力に反映されない(黙って
// 捨てられ、参照時に生 ReferenceError になる)ため、一律拒否が正直な挙動。
// 将来トップレベル定数等を受理するときは、ここを明示的な設計判断として
// 緩める(scope-limit-coverage design D2)。
function assertTopLevelShape(program: t.Program): void {
  for (const stmt of program.body) {
    const inner = stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : stmt
    if (inner?.type !== 'FunctionDeclaration') {
      throw new Error('compile: only top-level function declarations are supported (scope limit)')
    }
  }
}

// トップレベルのコンポーネントをすべて列挙し、誰からも参照されない唯一の
// ルートを特定する(パイプライン手順2)。same-file-component-composition:
// この時点ではinlineComponentsが既に子コンポーネントの参照を展開・元宣言を
// 除去済みなので、この関数はコンポーネント合成という概念を知らないまま
// 単一コンポーネント想定で動く(ADR-0014コンテキスト参照)。
function findRootComponent(ast: ReturnType<typeof parse>): NodePath<t.FunctionDeclaration> {
  const componentsByName = collectTopLevelComponents(ast)
  if (componentsByName.size === 0) throw new Error('compile: no component function found')

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
  const rootNames = [...componentsByName.keys()].filter((name) => !referenced.has(name))
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
  assertTopLevelShape(ast.program)
  // same-file-component-composition (ADR-0014, design.md D1): 同一ファイル内
  // の<Component/>参照をfindRootComponentより前にASTインライン化する。以後の
  // パイプラインはコンポーネント合成という概念を一切知らないまま動く。
  inlineComponents(ast)
  const ctx = createCompilerState(source)
  const rootPath = findRootComponent(ast)

  const out = {
    declStatements: [] as string[],
    instrumentedDeclStatements: [] as string[],
  }
  const rootHtmlSource = compileComponent(ctx, rootPath, ctx.instanceCounter++, out)

  const signalToMarkers = buildSignalToMarkers(ctx)

  // 同じ同期スコープで複数 root signal が書き込まれる場合でも、依存 marker
  // は一度だけ更新する。marker 集合が重ならない組み合わせは従来の個別
  // update_*() の方が小さいため、batch を生成しない(ADR-0004)。
  const updateBatches: UpdateBatchOutput[] = []
  const batchByRootSet = new Map<string, UpdateBatchOutput>()
  let batchCounter = 0
  const batchNames = new Set<string>()

  const nextBatchName = (): string => {
    let name = `__update_batch_${batchCounter++}__`
    while (ctx.usedOutputNames.has(name) || batchNames.has(name)) {
      name = `__update_batch_${batchCounter++}__`
    }
    batchNames.add(name)
    return name
  }

  const resolveUpdatePlan = (
    ids: Set<DeclId>,
    directCollectionWriteDeclIds: Set<DeclId> = new Set(),
  ): {
    updateNames: string[]
    updateBatchName: string | null
    needsCollectionBatch: boolean
  } => {
    const rootIds = [...new Set([...ids, ...directCollectionWriteDeclIds])]
      .filter((id) => signalToMarkers.has(id))
      .sort()
    // collection.update() は専用の直接通知をすでに行うため、batch になら
    // ないスコープの末尾へ通常の update_<collection>() を足さない。ただし
    // 同じスコープに通常の collection(next) setter もある場合は ids に
    // 残るので、最終状態の reconcile が必要になる。
    const updateNames = rootIds
      .filter(
        (id) =>
          ctx.declKind.get(id) !== 'collection' ||
          !directCollectionWriteDeclIds.has(id) ||
          ids.has(id),
      )
      .map((id) => ctx.declOutputName.get(id)!)
      .sort()
    if (rootIds.length < 2) {
      return { updateNames, updateBatchName: null, needsCollectionBatch: false }
    }

    const markerIds = new Set<MarkerId>()
    let hasSharedMarker = false
    for (const rootId of rootIds) {
      for (const markerId of signalToMarkers.get(rootId) ?? []) {
        if (markerIds.has(markerId)) hasSharedMarker = true
        markerIds.add(markerId)
      }
    }
    if (!hasSharedMarker) return { updateNames, updateBatchName: null, needsCollectionBatch: false }

    const key = rootIds.join('\u0000')
    let batch = batchByRootSet.get(key)
    if (!batch) {
      batch = {
        name: nextBatchName(),
        signalIds: rootIds,
        markerIds: [...markerIds],
        containsCollection: rootIds.some((id) => directCollectionWriteDeclIds.has(id)),
      }
      batchByRootSet.set(key, batch)
      updateBatches.push(batch)
    } else if (
      !batch.containsCollection &&
      rootIds.some((id) => directCollectionWriteDeclIds.has(id))
    ) {
      // 同じ root set の batch を通常の collection setter が先に登録して
      // いても、後から collection.update() 経路が合流した時点で direct
      // 通知の遅延が必要になる。batch は全スコープで共有するため、ここで
      // property を昇格させ、codegen 側の item updater guard も有効にする。
      batch.containsCollection = true
    }
    return {
      updateNames: [],
      updateBatchName: batch.name,
      needsCollectionBatch: batch.containsCollection,
    }
  }

  const resolveUpdateCall = (ids: Set<DeclId>, directCollectionWriteDeclIds?: Set<DeclId>) => {
    const plan = resolveUpdatePlan(ids, directCollectionWriteDeclIds)
    return {
      code: plan.updateBatchName
        ? `${plan.updateBatchName}();`
        : plan.updateNames.map((name) => `update_${name}();`).join(' '),
      needsCollectionBatch: plan.needsCollectionBatch,
    }
  }

  // --- M2/ADR-0020: ハンドラの writeDeclIds をマーカーを持つ signal だけに
  // 絞り込み、個別updateまたは共有marker用batch呼び出しへ変換する。
  // M5: リスト/条件分岐のローカルハンドラ(StructuralUnitBody.localHandlers)
  // も同じ変換が要るので、ctx.handlers 直下・構造ユニット内の両方に使う
  // 共通ヘルパーにする。
  // same-file-component-composition: ユニット直下のローカルハンドラのうち、
  // このユニット自身のローカルsignalへ書き込むものは、既存のroot更新呼び出し
  // に加えて、このユニットのfactoryが
  // 既に持つ`update()`クロージャも呼ぶ(design.md D5 ― 新しいupdate関数は
  // 作らず、M5が生成する既存のupdate()を再利用する)。ルートハンドラには
  // ローカルsignalの概念が無いため localDeclIds は省略可能。
  const convertHandler = (h: HandlerDecl, localDeclIds?: Set<DeclId>): HandlerOutput => {
    const plan = resolveUpdatePlan(h.writeDeclIds, h.directCollectionWriteDeclIds)
    return {
      markerId: h.markerId,
      eventName: h.eventName,
      rendered: h.rendered,
      param: h.param,
      updateNames: plan.updateNames,
      updateBatchName: plan.updateBatchName,
      updateBatchNeedsCollection: plan.needsCollectionBatch,
      callLocalUpdate: localDeclIds
        ? [...h.writeDeclIds].some((id) => localDeclIds.has(id))
        : false,
    }
  }
  const handlerOutputs = ctx.handlers.map((h) => convertHandler(h))

  // M5.5: ネストした構造ユニット(body.localMarkers 内の list/conditional)の
  // ローカルハンドラにも同じ変換が要るため、body と marker で相互再帰する。
  const convertUnitMarker = (
    m: ListMarker | ConditionalMarker,
  ): ListMarkerOutput | ConditionalMarkerOutput =>
    m.kind === 'list'
      ? {
          ...m,
          collectionOutputName: m.collectionDeclId
            ? ctx.declOutputName.get(m.collectionDeclId)!
            : null,
          body: convertBody(m.body),
        }
      : {
          ...m,
          branches: m.branches.map((b) => ({
            body: b.body ? convertBody(b.body) : null,
          })),
        }
  const convertBody = (body: StructuralUnitBody): StructuralUnitBodyOutput => {
    const localDeclIds = new Set(body.localDecls.map((d) => d.id))
    return {
      template: body.template,
      localMarkers: body.localMarkers.map((m) => (m.kind === 'text' ? m : convertUnitMarker(m))),
      localHandlers: body.localHandlers.map((h) => convertHandler(h, localDeclIds)),
      localAttrBindings: body.localAttrBindings,
      localDecls: body.localDecls,
    }
  }
  const markerOutputs: MarkerOutput[] = ctx.markers.map((m) => {
    if (m.kind === 'text' || m.kind === 'action') return m
    return convertUnitMarker(m)
  })

  // ADR-0011/ADR-0020: writeDeclIds は analyze.ts 側で既に root signal へ
  // 推移解決済み(analyzeActionIdentifier)なので、ここでは共有markerの有無に
  // 応じて個別updateまたはbatch文へ変換するだけでよい。action本体・返り値
  // クロージャの最終テキストは signalToMarkers 確定後にしか組み立てられない。
  const actionOutputs: ActionOutput[] = ctx.actions.map((a) => ({
    markerId: a.markerId,
    elParam: a.elParam,
    bodyRendered: a.finalizeBody(resolveUpdateCall),
    resultRendered: a.finalizeResult ? a.finalizeResult(resolveUpdateCall) : null,
  }))

  // --- ビルド時実行:discovery の確認 + 実際の初期 HTML の取得 ---
  const instrumentedBody = [
    ...out.instrumentedDeclStatements,
    `return \`${rootHtmlSource}\`;`,
  ].join('\n')
  // __esc__: テキストマーカー式値のテキストノード文脈エスケープ
  // (escape-initial-html design D2)。テキストノードなので `&` と `<` で十分。
  // __escAttr__: 動的属性の初期値焼き込み用の属性文脈エスケープ(ADR-0012
  // 決定3 — 二重引用符で囲むため `&` と `"`)。
  const runComponent = new Function(
    'signal',
    'derived',
    'collection',
    '__esc__',
    '__escAttr__',
    instrumentedBody,
  ) as (
    signalFn: typeof signal,
    derivedFn: typeof derived,
    collectionFn: typeof collection,
    escFn: (v: unknown) => string,
    escAttrFn: (v: unknown) => string,
  ) => string
  const escapeTextValue = (v: unknown): string =>
    String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const escapeAttrTextValue = (v: unknown): string =>
    String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  // 構文検査(assertTopLevelShape / render.ts の scope limit 群)をすり抜けた
  // 未知の経路が残っても、生の実行時エラーではなく「コンパイルの失敗」として
  // 報告する安全網(scope-limit-coverage design D3)。元エラーは cause に保持。
  let initialHtml: string
  try {
    initialHtml = runComponent(signal, derived, collection, escapeTextValue, escapeAttrTextValue)
  } catch (e) {
    throw new Error(
      `compile: build-time execution failed: ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    )
  }

  // same-file-component-composition: ローカルsignal(構造ユニットへ
  // インライン化されたコンポーネントの変数ゾーン宣言)は、コンテナが
  // 初期HTMLで空のまま焼かれる(design.md D5)ためビルド時実行の対象に
  // ならず、registry には現れない。discovery check の対象外にする。
  for (const [id, kind] of ctx.declKind) {
    if (ctx.localDeclIds.has(id)) continue
    const entry = registry.get(id)
    if (!entry || entry.kind !== kind) {
      throw new Error(
        `compile: expected "${ctx.declOutputName.get(id)}" to be a ${kind}() call (ADR-0001 #3 discovery check)`,
      )
    }
  }

  // cross-function-handler-writes: 追跡された動きゾーン関数を emit 用の素の
  // 文字列へ落とす(Map の挿入順 = 追跡順で1回ずつ)。
  const emittedFns = [...ctx.trackedFns.values()].map((f) => ({
    name: f.name,
    params: f.paramSource,
    body: f.rendered,
  }))

  const code = generateModule({
    declStatements: out.declStatements,
    markers: markerOutputs,
    signalToMarkers,
    updateBatches,
    declOutputName: ctx.declOutputName,
    derivedDeps: ctx.derivedDeps,
    derivedRecompute: ctx.derivedRecompute,
    collectionKeyRendered: ctx.collectionKeyRendered,
    handlers: handlerOutputs,
    actions: actionOutputs,
    attrBindings: ctx.attrBindings,
    emittedFns,
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
