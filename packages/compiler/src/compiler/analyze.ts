// 式の解析:識別子を追跡中の declId に解決し、(a) ビルド時実行用のソース
// (ADR-0001 #3 discovery で使う本物の signal/derived アクセサ呼び出しを保つ)
// と (b) 本番出力用のソース (ADR-0006: signal()/derived() ラッパーを持たない
// ので `count()` のような読み取り呼び出しを裸の識別子 `count` へ書き換える)
// の両方を組み立てる。

import { parse } from '@babel/parser'
import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import { createAstRewrite } from './ast-codegen.ts'
import type { AstRewriteSession } from './ast-codegen.ts'
import { resolveToSignals } from './decl-graph.ts'
import type {
  CompilerState,
  ContextId,
  ContextValue,
  DeclId,
  ResolveUpdateCall,
  TrackedFn,
} from './state.ts'
import { declKey } from './state.ts'

interface Edit {
  start: number
  end: number
  text: string
}

export interface AnalyzeResult {
  deps: Set<DeclId>
  /** 本番出力向け(read call を裸の識別子へ書き換え済み)。 */
  rendered: string
  /** ビルド時実行向け(hygienic rename のみ、read call はそのまま)。 */
  sourceRendered: string
}

export function resolveDeclId(
  ctx: CompilerState,
  idPath: NodePath<t.Identifier>,
  instanceId: number,
): DeclId | null {
  const binding = idPath.scope.getBinding(idPath.node.name)
  if (binding?.path.node.type !== 'VariableDeclarator') return null
  const start = binding.path.node.start
  if (start == null) return null
  return (
    ctx.declIdByKey.get(declKey(instanceId, start, binding.identifier.name)) ??
    ctx.sharedDeclIdByBindingKey.get(`${start}:${binding.identifier.name}`) ??
    null
  )
}

function noteDeclUse(ctx: CompilerState, id: DeclId): void {
  if (ctx.sharedDeclIds.has(id)) ctx.usedSharedDeclIds.add(id)
}

// same-file-component-composition (ADR-0014決定5): 名前衝突時、
// インライン化パスはBabel scopeの`binding.scope.rename()`で識別子を
// リネームする ― `.name`だけが書き換わり`.start`/`.end`(ソース上の位置)は
// 保持される。この関数の呼び出し元は「outputNameとidPath.node.nameが違えば
// 編集する」という判定だけでは、リネーム後の名前がたまたま
// assignOutputNameの結果と一致する場合に編集不要と誤判定し、render()が
// ソーステキスト(リネーム前の古い名前)をそのままスライスしてしまう
// (実装前調査で確認)。ソース上の実際のテキストと現在の名前を比較し、
// 一致しなければ(=リネーム済みなら)常に編集対象に含める。
function identifierNeedsRewrite(
  ctx: CompilerState,
  idPath: NodePath<t.Identifier>,
  outputName: string,
): boolean {
  const { start, end } = idPath.node
  if (start == null || end == null) return true
  return outputName !== idPath.node.name || ctx.source.slice(start, end) !== idPath.node.name
}

// 式のルート自身と、その中で参照されるすべての識別子に visit を適用する。
// (path.traverse はルートノード自体には入らないので、ルートが識別子の場合を
// 別扱いする必要がある。)
function forEachReferencedIdentifier(
  path: NodePath<t.Expression>,
  visit: (idPath: NodePath<t.Identifier>) => void,
): void {
  if (path.isIdentifier()) visit(path)
  path.traverse({
    Identifier(idPath) {
      if (idPath.isReferencedIdentifier()) visit(idPath)
    },
  })
}

function render(source: string, start: number, end: number, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start)
  let out = ''
  let cursor = start
  for (const edit of sorted) {
    out += source.slice(cursor, edit.start) + edit.text
    cursor = edit.end
  }
  out += source.slice(cursor, end)
  return out
}

function pathDepth(path: NodePath<t.Node>): number {
  let depth = 0
  let current: NodePath<t.Node> | null = path
  while (current) {
    depth++
    current = current.parentPath
  }
  return depth
}

// inline-components.tsがprops置換後のクローンへ印を付ける。印を含む式は
// 祖先の式全体までASTコード生成へ切り替える。これにより、置換された識別子の
// start/endが呼び出し元ソースの位置を指していても、呼び出し先の古い文字列を
// 切り出さない。
function usesTransformedAst(ctx: CompilerState, path: NodePath<t.Node>): boolean {
  if (ctx.transformedNodes.has(path.node)) return true
  let found = false
  path.traverse({
    enter(child: NodePath<t.Node>) {
      if (ctx.transformedNodes.has(child.node)) {
        found = true
        child.skip()
      }
    },
  })
  return found
}

function planAstReplacement(
  session: AstRewriteSession,
  targetPath: NodePath<t.Node>,
  root: t.Node,
  build: (get: <T extends t.Node>(original: T) => T) => t.Node,
): void {
  session.replace(
    targetPath.node,
    targetPath.node === root ? null : (targetPath.parentPath?.node ?? null),
    pathDepth(targetPath),
    build,
  )
}

function statementProgram(stmts: NodePath<t.Statement>[]): t.Program {
  return t.program(stmts.map((stmt) => stmt.node))
}

// ネストしたaction本体の最終コードを、外側のASTへ戻すための受け皿。
// concise bodyは`return`を付けたBlockStatementへ正規化する。actionの
// 関数本体では返り値を保ち、ASTコード生成の対象にすることで、ネストした
// スコープを外側の元ソース位置へ再挿入しない。
function parseGeneratedFunctionBody(code: string): t.BlockStatement {
  const trimmed = code.trim()
  const source = trimmed.startsWith('{')
    ? `function __generated__() ${trimmed}`
    : `function __generated__() { return (${trimmed}); }`
  const file = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
  const fn = file.program.body[0]
  if (fn?.type !== 'FunctionDeclaration') {
    throw new Error('compile: failed to parse generated action function body')
  }
  return fn.body
}

// cross-function-handler-writes design D1: ハンドラ/action 本体の識別子巡回で
// 「signal/derived でない識別子の直接呼び出し」を分類する。callee が動きゾーン
// 関数(render 後の function 宣言)と binding 同一なら追跡対象として記録し、
// binding 未解決(グローバル等)は素通し、それ以外(仮引数・ローカル束縛)は
// scope limit で拒否する。追跡した場合、呼び出し式自体は書き換えず callee 名を
// そのまま残す。追跡呼び出しは ADR-0009 D3 の「追跡書き込み」として数えるため
// onWrite で位置を通知する(呼び出しより後ろの return を拒否)。
// 戻り値はこの識別子を callee として処理したか(呼び出し元は編集不要で return)。
function tryHandleTrackedCallee(
  ctx: CompilerState,
  idPath: NodePath<t.Identifier>,
  instanceId: number,
  calleeNames: Set<string>,
  onWrite: (start: number) => void,
  edits: Edit[],
  onRename?: (idPath: NodePath<t.Identifier>, name: string) => void,
): void {
  const parent = idPath.parentPath
  if (!parent?.isCallExpression() || parent.node.callee !== idPath.node) return
  const name = idPath.node.name
  const binding = idPath.scope.getBinding(name)
  if (!binding) return // グローバル → 素通し(従来どおり)
  if (ctx.supportNames.has(name)) return // linked moduleの補助関数/const
  const fn = ctx.movementFns.get(name)
  if (!fn || binding.path.node !== fn.node) {
    throw new Error(
      `compile: calling locally-bound "${name}" from a handler/action body is not supported, only movement-zone functions are tracked (scope limit)`,
    )
  }
  ensureTrackedFn(ctx, name, instanceId)
  calleeNames.add(name)
  onWrite(parent.node.start!)
  // same-file-component-composition: インライン化パスが名前衝突時に
  // callee識別子をリネームする(ADR-0014決定5)と、ノードの`.name`は
  // 更新済みだがソース上の実テキストは元のままになる。追跡呼び出しの
  // callee名は従来「書き換え不要」の前提だったため、ここでも
  // identifierNeedsRewriteで実テキストとの食い違いを検出して edit を積む
  // (実装前調査で確認: リネームされた追跡呼び出しの出力に古い名前が
  // 残ってしまうバグ)。
  if (identifierNeedsRewrite(ctx, idPath, name)) {
    if (onRename) onRename(idPath, name)
    else edits.push({ start: idPath.node.start!, end: idPath.node.end!, text: name })
  }
}

// 追跡対象呼び出し先を1回だけ解析して ctx.trackedFns へ記録する(design D2)。
// 循環(自己/相互再帰)はエントリを本体解析の前に登録することで打ち切る。
function ensureTrackedFn(ctx: CompilerState, name: string, instanceId: number): void {
  if (ctx.trackedFns.has(name)) return
  // design D4/task 3.2: 生成側予約名と衝突する authored 名は黙ってリネームせず拒否。
  if (name.startsWith('__') || name.startsWith('update_')) {
    throw new Error(
      `compile: tracked function "${name}" collides with a generated reserved name (\`update_*\`/\`__\` prefix) (scope limit)`,
    )
  }
  const fnPath = ctx.movementFns.get(name)!
  const params = fnPath.get('params') as NodePath<t.Node>[]
  const paramSource =
    params.length > 0
      ? ctx.source.slice(params[0]!.node.start!, params[params.length - 1]!.node.end!)
      : ''
  // 循環時の再入防止のため、本体解析より前にエントリを登録する。
  const entry: TrackedFn = {
    name,
    paramSource,
    rendered: '',
    async: fnPath.node.async,
    writeDeclIds: new Set(),
    directCollectionWriteDeclIds: new Set(),
    calleeNames: new Set(),
  }
  ctx.trackedFns.set(name, entry)
  const stmts = fnPath.get('body.body') as NodePath<t.Statement>[]
  const core = analyzeHandlerStatementsCore(ctx, stmts, instanceId)
  entry.rendered = core.rendered
  entry.writeDeclIds = core.writeDeclIds
  entry.directCollectionWriteDeclIds = core.directCollectionWriteDeclIds
  entry.calleeNames = core.calleeNames
}

// 呼び出しグラフを visited-set で辿り、名前集合から到達可能な追跡関数の
// 直接書き込み(root signal)を推移的に集める(循環安全)。
function collectTransitiveWrites(
  ctx: CompilerState,
  names: Set<string>,
  out: Set<DeclId>,
  directCollectionOut: Set<DeclId> = new Set(),
  visited: Set<string> = new Set(),
): void {
  for (const name of names) {
    if (visited.has(name)) continue
    visited.add(name)
    const fn = ctx.trackedFns.get(name)
    if (!fn) continue
    for (const w of fn.writeDeclIds) out.add(w)
    for (const w of fn.directCollectionWriteDeclIds) directCollectionOut.add(w)
    collectTransitiveWrites(ctx, fn.calleeNames, out, directCollectionOut, visited)
  }
}

// ハンドラ本体(文配列)の中核解析。読み取り書き換え・書き込み代入化・
// 追跡呼び出し検出・D3(追跡書き込み後の return 拒否)を行い、書き換え済み
// テキスト・直接書き込み root signal・直接 callee 名を返す。update_*() の合流は
// 呼び出し元(analyzeHandlerBody / ハンドラ末尾)に任せるためここでは行わない。
function analyzeHandlerStatementsCore(
  ctx: CompilerState,
  stmts: NodePath<t.Statement>[],
  instanceId: number,
): {
  rendered: string
  writeDeclIds: Set<DeclId>
  directCollectionWriteDeclIds: Set<DeclId>
  calleeNames: Set<string>
} {
  for (const stmt of stmts) validateHandlerStatement(stmt)

  if (stmts.length === 0) {
    return {
      rendered: '',
      writeDeclIds: new Set(),
      directCollectionWriteDeclIds: new Set(),
      calleeNames: new Set(),
    }
  }

  const writeDeclIds = new Set<DeclId>()
  const directCollectionWriteDeclIds = new Set<DeclId>()
  const calleeNames = new Set<string>()
  const edits: Edit[] = []
  const astRoot = statementProgram(stmts)
  const ast = stmts.some((stmt) => usesTransformedAst(ctx, stmt as NodePath<t.Node>))
    ? createAstRewrite(astRoot)
    : null
  for (const stmt of stmts) {
    collectContextCalls(ctx, stmt as NodePath<t.Node>, new Set(), edits, null, ast, null, astRoot)
  }
  let firstWriteStart: number | null = null
  const noteWrite = (pos: number) => {
    if (firstWriteStart == null || pos < firstWriteStart) firstWriteStart = pos
  }

  const visit = (idPath: NodePath<t.Identifier>) => {
    const id = resolveDeclId(ctx, idPath, instanceId)
    if (!id) {
      tryHandleTrackedCallee(
        ctx,
        idPath,
        instanceId,
        calleeNames,
        noteWrite,
        edits,
        ast ? (path, name) => ast.rename(path.node, name) : undefined,
      )
      return
    }
    noteDeclUse(ctx, id)
    const outputName = ctx.declOutputName.get(id)
    if (!outputName) return

    const parent = idPath.parentPath
    const memberCall = parent?.isMemberExpression() ? parent.parentPath : null
    if (ctx.sharedDeclIds.has(id)) {
      if (parent?.isCallExpression() && parent.node.callee === idPath.node) {
        if (ctx.declKind.get(id) === 'derived' && parent.node.arguments.length > 0) {
          throw new Error(
            `compile: module shared derived "${idPath.node.name}" is read-only (scope limit)`,
          )
        }
        if (parent.node.arguments.length > 1) {
          throw new Error(
            `compile: signal writes take exactly one argument, got ${parent.node.arguments.length} for "${idPath.node.name}" (scope limit)`,
          )
        }
        if (parent.node.arguments.length === 1) noteWrite(parent.node.start!)
      }
      return
    }
    if (
      ctx.declKind.get(id) === 'collection' &&
      parent?.isMemberExpression() &&
      !parent.node.computed &&
      parent.get('property').isIdentifier({ name: 'update' }) &&
      memberCall?.isCallExpression() &&
      memberCall.node.callee === parent.node
    ) {
      if (memberCall.node.arguments.length !== 2) {
        throw new Error(
          `compile: collection.update() takes exactly a key and an updater for "${idPath.node.name}"`,
        )
      }
      const firstArg = memberCall.node.arguments[0]!
      edits.push({
        start: idPath.node.start!,
        end: firstArg.start!,
        text: `update_${outputName}_item(`,
      })
      // collection.update() は専用の直接通知経路を持つ。別のroot writeと
      // 同一スコープで実行される場合だけ、compiler.ts がこの集合をbatchへ
      // 組み込む。
      for (const sig of resolveToSignals(ctx, id, new Set())) {
        directCollectionWriteDeclIds.add(sig)
      }
      noteWrite(memberCall.node.start!)
      if (ast) {
        const memberCallPath = memberCall as NodePath<t.CallExpression>
        planAstReplacement(ast, memberCallPath, astRoot, (get) =>
          t.callExpression(t.identifier(`update_${outputName}_item`), [
            get(firstArg as t.Expression) as t.Expression,
            get(memberCall.node.arguments[1] as t.Expression) as t.Expression,
          ]),
        )
      }
      return
    }
    if (parent?.isCallExpression() && parent.node.callee === idPath.node) {
      if (parent.node.arguments.length === 0) {
        edits.push({
          start: parent.node.start!,
          end: parent.node.end!,
          text: outputName,
        })
        if (ast) {
          planAstReplacement(ast, parent as NodePath<t.CallExpression>, astRoot, () =>
            t.identifier(outputName),
          )
        }
        return
      }
      if (parent.node.arguments.length > 1) {
        throw new Error(
          `compile: signal writes take exactly one argument, got ${parent.node.arguments.length} for "${idPath.node.name}" (scope limit)`,
        )
      }
      if (ctx.declKind.get(id) === 'derived') {
        throw new Error(`compile: cannot write to derived "${idPath.node.name}"`)
      }
      const arg = parent.node.arguments[0]!
      edits.push({
        start: parent.node.start!,
        end: arg.start!,
        text:
          ctx.declKind.get(id) === 'collection'
            ? `${outputName} = __replaceCollection__(__collection_${outputName}__, `
            : `${outputName} = `,
      })
      edits.push({
        start: arg.end!,
        end: parent.node.end!,
        text: ctx.declKind.get(id) === 'collection' ? ')' : '',
      })
      if (ast) {
        const callPath = parent as NodePath<t.CallExpression>
        planAstReplacement(ast, callPath, astRoot, (get) => {
          const arg = parent.node.arguments[0] as t.Expression
          const value = get(arg) as t.Expression
          const rhs =
            ctx.declKind.get(id) === 'collection'
              ? t.callExpression(t.identifier('__replaceCollection__'), [
                  t.identifier(`__collection_${outputName}__`),
                  value,
                ])
              : value
          return t.assignmentExpression('=', t.identifier(outputName), rhs)
        })
      }
      noteWrite(parent.node.start!)
      for (const sig of resolveToSignals(ctx, id, new Set())) writeDeclIds.add(sig)
      return
    }

    if (identifierNeedsRewrite(ctx, idPath, outputName)) {
      edits.push({
        start: idPath.node.start!,
        end: idPath.node.end!,
        text: outputName,
      })
      if (ast) ast.rename(idPath.node, outputName)
    }
  }

  for (const stmt of stmts) {
    stmt.traverse({
      Identifier(idPath) {
        if (idPath.isReferencedIdentifier()) visit(idPath)
      },
    })
  }

  if (firstWriteStart != null) {
    const returnStarts: number[] = []
    for (const stmt of stmts) collectReturnStarts(stmt, returnStarts)
    if (returnStarts.some((start) => start > firstWriteStart!)) {
      throw new Error(
        'compile: a `return` after a tracked signal write is not supported, the write would be lost (scope limit)',
      )
    }
  }

  return {
    rendered: ast
      ? ast.generate()
      : render(ctx.source, stmts[0]!.node.start!, stmts[stmts.length - 1]!.node.end!, edits),
    writeDeclIds,
    directCollectionWriteDeclIds,
    calleeNames,
  }
}

function resolveContextId(ctx: CompilerState, keyPath: NodePath<t.Expression>): ContextId | null {
  if (!keyPath.isIdentifier()) return null
  const binding = keyPath.scope.getBinding(keyPath.node.name)
  if (!binding || binding.path.node.type !== 'VariableDeclarator') return null
  const start = binding.path.node.start
  if (start == null) return null
  return ctx.contextIdByKey.get(`${start}:${binding.identifier.name}`) ?? null
}

function parseGeneratedExpression(code: string): t.Expression {
  const parsed = parse(`(${code})`, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
  const statement = parsed.program.body[0]
  if (statement?.type !== 'ExpressionStatement') {
    throw new Error('compile: failed to parse generated context expression')
  }
  return statement.expression
}

function contextValueForCall(
  ctx: CompilerState,
  callPath: NodePath<t.CallExpression>,
): ContextValue | null {
  const callee = callPath.node.callee
  if (callee.type !== 'Identifier' || callee.name !== 'useContext') return null
  const args = callPath.get('arguments')
  if (args.length !== 1 || !args[0]!.isExpression()) {
    throw new Error('compile: useContext() takes exactly one context key (scope limit)')
  }
  const contextId = resolveContextId(ctx, args[0] as NodePath<t.Expression>)
  if (!contextId) {
    throw new Error(
      'compile: useContext() key must be a createContext()/createAsyncContext() binding (scope limit)',
    )
  }
  const provided = ctx.contextValues.get(contextId)
  if (provided) return provided
  const declared = ctx.contexts.get(contextId)
  if (declared) {
    return {
      rendered: declared.defaultRendered,
      sourceRendered: declared.defaultSourceRendered,
      deps: new Set(),
    }
  }
  throw new Error('compile: useContext() context key was not collected (scope limit)')
}

function collectContextCalls(
  ctx: CompilerState,
  path: NodePath<t.Node>,
  deps: Set<DeclId>,
  outputEdits: Edit[],
  sourceEdits: Edit[] | null,
  outputAst: AstRewriteSession | null,
  sourceAst: AstRewriteSession | null,
  root: t.Node,
): void {
  const visitCall = (callPath: NodePath<t.CallExpression>): void => {
    const value = contextValueForCall(ctx, callPath)
    if (!value) return
    for (const dep of value.deps) deps.add(dep)
    outputEdits.push({
      start: callPath.node.start!,
      end: callPath.node.end!,
      text: value.rendered,
    })
    sourceEdits?.push({
      start: callPath.node.start!,
      end: callPath.node.end!,
      text: value.sourceRendered,
    })
    if (outputAst) {
      planAstReplacement(outputAst, callPath, root, () => parseGeneratedExpression(value.rendered))
    }
    if (sourceAst) {
      planAstReplacement(sourceAst, callPath, root, () =>
        parseGeneratedExpression(value.sourceRendered),
      )
    }
  }
  if (path.isCallExpression()) visitCall(path as NodePath<t.CallExpression>)
  path.traverse({
    CallExpression(callPath) {
      visitCall(callPath)
    },
  })
}

export function analyzeExpr(
  ctx: CompilerState,
  path: NodePath<t.Expression>,
  instanceId: number,
): AnalyzeResult {
  const deps = new Set<DeclId>()
  const outputEdits: Edit[] = []
  const sourceEdits: Edit[] = []
  const useAst = usesTransformedAst(ctx, path as NodePath<t.Node>)
  const sourceAst = useAst ? createAstRewrite(path.node) : null
  const outputAst = useAst ? createAstRewrite(path.node) : null

  collectContextCalls(ctx, path, deps, outputEdits, sourceEdits, outputAst, sourceAst, path.node)

  const visit = (idPath: NodePath<t.Identifier>) => {
    const id = resolveDeclId(ctx, idPath, instanceId)
    if (!id) return
    noteDeclUse(ctx, id)
    deps.add(id)
    const outputName = ctx.declOutputName.get(id)
    if (!outputName) return

    const idStart = idPath.node.start!
    const idEnd = idPath.node.end!
    if (identifierNeedsRewrite(ctx, idPath, outputName)) {
      sourceEdits.push({ start: idStart, end: idEnd, text: outputName })
      if (sourceAst) sourceAst.rename(idPath.node, outputName)
    }

    // `count()` のような追跡済み signal/derived への引数なし呼び出しは
    // 「読み取り」-- 本番出力では裸の識別子そのものが読み取りなので、
    // 呼び出し全体を出力名へ書き換える(ADR-0006)。ビルド時実行では
    // count はまだ本物のアクセサ関数なので、呼び出し構文は保つ。
    const parent = idPath.parentPath
    if (
      parent?.isCallExpression() &&
      parent.node.callee === idPath.node &&
      parent.node.arguments.length === 0
    ) {
      if (!ctx.sharedDeclIds.has(id)) {
        outputEdits.push({
          start: parent.node.start!,
          end: parent.node.end!,
          text: outputName,
        })
        if (outputAst) {
          planAstReplacement(outputAst, parent as NodePath<t.CallExpression>, path.node, () =>
            t.identifier(outputName),
          )
        }
      }
      return
    }

    if (identifierNeedsRewrite(ctx, idPath, outputName)) {
      outputEdits.push({ start: idStart, end: idEnd, text: outputName })
      if (outputAst) outputAst.rename(idPath.node, outputName)
    }
  }

  forEachReferencedIdentifier(path, visit)

  const start = path.node.start!
  const end = path.node.end!
  return {
    deps,
    rendered: outputAst ? outputAst.generate() : render(ctx.source, start, end, outputEdits),
    sourceRendered: sourceAst ? sourceAst.generate() : render(ctx.source, start, end, sourceEdits),
  }
}

export interface HandlerAnalysis {
  /** 出力向け(書き込み呼び出しを代入文へ書き換え済み)。 */
  rendered: string
  /** signalToMarkers確定後に本体と入れ子関数の更新文を挿入する。 */
  finalize: (resolveUpdateCall: ResolveUpdateCall) => string
  /** このハンドラが書き込む root signal の declId 集合(推移解決済み)。 */
  writeDeclIds: Set<DeclId>
  directCollectionWriteDeclIds: Set<DeclId>
}

// ハンドラ本体専用の解析。analyzeExpr と同じ識別子巡回を行うが、追跡済み
// identifier への「引数1個の呼び出し」を書き込みとして特別扱いする
// (M2: `count(count() + 1)` -> `count = count + 1`)。ADR-0006 により出力側
// では count はプレーン変数なので、書き込みは呼び出しの再実行ではなく
// 代入で表現する。呼び出し全体を1つの edit で置き換えるのではなく、
// 「callee+開き括弧」と「閉じ括弧」の2つの edit に分けることで、引数式
// 内部のネストした読み取り/書き込みは同じ traverse パスに任せて解決させる。
export function analyzeHandlerExpr(
  ctx: CompilerState,
  exprPath: NodePath<t.Expression>,
  instanceId: number,
): HandlerAnalysis {
  const writeDeclIds = new Set<DeclId>()
  const directCollectionWriteDeclIds = new Set<DeclId>()
  const calleeNames = new Set<string>()
  const edits: Edit[] = []
  const nestedScopes: ReturnType<typeof analyzeFunctionBodyScope>[] = []
  const ast = usesTransformedAst(ctx, exprPath as NodePath<t.Node>)
    ? createAstRewrite(exprPath.node)
    : null
  collectContextCalls(ctx, exprPath, new Set(), edits, null, ast, null, exprPath.node)

  const visit = (idPath: NodePath<t.Identifier>) => {
    const id = resolveDeclId(ctx, idPath, instanceId)
    if (!id) {
      // cross-function-handler-writes: 単一式ハンドラ本体(`() => toggle(id)`)
      // からの動きゾーン関数呼び出しを追跡する(D3 は式1つなので該当なし)。
      tryHandleTrackedCallee(
        ctx,
        idPath,
        instanceId,
        calleeNames,
        () => {},
        edits,
        ast ? (path, name) => ast.rename(path.node, name) : undefined,
      )
      return
    }
    noteDeclUse(ctx, id)
    const outputName = ctx.declOutputName.get(id)
    if (!outputName) return

    const parent = idPath.parentPath
    const memberCall = parent?.isMemberExpression() ? parent.parentPath : null
    if (ctx.sharedDeclIds.has(id)) {
      if (parent?.isCallExpression() && parent.node.callee === idPath.node) {
        if (ctx.declKind.get(id) === 'derived' && parent.node.arguments.length > 0) {
          throw new Error(
            `compile: module shared derived "${idPath.node.name}" is read-only (scope limit)`,
          )
        }
        if (parent.node.arguments.length > 1) {
          throw new Error(
            `compile: signal writes take exactly one argument, got ${parent.node.arguments.length} for "${idPath.node.name}" (scope limit)`,
          )
        }
      }
      return
    }
    if (
      ctx.declKind.get(id) === 'collection' &&
      parent?.isMemberExpression() &&
      !parent.node.computed &&
      parent.get('property').isIdentifier({ name: 'update' }) &&
      memberCall?.isCallExpression() &&
      memberCall.node.callee === parent.node
    ) {
      if (memberCall.node.arguments.length !== 2) {
        throw new Error(
          `compile: collection.update() takes exactly a key and an updater for "${idPath.node.name}"`,
        )
      }
      const firstArg = memberCall.node.arguments[0]!
      edits.push({
        start: idPath.node.start!,
        end: firstArg.start!,
        text: `update_${outputName}_item(`,
      })
      for (const sig of resolveToSignals(ctx, id, new Set())) {
        directCollectionWriteDeclIds.add(sig)
      }
      if (ast) {
        const memberCallPath = memberCall as NodePath<t.CallExpression>
        planAstReplacement(ast, memberCallPath, exprPath.node, (get) =>
          t.callExpression(t.identifier(`update_${outputName}_item`), [
            get(firstArg as t.Expression) as t.Expression,
            get(memberCall.node.arguments[1] as t.Expression) as t.Expression,
          ]),
        )
      }
      return
    }
    if (parent?.isCallExpression() && parent.node.callee === idPath.node) {
      if (parent.node.arguments.length === 0) {
        edits.push({
          start: parent.node.start!,
          end: parent.node.end!,
          text: outputName,
        })
        if (ast) {
          planAstReplacement(ast, parent as NodePath<t.CallExpression>, exprPath.node, () =>
            t.identifier(outputName),
          )
        }
        return
      }
      if (parent.node.arguments.length > 1) {
        throw new Error(
          `compile: signal writes take exactly one argument, got ${parent.node.arguments.length} for "${idPath.node.name}" (scope limit)`,
        )
      }
      if (ctx.declKind.get(id) === 'derived') {
        throw new Error(`compile: cannot write to derived "${idPath.node.name}"`)
      }
      const arg = parent.node.arguments[0]!
      edits.push({
        start: parent.node.start!,
        end: arg.start!,
        text:
          ctx.declKind.get(id) === 'collection'
            ? `${outputName} = __replaceCollection__(__collection_${outputName}__, `
            : `${outputName} = `,
      })
      edits.push({
        start: arg.end!,
        end: parent.node.end!,
        text: ctx.declKind.get(id) === 'collection' ? ')' : '',
      })
      if (ast) {
        const callPath = parent as NodePath<t.CallExpression>
        planAstReplacement(ast, callPath, exprPath.node, (get) => {
          const arg = parent.node.arguments[0] as t.Expression
          const value = get(arg) as t.Expression
          const rhs =
            ctx.declKind.get(id) === 'collection'
              ? t.callExpression(t.identifier('__replaceCollection__'), [
                  t.identifier(`__collection_${outputName}__`),
                  value,
                ])
              : value
          return t.assignmentExpression('=', t.identifier(outputName), rhs)
        })
      }
      for (const sig of resolveToSignals(ctx, id, new Set())) writeDeclIds.add(sig)
      return
    }

    if (identifierNeedsRewrite(ctx, idPath, outputName)) {
      edits.push({
        start: idPath.node.start!,
        end: idPath.node.end!,
        text: outputName,
      })
      if (ast) ast.rename(idPath.node, outputName)
    }
  }

  const captureNested = (
    fnPath: NodePath<t.FunctionExpression | t.ArrowFunctionExpression | t.ObjectMethod>,
  ) => {
    nestedScopes.push(analyzeFunctionBodyScope(ctx, fnPath, instanceId, false, false))
    fnPath.skip()
  }
  if (exprPath.isIdentifier()) visit(exprPath)
  exprPath.traverse({
    Identifier(idPath) {
      if (idPath.isReferencedIdentifier()) visit(idPath)
    },
    FunctionExpression: captureNested,
    ArrowFunctionExpression: captureNested,
    ObjectMethod: captureNested,
  })
  collectTransitiveWrites(ctx, calleeNames, writeDeclIds, directCollectionWriteDeclIds)

  const allWriteDeclIds = new Set(writeDeclIds)
  const allCollectionWriteDeclIds = new Set(directCollectionWriteDeclIds)
  for (const child of nestedScopes) {
    for (const id of child.writeDeclIds) allWriteDeclIds.add(id)
    for (const id of child.allCollectionWriteDeclIds) allCollectionWriteDeclIds.add(id)
  }

  const rendered = ast
    ? ast.generate()
    : render(ctx.source, exprPath.node.start!, exprPath.node.end!, edits)

  return {
    rendered,
    finalize: (resolveUpdateCall) => {
      const allEdits = [...edits]
      for (const child of nestedScopes) {
        const childCode = child.finalize(resolveUpdateCall)
        allEdits.push({
          start: child.start,
          end: child.end,
          text: childCode,
        })
        if (ast) {
          ast.replace(child.node, child.parent, child.depth, () =>
            parseGeneratedFunctionBody(childCode),
          )
        }
      }
      const rendered = ast
        ? ast.generate()
        : render(ctx.source, exprPath.node.start!, exprPath.node.end!, allEdits)
      const updateCall = resolveUpdateCall(writeDeclIds, directCollectionWriteDeclIds)
      if (!updateCall.code) return rendered
      if (updateCall.needsCollectionBatch) {
        return `{ __update_batch_depth__++; try { ${rendered}; } finally { __update_batch_depth__--; } ${updateCall.code} }`
      }
      return `${rendered}; ${updateCall.code}`
    },
    writeDeclIds: allWriteDeclIds,
    directCollectionWriteDeclIds: allCollectionWriteDeclIds,
  }
}

// ADR-0009 D2: IfStatement の consequent/alternate は「4文種そのもの」か
// 「4文種のみからなる BlockStatement」のどちらか。両形を同じ文配列へ均す。
function eachBranchStatement(branch: NodePath<t.Statement>): NodePath<t.Statement>[] {
  return branch.isBlockStatement() ? (branch.get('body') as NodePath<t.Statement>[]) : [branch]
}

// ADR-0009 D2/質問2: 4文種(式文 / const・let / if / 裸の return)以外・
// var・値を返す return を compile error で拒否する。if の枝は再帰検証する。
// allowValueReturn: ADR-0011 design D4-1。action本体にネストした関数式/arrow
// 自身の return は「通常の関数の返り値」でありこの規則の対象外(design.md
// Decision 4-1)なので、その本体を検証する再帰呼び出しでのみ true を渡す。
// allowThrow: actionのdestroy/初期化失敗を検証するため、action解析だけが明示的に
// trueを渡す。通常のhandler・追跡functionはADR-0009の4文種を維持する。
function validateHandlerStatement(
  stmt: NodePath<t.Statement>,
  allowValueReturn = false,
  allowThrow = false,
): void {
  if (stmt.isExpressionStatement()) return
  if (stmt.isVariableDeclaration()) {
    if (stmt.node.kind === 'var') {
      throw new Error(
        'compile: `var` declarations are not supported in handler bodies, use `const`/`let` (scope limit)',
      )
    }
    return
  }
  if (stmt.isReturnStatement()) {
    if (stmt.node.argument != null && !allowValueReturn) {
      throw new Error('compile: a handler `return` must not return a value (scope limit)')
    }
    return
  }
  if (stmt.isThrowStatement()) {
    if (!allowThrow) {
      throw new Error(
        `compile: handler statement "${stmt.node.type}" is not supported yet (scope limit)`,
      )
    }
    return
  }
  if (stmt.isIfStatement()) {
    for (const s of eachBranchStatement(stmt.get('consequent') as NodePath<t.Statement>)) {
      validateHandlerStatement(s, allowValueReturn, allowThrow)
    }
    const alt = stmt.get('alternate')
    if (alt.node) {
      for (const s of eachBranchStatement(alt as NodePath<t.Statement>)) {
        validateHandlerStatement(s, allowValueReturn, allowThrow)
      }
    }
    return
  }
  throw new Error(
    `compile: handler statement "${stmt.node.type}" is not supported yet (scope limit)`,
  )
}

// ADR-0009 D3: ソース順で最初の追跡書き込みより後ろに return があると
// update_*() の取りこぼしが起きるため拒否する。分岐内の return も対象。
function collectReturnStarts(stmt: NodePath<t.Statement>, out: number[]): void {
  if (stmt.isReturnStatement()) {
    out.push(stmt.node.start!)
    return
  }
  if (stmt.isIfStatement()) {
    for (const s of eachBranchStatement(stmt.get('consequent') as NodePath<t.Statement>)) {
      collectReturnStarts(s, out)
    }
    const alt = stmt.get('alternate')
    if (alt.node) {
      for (const s of eachBranchStatement(alt as NodePath<t.Statement>)) {
        collectReturnStarts(s, out)
      }
    }
  }
}

// analyzeHandlerExpr の文レベル版(design D5)。単一式向けの visit をそのまま
// 文配列へ広げるだけで、読み取り書き換え・書き込み代入化・writeDeclIds 収集の
// ロジックは共有する。edit の適用範囲は「最初の文の start 〜最後の文の end」。
export function analyzeHandlerBody(
  ctx: CompilerState,
  stmts: NodePath<t.Statement>[],
  instanceId: number,
): HandlerAnalysis {
  if (stmts.length === 0) {
    return {
      rendered: '',
      finalize: () => '',
      writeDeclIds: new Set(),
      directCollectionWriteDeclIds: new Set(),
    }
  }
  // handlerはactionと同じ関数境界解析を使うが、値を返すreturn・throw・
  // 親スコープへの入れ子書き込み合流は受理しない。各callback自身の実行後に
  // 更新を置くことで、Promise完了前の親更新を発火させない。
  const scope = analyzeActionStatements(ctx, stmts, instanceId, false, false, false, false)
  return {
    rendered: scope.finalize(NO_ACTION_UPDATE),
    finalize: scope.finalize,
    writeDeclIds: scope.writeDeclIds,
    directCollectionWriteDeclIds: scope.allCollectionWriteDeclIds,
  }
}

// ADR-0011: action本体・ネストした関数本体・返り値クロージャで共有する
// 識別子1個ぶんの解析(analyzeHandlerExpr/analyzeHandlerBody の visit と同じ
// 読み取り書き換え・書き込みの assignment 化)。書き込みの発生位置は D3
// (return-after-write)判定のため呼び出し元へ onWrite で通知する。
function analyzeActionIdentifier(
  ctx: CompilerState,
  instanceId: number,
  idPath: NodePath<t.Identifier>,
  edits: Edit[],
  readDeclIds: Set<DeclId>,
  writeDeclIds: Set<DeclId>,
  directCollectionWriteDeclIds: Set<DeclId>,
  onWrite: (start: number) => void,
  calleeNames: Set<string>,
  root: t.Node,
  ast?: AstRewriteSession | null,
  trackSharedWrites = true,
): void {
  const id = resolveDeclId(ctx, idPath, instanceId)
  if (!id) {
    // cross-function-handler-writes: action 本体からの動きゾーン関数呼び出しも
    // ハンドラと同じ規則で追跡する(onWrite で D3 の追跡書き込み位置を通知)。
    tryHandleTrackedCallee(
      ctx,
      idPath,
      instanceId,
      calleeNames,
      onWrite,
      edits,
      ast ? (path, name) => ast.rename(path.node, name) : undefined,
    )
    return
  }
  noteDeclUse(ctx, id)
  const outputName = ctx.declOutputName.get(id)
  if (!outputName) return

  const parent = idPath.parentPath
  const memberCall = parent?.isMemberExpression() ? parent.parentPath : null
  if (ctx.sharedDeclIds.has(id)) {
    if (parent?.isCallExpression() && parent.node.callee === idPath.node) {
      if (ctx.declKind.get(id) === 'derived' && parent.node.arguments.length > 0) {
        throw new Error(
          `compile: module shared derived "${idPath.node.name}" is read-only (scope limit)`,
        )
      }
      if (parent.node.arguments.length > 1) {
        throw new Error(
          `compile: signal writes take exactly one argument, got ${parent.node.arguments.length} for "${idPath.node.name}" (scope limit)`,
        )
      }
      if (parent.node.arguments.length === 0) readDeclIds.add(id)
      else if (trackSharedWrites) {
        writeDeclIds.add(id)
        onWrite(parent.node.start!)
      }
    } else {
      readDeclIds.add(id)
    }
    return
  }
  if (
    ctx.declKind.get(id) === 'collection' &&
    parent?.isMemberExpression() &&
    !parent.node.computed &&
    parent.get('property').isIdentifier({ name: 'update' }) &&
    memberCall?.isCallExpression() &&
    memberCall.node.callee === parent.node
  ) {
    if (memberCall.node.arguments.length !== 2) {
      throw new Error(
        `compile: collection.update() takes exactly a key and an updater for "${idPath.node.name}"`,
      )
    }
    const firstArg = memberCall.node.arguments[0]!
    edits.push({
      start: idPath.node.start!,
      end: firstArg.start!,
      text: `update_${outputName}_item(`,
    })
    for (const sig of resolveToSignals(ctx, id, new Set())) {
      directCollectionWriteDeclIds.add(sig)
    }
    onWrite(memberCall.node.start!)
    if (ast) {
      const memberCallPath = memberCall as NodePath<t.CallExpression>
      planAstReplacement(ast, memberCallPath, root, (get) =>
        t.callExpression(t.identifier(`update_${outputName}_item`), [
          get(firstArg as t.Expression) as t.Expression,
          get(memberCall.node.arguments[1] as t.Expression) as t.Expression,
        ]),
      )
    }
    return
  }
  if (parent?.isCallExpression() && parent.node.callee === idPath.node) {
    if (parent.node.arguments.length === 0) {
      readDeclIds.add(id)
      edits.push({
        start: parent.node.start!,
        end: parent.node.end!,
        text: outputName,
      })
      if (ast) {
        planAstReplacement(ast, parent as NodePath<t.CallExpression>, root, () =>
          t.identifier(outputName),
        )
      }
      return
    }
    if (parent.node.arguments.length > 1) {
      throw new Error(
        `compile: signal writes take exactly one argument, got ${parent.node.arguments.length} for "${idPath.node.name}" (scope limit)`,
      )
    }
    if (ctx.declKind.get(id) === 'derived') {
      throw new Error(`compile: cannot write to derived "${idPath.node.name}"`)
    }
    const arg = parent.node.arguments[0]!
    edits.push({
      start: parent.node.start!,
      end: arg.start!,
      text:
        ctx.declKind.get(id) === 'collection'
          ? `${outputName} = __replaceCollection__(__collection_${outputName}__, `
          : `${outputName} = `,
    })
    edits.push({
      start: arg.end!,
      end: parent.node.end!,
      text: ctx.declKind.get(id) === 'collection' ? ')' : '',
    })
    if (ast) {
      const callPath = parent as NodePath<t.CallExpression>
      planAstReplacement(ast, callPath, root, (get) => {
        const value = get(arg as t.Expression) as t.Expression
        const rhs =
          ctx.declKind.get(id) === 'collection'
            ? t.callExpression(t.identifier('__replaceCollection__'), [
                t.identifier(`__collection_${outputName}__`),
                value,
              ])
            : value
        return t.assignmentExpression('=', t.identifier(outputName), rhs)
      })
    }
    for (const sig of resolveToSignals(ctx, id, new Set())) writeDeclIds.add(sig)
    onWrite(parent.node.start!)
    return
  }

  readDeclIds.add(id)
  if (identifierNeedsRewrite(ctx, idPath, outputName)) {
    edits.push({
      start: idPath.node.start!,
      end: idPath.node.end!,
      text: outputName,
    })
    if (ast) ast.rename(idPath.node, outputName)
  }
}

interface ActionScopeAnalysis {
  /** signalToMarkers 確定後に、このスコープ末尾へ挿入する update_* 呼び出し
   * (design Decision 5)込みの最終テキストを組み立てる。 */
  finalize: (resolveUpdateCall: ResolveUpdateCall) => string
  /** このスコープが直接読む signal/derived(推移解決前)。クロージャの依存
   * 解析にのみ使う。 */
  readDeclIds: Set<DeclId>
  /** このスコープ自身が直接書き込む宣言。入れ子関数の更新位置を分けるために使う。 */
  directWriteDeclIds: Set<DeclId>
  directCollectionWriteDeclIds: Set<DeclId>
  /** このスコープと内側の関数が書き込む宣言。 */
  writeDeclIds: Set<DeclId>
  allCollectionWriteDeclIds: Set<DeclId>
}

// action本体・ネストした関数本体で共有する文配列の解析(design D4-1)。
// ADR-0009 の4文種検証+書き込み書き換えを土台に、ネストした関数式/arrow
// を見つけるたびに analyzeFunctionBodyScope へ再帰し、その本体全体を
// 1つの edit(finalize 済みテキストへの置換)として扱う -- 「外側を分割して
// 内側は同じ traverse パスに解決させる」(docs/conventions.md)の応用。
// これにより、ネストしたスコープ自身の update_* 呼び出しは、そのスコープが
// 実際に実行されるたび(例: リスナー発火時)に評価される。
function analyzeActionStatements(
  ctx: CompilerState,
  stmts: NodePath<t.Statement>[],
  instanceId: number,
  allowValueReturn: boolean,
  allowThrow = true,
  includeNestedWritesInTail = true,
  trackSharedWrites = true,
): ActionScopeAnalysis {
  for (const stmt of stmts) validateHandlerStatement(stmt, allowValueReturn, allowThrow)

  const readDeclIds = new Set<DeclId>()
  const directWriteDeclIds = new Set<DeclId>()
  const directCollectionWriteDeclIds = new Set<DeclId>()
  const calleeNames = new Set<string>()
  const edits: Edit[] = []
  const nestedScopes: ReturnType<typeof analyzeFunctionBodyScope>[] = []
  const astRoot = statementProgram(stmts)
  const ast = stmts.some((stmt) => usesTransformedAst(ctx, stmt as NodePath<t.Node>))
    ? createAstRewrite(astRoot)
    : null
  for (const stmt of stmts) {
    collectContextCalls(ctx, stmt as NodePath<t.Node>, readDeclIds, edits, null, ast, null, astRoot)
  }
  let firstWriteStart: number | null = null

  const visit = (idPath: NodePath<t.Identifier>) =>
    analyzeActionIdentifier(
      ctx,
      instanceId,
      idPath,
      edits,
      readDeclIds,
      directWriteDeclIds,
      directCollectionWriteDeclIds,
      (pos) => {
        if (firstWriteStart == null || pos < firstWriteStart) {
          firstWriteStart = pos
        }
      },
      calleeNames,
      astRoot,
      ast,
      trackSharedWrites,
    )

  const captureNested = (
    fnPath: NodePath<t.FunctionExpression | t.ArrowFunctionExpression | t.ObjectMethod>,
  ) => {
    nestedScopes.push(
      analyzeFunctionBodyScope(
        ctx,
        fnPath,
        instanceId,
        includeNestedWritesInTail,
        trackSharedWrites,
      ),
    )
    fnPath.skip()
  }

  for (const stmt of stmts) {
    stmt.traverse({
      Identifier(idPath) {
        if (idPath.isReferencedIdentifier()) visit(idPath)
      },
      FunctionExpression: captureNested,
      ArrowFunctionExpression: captureNested,
      ObjectMethod: captureNested,
    })
  }

  // ADR-0009 D3: このスコープ自身のトップレベルで、追跡書き込みより後ろに
  // return があると末尾の update_* 挿入が取りこぼされる(ネストした関数の
  // return は別スコープなので対象外 -- collectReturnStarts は関数境界を
  // 越えて再帰しない)。
  if (firstWriteStart != null) {
    const returnStarts: number[] = []
    for (const stmt of stmts) collectReturnStarts(stmt, returnStarts)
    if (returnStarts.some((s) => s > firstWriteStart!)) {
      throw new Error(
        'compile: a `return` after a tracked signal write is not supported, the write would be lost (scope limit)',
      )
    }
  }

  // cross-function-handler-writes D3: 追跡呼び出し先の推移的書き込みを合流し、
  // このスコープ末尾の update_*() 発火(finalize)に含める。
  collectTransitiveWrites(ctx, calleeNames, directWriteDeclIds, directCollectionWriteDeclIds)

  const writeDeclIds = new Set(directWriteDeclIds)
  const allCollectionWriteDeclIds = new Set(directCollectionWriteDeclIds)

  // ネストした関数は自身の実行時に更新文を持つが、構造unit内actionの
  // 字句スコープ検証では、その関数が書くlocal signalもaction全体の参照範囲
  // として扱う必要がある。
  for (const child of nestedScopes) {
    for (const id of child.writeDeclIds) writeDeclIds.add(id)
    for (const id of child.allCollectionWriteDeclIds) {
      allCollectionWriteDeclIds.add(id)
    }
  }

  const start = stmts[0]!.node.start!
  const end = stmts[stmts.length - 1]!.node.end!

  return {
    readDeclIds,
    directWriteDeclIds,
    directCollectionWriteDeclIds,
    writeDeclIds,
    allCollectionWriteDeclIds,
    finalize: (resolveUpdateCall) => {
      const allEdits = [...edits]
      for (const child of nestedScopes) {
        const childCode = child.finalize(resolveUpdateCall)
        allEdits.push({
          start: child.start,
          end: child.end,
          text: childCode,
        })
        if (ast) {
          ast.replace(child.node, child.parent, child.depth, () =>
            parseGeneratedFunctionBody(childCode),
          )
        }
      }
      const tailWriteDeclIds = includeNestedWritesInTail ? writeDeclIds : directWriteDeclIds
      const tailCollectionWriteDeclIds = includeNestedWritesInTail
        ? allCollectionWriteDeclIds
        : directCollectionWriteDeclIds
      const updateCall = resolveUpdateCall(tailWriteDeclIds, tailCollectionWriteDeclIds)
      if (updateCall.code && !updateCall.needsCollectionBatch) {
        allEdits.push({
          start: end,
          end,
          // 最終文がセミコロン無しでも、追加する update 文と連結して
          // JavaScript の同一文にならないよう区切る。
          text: `; ${updateCall.code}`,
        })
      }
      const rendered = ast ? ast.generate() : render(ctx.source, start, end, allEdits)
      if (!updateCall.code) return rendered
      if (updateCall.needsCollectionBatch) {
        return `{ __update_batch_depth__++; try { ${rendered} } finally { __update_batch_depth__--; } ${updateCall.code} }`
      }
      if (ast) return `${rendered}; ${updateCall.code}`
      return rendered
    },
  }
}

// 単一式本体(inline arrow の concise body)向けの同型解析。文レベルの
// 4文種検証・D3 は該当しない(式1つなので早期 return が存在しえない)。
// 書き込みが挿入する update_* が必要になった場合のみブロックへ包む
// (design D4-1: 「同じ書き換え」を式本体にも適用する最小コスト実装)。
//
function analyzeActionExprScope(
  ctx: CompilerState,
  exprPath: NodePath<t.Expression>,
  instanceId: number,
  includeNestedWritesInTail = true,
  trackSharedWrites = true,
): ActionScopeAnalysis {
  const readDeclIds = new Set<DeclId>()
  const directWriteDeclIds = new Set<DeclId>()
  const directCollectionWriteDeclIds = new Set<DeclId>()
  const calleeNames = new Set<string>()
  const edits: Edit[] = []
  const nestedScopes: ReturnType<typeof analyzeFunctionBodyScope>[] = []
  const ast = usesTransformedAst(ctx, exprPath as NodePath<t.Node>)
    ? createAstRewrite(exprPath.node)
    : null

  collectContextCalls(ctx, exprPath, readDeclIds, edits, null, ast, null, exprPath.node)

  const visit = (idPath: NodePath<t.Identifier>) =>
    analyzeActionIdentifier(
      ctx,
      instanceId,
      idPath,
      edits,
      readDeclIds,
      directWriteDeclIds,
      directCollectionWriteDeclIds,
      () => {},
      calleeNames,
      exprPath.node,
      ast,
      trackSharedWrites,
    )
  const captureNested = (
    fnPath: NodePath<t.FunctionExpression | t.ArrowFunctionExpression | t.ObjectMethod>,
  ) => {
    nestedScopes.push(
      analyzeFunctionBodyScope(
        ctx,
        fnPath,
        instanceId,
        includeNestedWritesInTail,
        trackSharedWrites,
      ),
    )
    fnPath.skip()
  }
  if (exprPath.isIdentifier()) visit(exprPath)
  exprPath.traverse({
    Identifier(idPath) {
      if (idPath.isReferencedIdentifier()) visit(idPath)
    },
    FunctionExpression: captureNested,
    ArrowFunctionExpression: captureNested,
    ObjectMethod: captureNested,
  })
  collectTransitiveWrites(ctx, calleeNames, directWriteDeclIds, directCollectionWriteDeclIds)

  const writeDeclIds = new Set(directWriteDeclIds)
  const allCollectionWriteDeclIds = new Set(directCollectionWriteDeclIds)
  for (const child of nestedScopes) {
    for (const id of child.writeDeclIds) writeDeclIds.add(id)
    for (const id of child.allCollectionWriteDeclIds) allCollectionWriteDeclIds.add(id)
  }

  const start = exprPath.node.start!
  const end = exprPath.node.end!
  return {
    readDeclIds,
    directWriteDeclIds,
    directCollectionWriteDeclIds,
    writeDeclIds,
    allCollectionWriteDeclIds,
    finalize: (resolveUpdateCall) => {
      const allEdits = [...edits]
      for (const child of nestedScopes) {
        const childCode = child.finalize(resolveUpdateCall)
        allEdits.push({
          start: child.start,
          end: child.end,
          text: childCode,
        })
        if (ast) {
          ast.replace(child.node, child.parent, child.depth, () =>
            parseGeneratedFunctionBody(childCode),
          )
        }
      }
      const tailWriteDeclIds = includeNestedWritesInTail ? writeDeclIds : directWriteDeclIds
      const tailCollectionWriteDeclIds = includeNestedWritesInTail
        ? allCollectionWriteDeclIds
        : directCollectionWriteDeclIds
      const updateCall = resolveUpdateCall(tailWriteDeclIds, tailCollectionWriteDeclIds)
      const rendered = ast ? ast.generate() : render(ctx.source, start, end, allEdits)
      if (!updateCall.code) return rendered
      if (updateCall.needsCollectionBatch) {
        return `{ __update_batch_depth__++; try { ${rendered}; } finally { __update_batch_depth__--; } ${updateCall.code} }`
      }
      return `{ ${rendered}; ${updateCall.code} }`
    },
  }
}

// 関数式/arrow 1個ぶんの本体(ブロック or concise)を、置換対象の範囲
// ([start,end) -- ブロックなら中括弧込み、concise なら式そのもの)ごと解析する。
// action本体中のネストした関数(design D4-1)と、返り値クロージャ(D4-2)の
// 両方から使う共通処理。
function analyzeFunctionBodyScope(
  ctx: CompilerState,
  fnPath: NodePath<t.FunctionExpression | t.ArrowFunctionExpression | t.ObjectMethod>,
  instanceId: number,
  includeNestedWritesInTail = true,
  trackSharedWrites = true,
): {
  start: number
  end: number
  node: t.Node
  parent: t.Node | null
  depth: number
  finalize: (resolveUpdateCall: ResolveUpdateCall) => string
  readDeclIds: Set<DeclId>
  directWriteDeclIds: Set<DeclId>
  directCollectionWriteDeclIds: Set<DeclId>
  writeDeclIds: Set<DeclId>
  allCollectionWriteDeclIds: Set<DeclId>
} {
  const bodyPath = fnPath.get('body')
  if (bodyPath.isBlockStatement()) {
    const stmts = bodyPath.get('body') as NodePath<t.Statement>[]
    const inner =
      stmts.length > 0
        ? analyzeActionStatements(
            ctx,
            stmts,
            instanceId,
            true,
            true,
            includeNestedWritesInTail,
            trackSharedWrites,
          )
        : {
            finalize: () => '',
            readDeclIds: new Set<DeclId>(),
            directWriteDeclIds: new Set<DeclId>(),
            directCollectionWriteDeclIds: new Set<DeclId>(),
            writeDeclIds: new Set<DeclId>(),
            allCollectionWriteDeclIds: new Set<DeclId>(),
          }
    return {
      start: bodyPath.node.start!,
      end: bodyPath.node.end!,
      node: bodyPath.node,
      parent: fnPath.node,
      depth: pathDepth(bodyPath as NodePath<t.Node>),
      readDeclIds: inner.readDeclIds,
      directWriteDeclIds: inner.directWriteDeclIds,
      directCollectionWriteDeclIds: inner.directCollectionWriteDeclIds,
      writeDeclIds: inner.writeDeclIds,
      allCollectionWriteDeclIds: inner.allCollectionWriteDeclIds,
      finalize: (resolveUpdateCall) => `{${inner.finalize(resolveUpdateCall)}}`,
    }
  }
  const exprScope = analyzeActionExprScope(
    ctx,
    bodyPath as NodePath<t.Expression>,
    instanceId,
    includeNestedWritesInTail,
    trackSharedWrites,
  )
  return {
    start: bodyPath.node.start!,
    end: bodyPath.node.end!,
    node: bodyPath.node,
    parent: fnPath.node,
    depth: pathDepth(bodyPath as NodePath<t.Node>),
    finalize: exprScope.finalize,
    readDeclIds: exprScope.readDeclIds,
    directWriteDeclIds: exprScope.directWriteDeclIds,
    directCollectionWriteDeclIds: exprScope.directCollectionWriteDeclIds,
    writeDeclIds: exprScope.writeDeclIds,
    allCollectionWriteDeclIds: exprScope.allCollectionWriteDeclIds,
  }
}

export interface ActionBodyAnalysis {
  finalizeBody: (resolveUpdateCall: ResolveUpdateCall) => string
  /** action/effect本体が直接読み取る宣言。返り値cleanupのreadは含めない。 */
  readDeclIds: Set<DeclId>
  /** 返り値(function または { update?, destroy? })。無ければ null。 */
  result: {
    finalize: (resolveUpdateCall: ResolveUpdateCall) => string
    /** update が直接読む signal/derived(推移解決前 -- ctx.markerDeps と
     * 同じ形、resolveToSignals による展開は compiler.ts の
     * buildSignalToMarkers に任せる)。destroy の読み取りはここへ含めない。 */
    deps: Set<DeclId>
    /** update/destroy の本体が書く宣言。字句範囲検証に使う。 */
    writeDeclIds: Set<DeclId>
    directCollectionWriteDeclIds: Set<DeclId>
  } | null
  /** action本体が書く宣言。 */
  writeDeclIds: Set<DeclId>
  directCollectionWriteDeclIds: Set<DeclId>
}

const NO_ACTION_UPDATE: ResolveUpdateCall = () => ({
  code: '',
  needsCollectionBatch: false,
})

// onMountのcleanupはunmount中に実行するため、その本体へsignal更新を
// 挿入しない。callback本体の更新は通常のresolveUpdateCallを使う。
const NO_MOUNT_CLEANUP_UPDATE: ResolveUpdateCall = NO_ACTION_UPDATE

type ActionResultFunctionPath = NodePath<
  t.FunctionExpression | t.ArrowFunctionExpression | t.ObjectMethod
>

function actionResultPropertyName(
  property: NodePath<t.ObjectProperty | t.ObjectMethod | t.SpreadElement>,
): string | null {
  if (property.node.type === 'SpreadElement' || property.node.computed) return null
  const key = property.node.key
  if (key.type === 'Identifier') return key.name
  if (key.type === 'StringLiteral') return key.value
  return null
}

function actionResultFunctionPath(
  property: NodePath<t.ObjectProperty | t.ObjectMethod | t.SpreadElement>,
): ActionResultFunctionPath | null {
  if (property.isObjectMethod()) {
    if (property.node.kind !== 'method') return null
    return property as ActionResultFunctionPath
  }
  if (!property.isObjectProperty()) return null
  const value = property.get('value') as NodePath<t.Expression>
  if (!value.isFunctionExpression() && !value.isArrowFunctionExpression()) return null
  return value as ActionResultFunctionPath
}

function analyzeActionResultExpression(
  ctx: CompilerState,
  argPath: NodePath<t.Expression>,
  instanceId: number,
): NonNullable<ActionBodyAnalysis['result']> {
  if (argPath.isFunctionExpression() || argPath.isArrowFunctionExpression()) {
    if (argPath.node.params.length !== 0) {
      throw new Error(
        'compile: an action can only return a zero-argument update closure (scope limit)',
      )
    }
    const closureScope = analyzeFunctionBodyScope(ctx, argPath, instanceId)
    // クロージャは0引数(検証済み)なので、関数キーワード/params/矢印までの
    // 前置テキストは書き換え不要でそのまま source から取り出せる。
    const prefix = ctx.source.slice(argPath.node.start!, closureScope.start)
    return {
      deps: closureScope.readDeclIds,
      writeDeclIds: closureScope.writeDeclIds,
      directCollectionWriteDeclIds: closureScope.allCollectionWriteDeclIds,
      finalize: (resolveUpdateCall) => `${prefix}${closureScope.finalize(resolveUpdateCall)}`,
    }
  }

  if (!argPath.isObjectExpression()) {
    throw new Error(
      'compile: an action can only return a zero-argument update closure or { update?, destroy? } (scope limit)',
    )
  }

  const properties = argPath.get('properties') as NodePath<
    t.ObjectProperty | t.ObjectMethod | t.SpreadElement
  >[]
  const seen = new Set<string>()
  const resultEdits: {
    start: number
    end: number
    finalize: (resolveUpdateCall: ResolveUpdateCall) => string
  }[] = []
  let updateDeps = new Set<DeclId>()
  const writeDeclIds = new Set<DeclId>()
  const directCollectionWriteDeclIds = new Set<DeclId>()

  for (const property of properties) {
    const name = actionResultPropertyName(property)
    if (name !== 'update' && name !== 'destroy') {
      throw new Error(
        'compile: an action result object may only contain update and destroy (scope limit)',
      )
    }
    if (seen.has(name)) {
      throw new Error(`compile: an action result object cannot repeat ${name} (scope limit)`)
    }
    seen.add(name)
    const fnPath = actionResultFunctionPath(property)
    if (!fnPath || fnPath.node.params.length !== 0) {
      throw new Error(
        `compile: an action result object ${name} must be a zero-argument function (scope limit)`,
      )
    }
    const scope = analyzeFunctionBodyScope(ctx, fnPath, instanceId)
    if (name === 'update') updateDeps = scope.readDeclIds
    for (const id of scope.writeDeclIds) writeDeclIds.add(id)
    for (const id of scope.allCollectionWriteDeclIds) {
      directCollectionWriteDeclIds.add(id)
    }
    resultEdits.push({
      start: scope.start,
      end: scope.end,
      finalize: (resolveUpdateCall) =>
        scope.finalize(name === 'update' ? resolveUpdateCall : NO_ACTION_UPDATE),
    })
  }

  return {
    deps: updateDeps,
    writeDeclIds,
    directCollectionWriteDeclIds,
    finalize: (resolveUpdateCall) =>
      render(
        ctx.source,
        argPath.node.start!,
        argPath.node.end!,
        resultEdits.map((edit) => ({
          start: edit.start,
          end: edit.end,
          text: edit.finalize(resolveUpdateCall),
        })),
      ),
  }
}

// ADR-0011 design D4/D5: action本体の解析エントリポイント。render.ts の
// resolveHandlerBody が返す body(ブロック文配列 or inline arrow の単一式)を
// そのまま受け取る。本体トップレベルの末尾 `return <0引数関数式>` または
// `return { update?, destroy? }` だけを返り値として分離し(D4-2)、残りの文には通常のハンドラ同型解析
// (ネストした関数本体への再帰込み、D4-1)を適用する。
export function analyzeActionBody(
  ctx: CompilerState,
  body: NodePath<t.Expression> | NodePath<t.Statement>[],
  instanceId: number,
): ActionBodyAnalysis {
  if (!Array.isArray(body)) {
    if (
      body.isFunctionExpression() ||
      body.isArrowFunctionExpression() ||
      body.isObjectExpression()
    ) {
      return {
        finalizeBody: () => '',
        readDeclIds: new Set<DeclId>(),
        result: analyzeActionResultExpression(ctx, body, instanceId),
        writeDeclIds: new Set<DeclId>(),
        directCollectionWriteDeclIds: new Set<DeclId>(),
      }
    }
    const scope = analyzeActionExprScope(ctx, body, instanceId)
    return {
      finalizeBody: scope.finalize,
      readDeclIds: scope.readDeclIds,
      result: null,
      writeDeclIds: scope.writeDeclIds,
      directCollectionWriteDeclIds: scope.allCollectionWriteDeclIds,
    }
  }

  const last = body[body.length - 1]
  let bodyStmts = body
  let result: ActionBodyAnalysis['result'] = null

  if (last?.isReturnStatement() && last.node.argument != null) {
    const argPath = last.get('argument') as NodePath<t.Expression>
    bodyStmts = body.slice(0, -1)
    result = analyzeActionResultExpression(ctx, argPath, instanceId)
  }

  const bodyScope =
    bodyStmts.length > 0
      ? analyzeActionStatements(ctx, bodyStmts, instanceId, false)
      : {
          finalize: () => '',
          readDeclIds: new Set<DeclId>(),
          directWriteDeclIds: new Set<DeclId>(),
          directCollectionWriteDeclIds: new Set<DeclId>(),
          writeDeclIds: new Set<DeclId>(),
          allCollectionWriteDeclIds: new Set<DeclId>(),
        }

  const writeDeclIds = new Set(bodyScope.writeDeclIds)
  const directCollectionWriteDeclIds = new Set(bodyScope.allCollectionWriteDeclIds)
  if (result) {
    for (const id of result.writeDeclIds) writeDeclIds.add(id)
    for (const id of result.directCollectionWriteDeclIds) {
      directCollectionWriteDeclIds.add(id)
    }
  }

  return {
    finalizeBody: bodyScope.finalize,
    readDeclIds: bodyScope.readDeclIds,
    result,
    writeDeclIds,
    directCollectionWriteDeclIds,
  }
}

export interface MountBodyAnalysis {
  finalizeBody: (resolveUpdateCall: ResolveUpdateCall) => string
  readDeclIds: Set<DeclId>
  writeDeclIds: Set<DeclId>
  directCollectionWriteDeclIds: Set<DeclId>
  /** `onMount` callbackが返す、unmount時だけ呼ぶcleanup。 */
  finalizeCleanup: (() => string) | null
}

// `onMount(() => void | (() => void))` のcallbackをactionと同じ解析機械へ
// 通す。actionのobject resultは要素action専用なので拒否し、cleanupは
// `NO_MOUNT_CLEANUP_UPDATE`で確定してunmount後のDOM更新を出力しない。
export function analyzeMountBody(
  ctx: CompilerState,
  callbackPath: NodePath<t.ArrowFunctionExpression>,
  instanceId: number,
): MountBodyAnalysis {
  const bodyPath = callbackPath.get('body')
  let body: NodePath<t.Expression> | NodePath<t.Statement>[]
  let returnsCleanup = false

  if (bodyPath.isBlockStatement()) {
    const stmts = bodyPath.get('body') as NodePath<t.Statement>[]
    const last = stmts[stmts.length - 1]
    if (last?.isReturnStatement() && last.node.argument != null) {
      const returned = last.get('argument') as NodePath<t.Expression>
      if (!returned.isArrowFunctionExpression() && !returned.isFunctionExpression()) {
        throw new Error(
          'compile: onMount() may only return a zero-argument cleanup function (scope limit)',
        )
      }
      returnsCleanup = true
    }
    body = stmts
  } else {
    // Concise `() => () => cleanup()` is the compact cleanup-only form. Other
    // concise expressions are setup statements and their return value is
    // intentionally discarded by codegen, so `onMount(() => setup())` remains
    // a void callback.
    returnsCleanup = bodyPath.isArrowFunctionExpression() || bodyPath.isFunctionExpression()
    if (bodyPath.isObjectExpression()) {
      throw new Error(
        'compile: onMount() may only return void or a zero-argument cleanup function (scope limit)',
      )
    }
    body = bodyPath as NodePath<t.Expression>
  }

  const analysis = analyzeActionBody(ctx, body, instanceId)
  if (returnsCleanup && !analysis.result) {
    throw new Error('compile: failed to analyze onMount() cleanup function (scope limit)')
  }
  if (!returnsCleanup && analysis.result) {
    throw new Error(
      'compile: onMount() may only return void or a zero-argument cleanup function (scope limit)',
    )
  }

  return {
    finalizeBody: analysis.finalizeBody,
    readDeclIds: analysis.readDeclIds,
    writeDeclIds: analysis.writeDeclIds,
    directCollectionWriteDeclIds: analysis.directCollectionWriteDeclIds,
    finalizeCleanup: analysis.result
      ? () => analysis.result!.finalize(NO_MOUNT_CLEANUP_UPDATE)
      : null,
  }
}

export interface EffectBodyAnalysis {
  finalizeBody: (resolveUpdateCall: ResolveUpdateCall) => string
  /** effect callback本体が直接読み取る宣言。cleanupのreadは除外する。 */
  readDeclIds: Set<DeclId>
  finalizeCleanup: (() => string) | null
}

// `effect(() => void | (() => void))` のcallbackをonMountと同じ解析機械へ
// 通す。ただしeffect本体・cleanupから追跡対象signalへ書き込むと、同期
// update_*()の再入を暗黙に発生させるためscope limitで拒否する。
export function analyzeEffectBody(
  ctx: CompilerState,
  callbackPath: NodePath<t.ArrowFunctionExpression>,
  instanceId: number,
): EffectBodyAnalysis {
  const bodyPath = callbackPath.get('body')
  let body: NodePath<t.Expression> | NodePath<t.Statement>[]
  let returnsCleanup = false

  if (bodyPath.isBlockStatement()) {
    const stmts = bodyPath.get('body') as NodePath<t.Statement>[]
    const last = stmts[stmts.length - 1]
    if (last?.isReturnStatement() && last.node.argument != null) {
      const returned = last.get('argument') as NodePath<t.Expression>
      if (!returned.isArrowFunctionExpression() && !returned.isFunctionExpression()) {
        throw new Error(
          'compile: effect() may only return a zero-argument cleanup function (scope limit)',
        )
      }
      returnsCleanup = true
    }
    body = stmts
  } else {
    returnsCleanup = bodyPath.isArrowFunctionExpression() || bodyPath.isFunctionExpression()
    if (bodyPath.isObjectExpression()) {
      throw new Error(
        'compile: effect() may only return void or a zero-argument cleanup function (scope limit)',
      )
    }
    body = bodyPath as NodePath<t.Expression>
  }

  const analysis = analyzeActionBody(ctx, body, instanceId)
  if (returnsCleanup && !analysis.result) {
    throw new Error('compile: failed to analyze effect() cleanup function (scope limit)')
  }
  if (!returnsCleanup && analysis.result) {
    throw new Error(
      'compile: effect() may only return void or a zero-argument cleanup function (scope limit)',
    )
  }
  if (analysis.writeDeclIds.size > 0) {
    throw new Error('compile: effect() cannot write tracked signals (scope limit)')
  }

  return {
    finalizeBody: analysis.finalizeBody,
    readDeclIds: analysis.readDeclIds,
    finalizeCleanup: analysis.result
      ? () => analysis.result!.finalize(NO_MOUNT_CLEANUP_UPDATE)
      : null,
  }
}

// `count()` のような裸の読み取り - 追跡済み signal/derived の引数なし
// 呼び出しで周囲に計算がないもの。M1 では prop エイリアスは使わないが、
// 将来のマイルストーンで再利用するため legacy 同様の形で残す。
export function bareTrackedDeclId(
  ctx: CompilerState,
  exprPath: NodePath<t.Expression>,
  instanceId: number,
): DeclId | null {
  if (!exprPath.isCallExpression() || exprPath.node.arguments.length !== 0) return null
  const callee = exprPath.get('callee')
  if (!callee.isIdentifier()) return null
  return resolveDeclId(ctx, callee, instanceId)
}
