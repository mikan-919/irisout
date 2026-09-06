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
  EffectOutput,
  HandlerOutput,
  ListMarkerOutput,
  LocalEffectOutput,
  MarkerOutput,
  MountOutput,
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
  MountDecl,
  StructuralUnitBody,
} from './compiler/state.ts'
import { assignOutputName, createCompilerState, toContextId, toDeclId } from './compiler/state.ts'
import { linkProject } from './compiler/module-linker.ts'
import { collection, derived, registry, signal } from '@irisout/runtime'

export interface CompileResult {
  code: string
  initialHtml: string
  markers: ReturnType<typeof createCompilerState>['markers']
  signalToMarkers: Map<DeclId, Set<MarkerId>>
  declName: Map<DeclId, string>
  /** compileProject()が読み込んだ入口と相対moduleの絶対path。 */
  dependencies: string[]
}

// Program 直下は関数宣言(export 付き含む)のみ受理する。import 文・
// トップレベル const・副作用式は現状の実装では出力に反映されない(黙って
// 捨てられ、参照時に生 ReferenceError になる)ため、一律拒否が正直な挙動。
// 将来トップレベル定数等を受理するときは、ここを明示的な設計判断として
// 緩める(scope-limit-coverage design D2)。
function assertTopLevelShape(program: t.Program, allowModuleSupport = false): void {
  for (const stmt of program.body) {
    const inner = stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : stmt
    const isSupportConst =
      allowModuleSupport &&
      inner?.type === 'VariableDeclaration' &&
      inner.kind === 'const' &&
      inner.declarations.every(
        (declaration) => declaration.id.type === 'Identifier' && declaration.init != null,
      )
    const isContextConst =
      inner?.type === 'VariableDeclaration' &&
      inner.kind === 'const' &&
      inner.declarations.every((declaration) => {
        const init = declaration.init
        return (
          declaration.id.type === 'Identifier' &&
          init?.type === 'CallExpression' &&
          init.callee.type === 'Identifier' &&
          (init.callee.name === 'createContext' || init.callee.name === 'createAsyncContext') &&
          init.arguments.length === 1 &&
          init.arguments[0]?.type !== 'SpreadElement'
        )
      })
    const hasContextCall =
      inner?.type === 'VariableDeclaration' &&
      inner.declarations.some(
        (declaration) =>
          declaration.init?.type === 'CallExpression' &&
          declaration.init.callee.type === 'Identifier' &&
          (declaration.init.callee.name === 'createContext' ||
            declaration.init.callee.name === 'createAsyncContext'),
      )
    if (hasContextCall && !isContextConst) {
      throw new Error(
        'compile: context declarations require one default value and simple names (scope limit)',
      )
    }
    if (inner?.type !== 'FunctionDeclaration' && !isSupportConst && !isContextConst) {
      throw new Error('compile: only top-level function declarations are supported (scope limit)')
    }
  }
}

function collectContextDeclarations(
  ast: ReturnType<typeof parse>,
  source: string,
  ctx: ReturnType<typeof createCompilerState>,
): void {
  for (const statement of ast.program.body) {
    const declaration =
      statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
    if (declaration?.type !== 'VariableDeclaration' || declaration.kind !== 'const') continue
    for (const declarator of declaration.declarations) {
      if (
        declarator.id.type !== 'Identifier' ||
        declarator.init?.type !== 'CallExpression' ||
        declarator.init.callee.type !== 'Identifier' ||
        (declarator.init.callee.name !== 'createContext' &&
          declarator.init.callee.name !== 'createAsyncContext') ||
        declarator.init.arguments.length !== 1 ||
        declarator.init.arguments[0]?.type === 'SpreadElement'
      ) {
        continue
      }
      const start = declarator.start
      const arg = declarator.init.arguments[0]
      if (start == null || !arg || arg.start == null || arg.end == null) continue
      const id = toContextId(`context_${start}_${declarator.id.name}`)
      const defaultSourceRendered = source.slice(arg.start, arg.end)
      ctx.contexts.set(id, {
        id,
        async: declarator.init.callee.name === 'createAsyncContext',
        defaultRendered: defaultSourceRendered,
        defaultSourceRendered,
      })
      ctx.contextIdByKey.set(`${start}:${declarator.id.name}`, id)
    }
  }
}

function collectSharedSignalDeclarations(
  ast: ReturnType<typeof parse>,
  source: string,
  ctx: ReturnType<typeof createCompilerState>,
): void {
  const pending: {
    id: DeclId
    name: string
    start: number
    argStart: number
    argEnd: number
  }[] = []
  for (const statement of ast.program.body) {
    if (statement.type !== 'VariableDeclaration' || statement.kind !== 'const') continue
    for (const declarator of statement.declarations) {
      const init = declarator.init
      if (
        declarator.id.type !== 'Identifier' ||
        init?.type !== 'CallExpression' ||
        init.callee.type !== 'Identifier'
      ) {
        continue
      }
      if (init.callee.name !== 'signal') {
        if (init.callee.name === 'derived' || init.callee.name === 'collection') {
          throw new Error(
            `compile: module-scope ${init.callee.name}() shared state is not supported yet (scope limit)`,
          )
        }
        continue
      }
      if (init.arguments.length !== 1 || init.arguments[0]?.type === 'SpreadElement') {
        throw new Error('compile: module-scope signal() takes exactly one argument')
      }
      const start = declarator.start
      const arg = init.arguments[0]
      if (start == null || !arg || arg.start == null || arg.end == null) continue
      const id = toDeclId(`shared_${start}_${declarator.id.name}`)
      const outputName = assignOutputName(ctx, declarator.id.name, id)
      ctx.declKind.set(id, 'signal')
      ctx.sharedDeclIds.add(id)
      ctx.sharedDeclIdByBindingKey.set(`${start}:${declarator.id.name}`, id)
      pending.push({
        id,
        name: outputName,
        start,
        argStart: arg.start,
        argEnd: arg.end,
      })
    }
  }
  for (const declaration of pending) {
    const sourceRendered = source.slice(declaration.argStart, declaration.argEnd)
    ctx.sharedDecls.push({
      id: declaration.id,
      kind: 'signal',
      outputName: declaration.name,
      rendered: sourceRendered,
      sourceRendered,
    })
  }
}

// トップレベルのコンポーネントをすべて列挙し、誰からも参照されない唯一の
// ルートを特定する(パイプライン手順2)。same-file-component-composition:
// この時点ではinlineComponentsが既に子コンポーネントの参照を展開・元宣言を
// 除去済みなので、この関数はコンポーネント合成という概念を知らないまま
// 単一コンポーネント想定で動く(ADR-0014コンテキスト参照)。
function findRootComponent(
  ast: ReturnType<typeof parse>,
  renderOnly = false,
): NodePath<t.FunctionDeclaration> {
  const componentsByName = collectTopLevelComponents(ast, renderOnly)
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
  // effectのみが読むsignalにも専用update_*()を生成する。空のmarker集合を
  // 保持することで、handler/actionの書き込みからDOM以外のeffectへ同じ
  // 依存経路を接続し、未使用effectの生成物は増やさない。
  for (const effect of ctx.effects) {
    for (const dep of effect.readDeclIds) {
      for (const sig of resolveToSignals(ctx, dep, new Set())) {
        if (!signalToMarkers.has(sig)) signalToMarkers.set(sig, new Set())
      }
    }
  }
  return signalToMarkers
}

interface CompileOptions {
  allowModuleSupport?: boolean
  supportStatements?: string[]
  supportNames?: Set<string>
  dependencies?: string[]
}

function compileSource(source: string, options: CompileOptions = {}): CompileResult {
  registry.clear()

  const ast = parse(source, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  })
  assertTopLevelShape(ast.program, options.allowModuleSupport)
  // same-file-component-composition (ADR-0014, design.md D1): 同一ファイル内
  // の<Component/>参照をfindRootComponentより前にASTインライン化する。以後の
  // パイプラインはコンポーネント合成という概念を一切知らないまま動く。
  const transformedNodes = new Set<t.Node>()
  inlineComponents(ast, transformedNodes)
  const ctx = createCompilerState(source, transformedNodes, options.supportNames)
  collectContextDeclarations(ast, source, ctx)
  for (const supportName of options.supportNames ?? []) ctx.usedOutputNames.add(supportName)
  if (options.allowModuleSupport) collectSharedSignalDeclarations(ast, source, ctx)
  const rootPath = findRootComponent(ast, options.allowModuleSupport === true)

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
      .filter((id) => signalToMarkers.has(id) && !ctx.sharedDeclIds.has(id))
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
  // same-file-component-composition: ローカルハンドラが書き込む局所signalの
  // 所有bodyを、現在bodyから数えた字句スコープ位置で記録する。生成側は
  // 同じfactoryまたは祖先factoryのupdateへ直接つなぐため、ローカルsignalが
  // module scopeのsignalToMarkersへ混ざらない。
  const convertHandler = (h: HandlerDecl, localScopes: Set<DeclId>[] = []): HandlerOutput => {
    const resolveHandlerUpdateCall = (
      ids: Set<DeclId>,
      directCollectionWriteDeclIds: Set<DeclId> = new Set(),
    ) => {
      const plan = resolveUpdateCall(ids, directCollectionWriteDeclIds)
      const localUpdateLevels = localScopes.flatMap((scope, level) =>
        [...ids].some((id) => scope.has(id)) ? [level] : [],
      )
      const localUpdateCalls = [
        ...new Set(
          localUpdateLevels.map((level) =>
            level === 0 ? '__LOCAL_SELF_UPDATE__' : `__LOCAL_ANCESTOR_${level}__`,
          ),
        ),
      ]
        .map((name) => `${name}();`)
        .join(' ')
      return {
        code: [plan.code, localUpdateCalls].filter(Boolean).join(' '),
        needsCollectionBatch: plan.needsCollectionBatch,
      }
    }
    const rendered = h.finalize ? h.finalize(resolveHandlerUpdateCall) : h.rendered
    const plan = resolveUpdatePlan(h.writeDeclIds, h.directCollectionWriteDeclIds)
    const localUpdateLevels = localScopes.flatMap((scope, level) =>
      [...h.writeDeclIds].some((id) => scope.has(id)) ? [level] : [],
    )
    return {
      markerId: h.markerId,
      eventName: h.eventName,
      rendered,
      async: h.async,
      updatesInRendered:
        h.finalize != null && (h.writeDeclIds.size > 0 || h.directCollectionWriteDeclIds.size > 0),
      param: h.param,
      updateNames: plan.updateNames,
      updateBatchName: plan.updateBatchName,
      updateBatchNeedsCollection: plan.needsCollectionBatch,
      localUpdateLevels,
    }
  }

  const convertAction = (
    a: (typeof ctx.actions)[number],
    localScopes: Set<DeclId>[] = [],
  ): ActionOutput => {
    const resolveActionUpdateCall = (
      ids: Set<DeclId>,
      directCollectionWriteDeclIds: Set<DeclId> = new Set(),
    ) => {
      const plan = resolveUpdateCall(ids, directCollectionWriteDeclIds)
      const localUpdateLevels = localScopes.flatMap((scope, level) =>
        [...ids].some((id) => scope.has(id)) ? [level] : [],
      )
      const localUpdateCalls = [
        ...new Set(
          localUpdateLevels.map((level) =>
            level === 0 ? '__LOCAL_SELF_UPDATE__' : `__LOCAL_ANCESTOR_${level}__`,
          ),
        ),
      ]
        .map((name) => `${name}();`)
        .join(' ')
      return {
        code: [plan.code, localUpdateCalls].filter(Boolean).join(' '),
        needsCollectionBatch: plan.needsCollectionBatch,
      }
    }
    return {
      markerId: a.markerId,
      elParam: a.elParam,
      bodyRendered: a.finalizeBody(resolveActionUpdateCall),
      resultRendered: a.finalizeResult ? a.finalizeResult(resolveActionUpdateCall) : null,
    }
  }
  const convertMount = (m: MountDecl, localScopes: Set<DeclId>[] = []): MountOutput => {
    const resolveMountUpdateCall = (
      ids: Set<DeclId>,
      directCollectionWriteDeclIds: Set<DeclId> = new Set(),
    ) => {
      const plan = resolveUpdateCall(ids, directCollectionWriteDeclIds)
      const localUpdateLevels = localScopes.flatMap((scope, level) =>
        [...ids].some((id) => scope.has(id)) ? [level] : [],
      )
      const localUpdateCalls = [
        ...new Set(
          localUpdateLevels.map((level) =>
            level === 0 ? '__LOCAL_SELF_UPDATE__' : `__LOCAL_ANCESTOR_${level}__`,
          ),
        ),
      ]
        .map((name) => `${name}();`)
        .join(' ')
      return {
        code: [plan.code, localUpdateCalls].filter(Boolean).join(' '),
        needsCollectionBatch: plan.needsCollectionBatch,
      }
    }
    return {
      bodyRendered: m.finalizeBody(resolveMountUpdateCall),
      cleanupRendered: m.finalizeCleanup ? m.finalizeCleanup() : null,
    }
  }
  const convertLocalEffect = (effect: (typeof ctx.effects)[number]): LocalEffectOutput => ({
    bodyRendered: effect.finalizeBody(() => ({ code: '', needsCollectionBatch: false })),
    cleanupRendered: effect.finalizeCleanup ? effect.finalizeCleanup() : null,
    signalNames: [
      ...new Set(
        [...effect.readDeclIds]
          .flatMap((dep) => [...resolveToSignals(ctx, dep, new Set())])
          .map((id) => ctx.declOutputName.get(id))
          .filter((name): name is string => name != null),
      ),
    ],
  })
  const handlerOutputs = ctx.handlers.map((h) => convertHandler(h))

  // M5.5: ネストした構造ユニット(body.localMarkers 内の list/conditional)の
  // ローカルハンドラにも同じ変換が要るため、body と marker で相互再帰する。
  const convertUnitMarker = (
    m: ListMarker | ConditionalMarker,
    ancestorLocalScopes: Set<DeclId>[] = [],
  ): ListMarkerOutput | ConditionalMarkerOutput =>
    m.kind === 'list'
      ? {
          ...m,
          collectionOutputName: m.collectionDeclId
            ? ctx.declOutputName.get(m.collectionDeclId)!
            : null,
          body: convertBody(m.body, ancestorLocalScopes),
        }
      : {
          ...m,
          branches: m.branches.map((b) => ({
            body: b.body ? convertBody(b.body, ancestorLocalScopes) : null,
          })),
        }
  const convertBody = (
    body: StructuralUnitBody,
    ancestorLocalScopes: Set<DeclId>[] = [],
  ): StructuralUnitBodyOutput => {
    const localDeclIds = new Set(body.localDecls.map((d) => d.id))
    const localScopes = [localDeclIds, ...ancestorLocalScopes]
    return {
      template: body.template,
      localMarkers: body.localMarkers.map((m) =>
        m.kind === 'text' ? m : convertUnitMarker(m, localScopes),
      ),
      localHandlers: body.localHandlers.map((h) => convertHandler(h, localScopes)),
      localActions: body.localActions.map((a) => convertAction(a, localScopes)),
      localMounts: body.localMounts.map((m) => convertMount(m, localScopes)),
      localEffects: body.localEffects.map(convertLocalEffect),
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
  const actionOutputs: ActionOutput[] = ctx.actions.map((a) => convertAction(a))

  // ADR-0025: onMount callback本体だけはcomponent mount直後の更新を許し、
  // cleanup本体へは更新呼び出しを挿入しない。root component専用なので
  // structural unitのlocal scope変換は不要である。
  const mountOutputs: MountOutput[] = ctx.mounts.map((m: MountDecl) => convertMount(m))
  const effectOutputs: EffectOutput[] = ctx.effects.map((effect) => ({
    bodyRendered: effect.finalizeBody(resolveUpdateCall),
    cleanupRendered: effect.finalizeCleanup ? effect.finalizeCleanup() : null,
    signalIds: [
      ...new Set(
        [...effect.readDeclIds].flatMap((dep) => [...resolveToSignals(ctx, dep, new Set())]),
      ),
    ],
  }))

  // --- ビルド時実行:discovery の確認 + 実際の初期 HTML の取得 ---
  const instrumentedBody = [
    ...(options.supportStatements ?? []),
    ...ctx.sharedDecls.map(
      (decl) =>
        `const ${decl.outputName} = signal(${decl.sourceRendered}, ${JSON.stringify(decl.id)});`,
    ),
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
    async: f.async,
  }))

  const code = generateModule({
    supportStatements: options.supportStatements ?? [],
    sharedStatements: ctx.sharedDecls
      .filter((decl) => ctx.usedSharedDeclIds.has(decl.id))
      .map((decl) => `const ${decl.outputName} = __sharedSignal__(${decl.rendered});`),
    sharedSignalNames: [...signalToMarkers.keys()]
      .filter((id) => ctx.sharedDeclIds.has(id))
      .map((id) => ctx.declOutputName.get(id)!)
      .filter((name): name is string => name != null),
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
    mounts: mountOutputs,
    effects: effectOutputs,
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
    dependencies: options.dependencies ?? [],
  }
}

export function compile(source: string): CompileResult {
  return compileSource(source)
}

// Node側のbuild入口。module graphの読込はここで行い、既存compile(source)の
// 単一文字列APIとsource-onlyテストを変更しない。Vite pluginはentry pathだけを
// 渡し、リンク済みsourceや補助宣言を直接扱わない。
export function compileProject(entryPath: string): CompileResult {
  const linked = linkProject(entryPath)
  return compileSource(linked.source, {
    allowModuleSupport: true,
    supportStatements: linked.supportStatements,
    supportNames: linked.supportNames,
    dependencies: linked.dependencies,
  })
}
