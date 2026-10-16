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
import {
  isOwnedRowArray,
  canMutateRowArray,
  isPureRowMap,
  isPureRowFilter,
  isRowAppend,
  isAtomicRowPermutation,
  rowPermutationIndexes,
  rowMapRange,
  rowMapFields,
} from './list-map.ts'
import type {
  CompilerState,
  ContextId,
  ContextValue,
  DeclId,
  ResolveUpdateCall,
  TrackedFn,
} from './state.ts'
import { declKey } from './state.ts'
import { mappedSource, stripSourceMapMarkers } from '../source-map.ts'

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

function resolveDeclId(
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
  // 同じ位置の内側の閉じ括弧を先に挿入し、外側の置換で元の文字を一度だけ消費する。
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end)
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
function parseGeneratedFunctionBody(
  code: string,
  originalFunction: t.Node | null,
): t.BlockStatement {
  const trimmed = code.trim()
  // オブジェクトを返すarrowの中括弧を文のブロックと誤認しない。
  // 書込みで生成されたtry/finally本体の場合は、従来のブロック解析へ戻す。
  if (
    t.isArrowFunctionExpression(originalFunction) &&
    t.isObjectExpression(originalFunction.body)
  ) {
    try {
      return t.blockStatement([t.returnStatement(parseGeneratedExpression(trimmed))])
    } catch {
      // 式ではなく生成済みの更新ブロックである。
    }
  }
  const body = stripSourceMapMarkers(trimmed).trim().startsWith('{')
    ? trimmed
    : `{ return (${trimmed}); }`
  const privateNames = new Set<string>()
  if (originalFunction)
    t.traverseFast(originalFunction, (node) => {
      if (t.isPrivateName(node)) privateNames.add(node.id.name)
    })
  // 再解析は実行しない。元の本体を戻す前に、await・super・private名が
  // 有効な構文文脈だけを用意し、thisやargumentsの実行時の束縛は変更しない。
  const constructor = t.isClassMethod(originalFunction) && originalFunction.kind === 'constructor'
  const source = `class __generated__ extends __base__ { ${[...privateNames].map((name) => `#${name};`).join(' ')} ${constructor ? 'constructor' : 'async __body__'}() ${body} }`
  const file = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
  const cls = file.program.body[0]
  const fn =
    cls?.type === 'ClassDeclaration'
      ? cls.body.body.find((node) => node.type === 'ClassMethod')
      : null
  if (fn?.type !== 'ClassMethod')
    throw new Error('compile: failed to parse generated function body')
  return fn.body
}

// 動きゾーンの関数は呼出しグラフを追跡し、通常の局所関数は解析済みの
// ASTノードとの同一性で判別する。未解析の仮引数などへ状態更新を隠す
// 呼出しは受理しない。名前だけで判別すると局所関数による遮蔽を壊す。
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
  // onMount/actionが保持する外部ヘルパーの戻り値は、cleanup時に呼び出す
  // 不透明な関数として扱う。呼び出し先の本体を追跡できなくても、signalの
  // 書き込みを隠していない限り、生成側は元の呼び出しをそのまま保持できる。
  if (
    binding.path.isVariableDeclarator() &&
    binding.path.node.init?.type === 'CallExpression' &&
    binding.path.node.init.callee.type === 'Identifier' &&
    ctx.supportNames.has(binding.path.node.init.callee.name)
  ) {
    return
  }
  const localFunction = binding.path.isFunctionDeclaration()
    ? binding.path.node
    : binding.path.isVariableDeclarator()
      ? binding.path.node.init
      : null
  if (localFunction && t.isFunction(localFunction) && ctx.analyzedFunctions.has(localFunction))
    return
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
  validateFunctionBoundary(ctx, fnPath, instanceId)
  const params = fnPath.get('params') as NodePath<t.Node>[]
  const paramSource =
    params.length > 0
      ? ctx.source.slice(params[0]!.node.start!, params[params.length - 1]!.node.end!)
      : ''
  // 循環時の再入防止のため、本体解析より前にエントリを登録する。
  const entry: TrackedFn = {
    name,
    paramSource,
    async: fnPath.node.async,
    finalize: () => '',
    finalizeCleanup: () => '',
    node: fnPath.node,
    allWriteDeclIds: new Set(),
    allCollectionWriteDeclIds: new Set(),
    writeDeclIds: new Set(),
    directCollectionWriteDeclIds: new Set(),
    calleeNames: new Set(),
  }
  ctx.trackedFns.set(name, entry)
  const stmts = fnPath.get('body.body') as NodePath<t.Statement>[]
  if (stmts.length === 0) return
  const core = analyzeActionStatements(ctx, stmts, instanceId, false, fnPath.node.async)
  entry.finalize = core.finalize
  entry.finalizeCleanup = () => core.finalize(NO_HELPER_UPDATE)
  entry.allWriteDeclIds = core.writeDeclIds
  entry.allCollectionWriteDeclIds = core.allCollectionWriteDeclIds
  entry.writeDeclIds = core.directWriteDeclIds
  entry.directCollectionWriteDeclIds = core.directCollectionWriteDeclIds
  entry.calleeNames = core.calleeNames
}

// 呼び出した局所関数の読み取りだけを依存へ合流する。宣言や返却した
// 閉包の作成は本体を実行しないため、内側の関数は呼出し先としてのみ辿る。
function collectCalledReads(
  ctx: CompilerState,
  path: NodePath<t.Function>,
  instanceId: number,
  out: Set<DeclId>,
  visited: Set<t.Function> = new Set(),
): void {
  if (visited.has(path.node)) return
  visited.add(path.node)
  const body = path.get('body') as NodePath<t.Node>
  const visit = (idPath: NodePath<t.Identifier>) => {
    if (!idPath.isReferencedIdentifier()) return
    const parent = idPath.parentPath
    const call = parent?.isCallExpression() && parent.node.callee === idPath.node
    const id = resolveDeclId(ctx, idPath, instanceId)
    if (id) {
      if (!call || parent.node.arguments.length === 0) out.add(id)
      return
    }
    if (!call) return
    const binding = idPath.scope.getBinding(idPath.node.name)
    const fn = binding?.path.isFunctionDeclaration()
      ? binding.path
      : binding?.path.isVariableDeclarator()
        ? binding.path.get('init')
        : null
    if (fn && !Array.isArray(fn) && fn.isFunction())
      collectCalledReads(ctx, fn, instanceId, out, visited)
  }
  if (body.isIdentifier()) visit(body)
  if (!body.isFunction())
    body.traverse({
      Function(inner) {
        if (inner.parentPath?.isCallExpression() && inner.parentPath.node.callee === inner.node)
          collectCalledReads(ctx, inner, instanceId, out, visited)
        inner.skip()
      },
      Identifier: visit,
    })
}

// 呼び出しグラフを visited-set で辿り、名前集合から到達可能な追跡関数の
// 直接書き込み(root signal)を推移的に集める(循環安全)。
function collectTransitiveWrites(
  ctx: CompilerState,
  names: Set<string>,
  out: Set<DeclId>,
  directCollectionOut: Set<DeclId> = new Set(),
  visited: Set<string> = new Set(),
  includeDeferredWrites = false,
): void {
  for (const name of names) {
    if (visited.has(name)) continue
    visited.add(name)
    const fn = ctx.trackedFns.get(name)
    if (!fn || (!includeDeferredWrites && fn.async)) continue
    for (const w of includeDeferredWrites ? fn.allWriteDeclIds : fn.writeDeclIds) out.add(w)
    for (const w of includeDeferredWrites
      ? fn.allCollectionWriteDeclIds
      : fn.directCollectionWriteDeclIds)
      directCollectionOut.add(w)
    collectTransitiveWrites(
      ctx,
      fn.calleeNames,
      out,
      directCollectionOut,
      visited,
      includeDeferredWrites,
    )
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
  /** 連結済み入力ソースにおける本体先頭。 */
  sourceStart: number
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
  const scope = analyzeActionExprScope(ctx, exprPath, instanceId, false, false)
  return {
    rendered: scope.finalize(NO_ACTION_RENDER),
    finalize: scope.finalize,
    writeDeclIds: scope.writeDeclIds,
    directCollectionWriteDeclIds: scope.allCollectionWriteDeclIds,
    sourceStart: exprPath.node.start!,
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
  const fnPath = stmts[0]?.getFunctionParent()
  if (fnPath) validateFunctionBoundary(ctx, fnPath, instanceId)
  if (stmts.length === 0) {
    return {
      rendered: '',
      finalize: () => '',
      writeDeclIds: new Set(),
      directCollectionWriteDeclIds: new Set(),
      sourceStart: 0,
    }
  }
  // callback自身の関数出口で更新する。外側には直接実行する書込みだけを
  // 合流し、Promise完了前やリスナー登録時に更新を発火させない。
  const scope = analyzeActionStatements(ctx, stmts, instanceId, false)
  return {
    rendered: scope.finalize(NO_ACTION_RENDER),
    finalize: scope.finalize,
    writeDeclIds: scope.writeDeclIds,
    directCollectionWriteDeclIds: scope.allCollectionWriteDeclIds,
    sourceStart: stmts[0]!.node.start!,
  }
}

// ADR-0011: action本体・ネストした関数本体・返り値クロージャで共有する
// 識別子の読み取り・代入化を関数境界間で共有する。書込み位置は初期化
// 本体の出口検査へ通知し、通常の関数では成功後に局所フラグを立てる。
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
  dirtyName: string | null = null,
): void {
  const id = resolveDeclId(ctx, idPath, instanceId)
  if (!id) {
    // cross-function-handler-writes: action 本体からの動きゾーン関数呼び出しも
    // ハンドラと同じ規則で追跡する。初期化本体だけが書込み位置を検査する。
    tryHandleTrackedCallee(
      ctx,
      idPath,
      instanceId,
      calleeNames,
      onWrite,
      edits,
      ast ? (path, name) => ast.rename(path.node, name) : undefined,
    )
    const parent = idPath.parentPath
    if (parent?.isCallExpression() && parent.node.callee === idPath.node) {
      const binding = idPath.scope.getBinding(idPath.node.name)
      const local = binding?.path.isFunctionDeclaration()
        ? binding.path
        : binding?.path.isVariableDeclarator()
          ? binding.path.get('init')
          : null
      if (local && !Array.isArray(local) && local.isFunction()) {
        collectCalledReads(ctx, local, instanceId, readDeclIds)
      }
    }
    const fn = ctx.trackedFns.get(idPath.node.name)
    if (
      dirtyName &&
      fn &&
      !fn.async &&
      idPath.scope.getBinding(idPath.node.name)?.path.node ===
        ctx.movementFns.get(idPath.node.name)?.node &&
      parent?.isCallExpression() &&
      parent.node.callee === idPath.node
    ) {
      edits.push({
        start: parent.node.start!,
        end: parent.node.start!,
        text: `(${dirtyName} = true, `,
      })
      edits.push({ start: parent.node.end!, end: parent.node.end!, text: ')' })
      if (ast)
        planAstReplacement(ast, parent, root, (get) =>
          t.sequenceExpression([
            t.assignmentExpression('=', t.identifier(dirtyName), t.booleanLiteral(true)),
            get(parent.node),
          ]),
        )
    }
    return
  }
  noteDeclUse(ctx, id)
  const outputName = ctx.declOutputName.get(id)
  if (!outputName) return

  const parent = idPath.parentPath
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
  if (parent?.isCallExpression() && parent.node.callee === idPath.node) {
    if (parent.node.arguments.length === 0) {
      const member = parent.parentPath
      const copy = member?.parentPath
      if (
        !ctx.localDeclIds.has(id) &&
        member?.isMemberExpression() &&
        !member.node.computed &&
        t.isIdentifier(member.node.property, { name: 'slice' }) &&
        copy?.isCallExpression() &&
        copy.node.arguments.length === 0 &&
        copy.parentPath?.isVariableDeclarator() &&
        t.isIdentifier(copy.parentPath.node.id)
      ) {
        const binding = idPath.scope.getBinding(idPath.node.name)!
        const local = copy.scope.getBinding(copy.parentPath.node.id.name)
        const indexes = local && rowPermutationIndexes(local, binding)
        if (indexes) {
          let owned = ctx.ownedRowArrays.get(binding.path.node)
          if (owned === undefined) {
            owned = isOwnedRowArray(binding)
            ctx.ownedRowArrays.set(binding.path.node, owned)
          }
          if (owned) {
            let mutable = ctx.mutableRowArrays.get(binding.path.node)
            if (mutable === undefined) {
              mutable = canMutateRowArray(binding)
              ctx.mutableRowArrays.set(binding.path.node, mutable)
            }
            const inPlace = mutable && isAtomicRowPermutation(local!, binding)
            ctx.listMapDeclIds.add(id)
            edits.push(
              { start: parent.node.start!, end: parent.node.start!, text: '__copyListValues__(' },
              {
                start: parent.node.end!,
                end: copy.node.end!,
                text: `, ${indexes.join(', ')}, ${inPlace})`,
              },
            )
            if (ast)
              planAstReplacement(ast, copy as NodePath<t.CallExpression>, root, (get) =>
                t.callExpression(t.identifier('__copyListValues__'), [
                  get(parent.node) as t.Expression,
                  ...indexes.map((value) => t.numericLiteral(value)),
                  t.booleanLiteral(inPlace),
                ]),
              )
          }
        }
      }
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
    const binding = idPath.scope.getBinding(idPath.node.name)!
    const argumentPath = parent.get('arguments.0') as NodePath<t.Expression>
    if (
      !ctx.localDeclIds.has(id) &&
      (isPureRowMap(argumentPath, binding) ||
        isPureRowFilter(argumentPath, binding) ||
        isRowAppend(argumentPath, binding))
    ) {
      let owned = ctx.ownedRowArrays.get(binding.path.node)
      if (owned === undefined) {
        owned = isOwnedRowArray(binding)
        ctx.ownedRowArrays.set(binding.path.node, owned)
      }
      if (owned) {
        ctx.listMapDeclIds.add(id)
        if (isRowAppend(argumentPath, binding)) {
          const [first, second] = argumentPath.node.elements as t.SpreadElement[]
          edits.push(
            {
              start: argumentPath.node.start!,
              end: first!.argument.start!,
              text: '__appendListValues__(__beginListAppend__(',
            },
            { start: first!.argument.end!, end: second!.argument.start!, text: '), ' },
            { start: second!.argument.end!, end: argumentPath.node.end!, text: ', true)' },
          )
          if (ast)
            planAstReplacement(ast, argumentPath, root, (get) =>
              t.callExpression(t.identifier('__appendListValues__'), [
                t.callExpression(t.identifier('__beginListAppend__'), [
                  get(first!.argument) as t.Expression,
                ]),
                get(second!.argument) as t.Expression,
                t.booleanLiteral(true),
              ]),
            )
        } else {
          const map = argumentPath.node as t.CallExpression
          const filtering = isPureRowFilter(argumentPath, binding)
          const range = rowMapRange(map)
          const fields = filtering ? null : rowMapFields(map)
          const object = (map.callee as t.MemberExpression).object
          const helper = filtering ? '__filterListValues__' : '__mapListValues__'
          edits.push(
            { start: object.start!, end: object.start!, text: helper + '(' },
            { start: object.end!, end: map.arguments[0]!.start!, text: ', ' },
          )
          const options = filtering
            ? ''
            : `, ${range?.[0] ?? 'void 0'}, ${range?.[1] ?? 0}, ${fields ? JSON.stringify(fields) : 'void 0'}`
          if (options) edits.push({ start: map.end! - 1, end: map.end! - 1, text: options })
          if (ast)
            planAstReplacement(ast, argumentPath, root, (get) =>
              t.callExpression(t.identifier(helper), [
                get(object) as t.Expression,
                get(map.arguments[0]!) as t.Expression,
                ...(!filtering
                  ? [
                      range
                        ? t.numericLiteral(range[0])
                        : t.unaryExpression('void', t.numericLiteral(0)),
                      t.numericLiteral(range?.[1] ?? 0),
                      fields
                        ? t.arrayExpression(fields.map((field) => t.stringLiteral(field)))
                        : t.unaryExpression('void', t.numericLiteral(0)),
                    ]
                  : []),
              ]),
            )
        }
      }
    }
    const functional = arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression'
    edits.push({
      start: parent.node.start!,
      end: arg.start!,
      text: `(${outputName} = ${functional ? '(' : ''}`,
    })
    edits.push({
      start: arg.end!,
      end: parent.node.end!,
      text: `${functional ? `)(${outputName})` : ''}${dirtyName ? `, ${dirtyName} = true, ${outputName}` : ''})`,
    })
    if (ast) {
      const callPath = parent as NodePath<t.CallExpression>
      planAstReplacement(ast, callPath, root, (get) => {
        const value = get(arg as t.Expression) as t.Expression
        const rhs = functional ? t.callExpression(value, [t.identifier(outputName)]) : value
        const assignment = t.assignmentExpression('=', t.identifier(outputName), rhs)
        return dirtyName
          ? t.sequenceExpression([
              assignment,
              t.assignmentExpression('=', t.identifier(dirtyName), t.booleanLiteral(true)),
              t.identifier(outputName),
            ])
          : assignment
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
  calleeNames: Set<string>
  /** 依存先の確定後、実行された書込みを関数出口で反映する本文を生成する。 */
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

interface FunctionReference {
  path: NodePath<t.Identifier>
  functionPath: NodePath<t.Function>
  movement: boolean
  call: boolean
}

function recordFunctionReference(
  ctx: CompilerState,
  path: NodePath<t.Identifier>,
  instanceId: number,
  out: FunctionReference[],
): void {
  const binding = path.scope.getBinding(path.node.name)
  const fn = binding?.path.isFunctionDeclaration()
    ? binding.path
    : binding?.path.isVariableDeclarator()
      ? binding.path.get('init')
      : null
  if (!fn || Array.isArray(fn) || !fn.isFunction()) return
  const movement = ctx.movementFns.get(path.node.name)?.node === fn.node
  if (!movement && !ctx.analyzedFunctions.has(fn.node)) return
  if (movement) ensureTrackedFn(ctx, path.node.name, instanceId)
  out.push({
    path,
    functionPath: fn,
    movement,
    call: !!path.parentPath?.isCallExpression() && path.parentPath.node.callee === path.node,
  })
}

function finalizeFunctionReferences(
  ctx: CompilerState,
  refs: FunctionReference[],
  resolve: ResolveUpdateCall,
  edits: Edit[],
  ast: AstRewriteSession | null,
): void {
  const cleanup = resolve === NO_ACTION_UPDATE || resolve === NO_HELPER_UPDATE
  for (const ref of refs) {
    if (!ref.call) {
      const parent = ref.path.parentPath
      const callee = parent?.isCallExpression() ? parent.node.callee : null
      // listener解除へ渡す関数は、登録時と同じ参照をそのまま保持する。
      const preservesIdentity =
        callee?.type === 'MemberExpression' &&
        !callee.computed &&
        callee.property.type === 'Identifier' &&
        callee.property.name === 'removeEventListener'
      const pureRead =
        parent?.isUnaryExpression({ operator: 'typeof' }) ||
        (parent?.isBinaryExpression() && ['===', '!=='].includes(parent.node.operator)) ||
        (parent?.isMemberExpression() &&
          parent.node.object === ref.path.node &&
          !(parent.parentPath?.isCallExpression() && parent.parentPath.node.callee === parent.node))
      if (!pureRead && ((cleanup && !preservesIdentity) || (!cleanup && ref.movement)))
        throw compileErrorAtNode(
          'compile: passing tracked function values for deferred execution is not supported yet (scope limit)',
          ref.path,
        )
      continue
    }
    if (!cleanup) {
      if (ast) ast.rename(ref.path.node, ref.path.node.name)
      continue
    }
    const binding = ref.path.scope.getBinding(ref.path.node.name)
    if (binding && !binding.constant)
      throw compileErrorAtNode(
        'compile: calling reassigned functions from cleanup is not supported yet (scope limit)',
        ref.path,
      )
    let name = ctx.cleanupFunctionNames.get(ref.functionPath.node)
    if (!name) {
      name = ref.functionPath.scope.generateUidIdentifier(`cleanup_${ref.path.node.name}`).name
      ctx.cleanupFunctionNames.set(ref.functionPath.node, name)
    }
    const start = ref.path.node.start!
    const end = ref.path.node.end!
    for (let i = edits.length - 1; i >= 0; i--)
      if (edits[i]!.start === start && edits[i]!.end === end) edits.splice(i, 1)
    edits.push({ start, end, text: name })
    if (ast) ast.rename(ref.path.node, name)
  }
}

function cleanupLocalDeclarations(
  ctx: CompilerState,
  scopes: ReturnType<typeof analyzeFunctionBodyScope>[],
  edits: Edit[],
  ast: AstRewriteSession | null,
): void {
  const emitted = new Set<t.Function>()
  for (;;) {
    let changed = false
    for (const scope of scopes) {
      if (!scope.parent || !t.isFunction(scope.parent) || emitted.has(scope.parent)) continue
      const name = ctx.cleanupFunctionNames.get(scope.parent)
      if (!name) continue
      emitted.add(scope.parent)
      const body = scope.finalize(NO_HELPER_UPDATE)
      const fn = scope.parent
      if (t.isFunctionDeclaration(fn)) {
        const params = fn.params.length
          ? ctx.source.slice(fn.params[0]!.start!, fn.params.at(-1)!.end!)
          : ''
        const code = `${fn.async ? 'async ' : ''}function ${name}(${params}) ${body}`
        edits.push({ start: fn.end!, end: fn.end!, text: `; ${code}` })
        if (ast)
          ast.insertAfter(fn, scope.functionPath.parentPath?.node ?? null, () => {
            const parsed = parseGeneratedExpression(code) as t.FunctionExpression
            return t.functionDeclaration(
              t.identifier(name),
              parsed.params,
              parsed.body,
              parsed.generator,
              parsed.async,
            )
          })
      } else {
        const code = `${ctx.source.slice(fn.start!, scope.start)}${body}${ctx.source.slice(scope.end, fn.end!)}`
        const declarator = scope.functionPath.parentPath
        if (!declarator?.isVariableDeclarator()) continue
        edits.push({
          start: declarator.node.end!,
          end: declarator.node.end!,
          text: `, ${name} = ${code}`,
        })
        if (ast)
          ast.insertAfter(declarator.node, declarator.parentPath.node, () =>
            t.variableDeclarator(t.identifier(name), parseGeneratedExpression(code)),
          )
      }
      changed = true
    }
    if (!changed) return
  }
}

// 文種ごとの許可表ではなく、関数の本体を更新境界として解析する。
// 内側の関数は本体だけを別に変換するため、関数の作成と実行を混同せず、
// this・arguments・new.targetなど元の呼出し文脈を保持する。
function analyzeActionStatements(
  ctx: CompilerState,
  stmts: NodePath<t.Statement>[],
  instanceId: number,
  trackSharedWrites = true,
  flushOwnWrites = true,
  resultScopes: Map<t.Node, ReturnType<typeof analyzeFunctionBodyScope>> = new Map(),
): ActionScopeAnalysis {
  const dirtyName = flushOwnWrites ? stmts[0]!.scope.generateUidIdentifier('write').name : null

  const readDeclIds = new Set<DeclId>()
  const directWriteDeclIds = new Set<DeclId>()
  const directCollectionWriteDeclIds = new Set<DeclId>()
  const calleeNames = new Set<string>()
  const functionReferences: FunctionReference[] = []
  const edits: Edit[] = []
  const nestedScopes: ReturnType<typeof analyzeFunctionBodyScope>[] = []
  const astRoot = statementProgram(stmts)
  const ast = stmts.some((stmt) => usesTransformedAst(ctx, stmt as NodePath<t.Node>))
    ? createAstRewrite(astRoot)
    : null
  for (const stmt of stmts) {
    if (stmt.isFunctionDeclaration()) ctx.analyzedFunctions.add(stmt.node)
    else
      stmt.traverse({
        Function(path) {
          ctx.analyzedFunctions.add(path.node)
          path.skip()
        },
      })
    collectContextCalls(ctx, stmt as NodePath<t.Node>, readDeclIds, edits, null, ast, null, astRoot)
  }

  const visit = (idPath: NodePath<t.Identifier>) => {
    recordFunctionReference(ctx, idPath, instanceId, functionReferences)
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
      astRoot,
      ast,
      trackSharedWrites,
      dirtyName,
    )
  }

  const captureNested = (
    fnPath: NodePath<
      | t.FunctionDeclaration
      | t.FunctionExpression
      | t.ArrowFunctionExpression
      | t.ObjectMethod
      | t.ClassMethod
      | t.ClassPrivateMethod
    >,
  ) => {
    if (fnPath.parentPath?.isCallExpression() && fnPath.parentPath.node.callee === fnPath.node)
      collectCalledReads(ctx, fnPath, instanceId, readDeclIds)
    nestedScopes.push(
      resultScopes.get(fnPath.node) ??
        analyzeFunctionBodyScope(ctx, fnPath, instanceId, trackSharedWrites),
    )
    fnPath.skip()
  }

  for (const stmt of stmts) {
    if (stmt.isFunctionDeclaration()) {
      captureNested(stmt)
      continue
    }
    stmt.traverse({
      Identifier(idPath) {
        if (idPath.isReferencedIdentifier()) visit(idPath)
      },
      Function: captureNested,
      'ClassProperty|ClassPrivateProperty'(path: NodePath<t.Node>) {
        validateOutsideBodyState(ctx, path, instanceId)
      },
    })
  }

  // 同期helperの書込みだけを呼出し元の更新へ合流する。asyncや内側の
  // callbackの書込みは、下の所有範囲検証用の集合へ別に集める。
  collectTransitiveWrites(ctx, calleeNames, directWriteDeclIds, directCollectionWriteDeclIds)

  const writeDeclIds = new Set(directWriteDeclIds)
  const allCollectionWriteDeclIds = new Set(directCollectionWriteDeclIds)
  collectTransitiveWrites(
    ctx,
    calleeNames,
    writeDeclIds,
    allCollectionWriteDeclIds,
    new Set(),
    true,
  )

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
    calleeNames,
    readDeclIds,
    directWriteDeclIds,
    directCollectionWriteDeclIds,
    writeDeclIds,
    allCollectionWriteDeclIds,
    finalize: (resolveUpdateCall) => {
      const allEdits = [...edits]
      finalizeFunctionReferences(ctx, functionReferences, resolveUpdateCall, allEdits, ast)
      for (const child of nestedScopes) {
        const childCode = child.finalize(resolveUpdateCall)
        allEdits.push({
          start: child.start,
          end: child.end,
          text: childCode,
        })
        if (ast) {
          ast.replace(child.node, child.parent, child.depth, () =>
            parseGeneratedFunctionBody(childCode, child.parent),
          )
        }
      }
      const updateCall = flushOwnWrites
        ? resolveUpdateCall(directWriteDeclIds, directCollectionWriteDeclIds)
        : { code: '', needsCollectionBatch: false }
      cleanupLocalDeclarations(ctx, nestedScopes, allEdits, ast)
      const rendered = ast ? ast.generate() : render(ctx.source, start, end, allEdits)
      // NO_ACTION_UPDATEも計装済みsetterを受けるため、フラグ宣言は常に必要。
      if (!updateCall.code)
        return dirtyName && (directWriteDeclIds.size > 0 || calleeNames.size > 0)
          ? `let ${dirtyName} = false; ${rendered}`
          : rendered
      if (!dirtyName) return `${rendered}; ${updateCall.code}`
      const body = updateCall.needsCollectionBatch
        ? `__update_batch_depth__++; try { ${rendered} } finally { __update_batch_depth__--; if (${dirtyName}) { ${updateCall.code} } }`
        : `try { ${rendered} } finally { if (${dirtyName}) { ${updateCall.code} } }`
      return `let ${dirtyName} = false; ${body}`
    },
  }
}

// 式本体を更新境界へ変換するときも、その式の値をreturnして保持する。
// DOMイベント自身は値を利用しないので、イベント入口だけは式文にする。
function analyzeActionExprScope(
  ctx: CompilerState,
  exprPath: NodePath<t.Expression>,
  instanceId: number,
  trackSharedWrites = true,
  preserveReturn = true,
  resultScopes: Map<t.Node, ReturnType<typeof analyzeFunctionBodyScope>> = new Map(),
  asFunctionBody = false,
): ActionScopeAnalysis {
  const dirtyName = exprPath.scope.generateUidIdentifier('write').name
  const readDeclIds = new Set<DeclId>()
  const directWriteDeclIds = new Set<DeclId>()
  const directCollectionWriteDeclIds = new Set<DeclId>()
  const calleeNames = new Set<string>()
  const functionReferences: FunctionReference[] = []
  const edits: Edit[] = []
  const nestedScopes: ReturnType<typeof analyzeFunctionBodyScope>[] = []
  const ast = usesTransformedAst(ctx, exprPath as NodePath<t.Node>)
    ? createAstRewrite(exprPath.node)
    : null

  exprPath.traverse({
    Function(path) {
      ctx.analyzedFunctions.add(path.node)
      path.skip()
    },
  })
  collectContextCalls(ctx, exprPath, readDeclIds, edits, null, ast, null, exprPath.node)

  const visit = (idPath: NodePath<t.Identifier>) => {
    recordFunctionReference(ctx, idPath, instanceId, functionReferences)
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
      dirtyName,
    )
  }
  const captureNested = (
    fnPath: NodePath<
      | t.FunctionDeclaration
      | t.FunctionExpression
      | t.ArrowFunctionExpression
      | t.ObjectMethod
      | t.ClassMethod
      | t.ClassPrivateMethod
    >,
  ) => {
    if (fnPath.parentPath?.isCallExpression() && fnPath.parentPath.node.callee === fnPath.node)
      collectCalledReads(ctx, fnPath, instanceId, readDeclIds)
    nestedScopes.push(
      resultScopes.get(fnPath.node) ??
        analyzeFunctionBodyScope(ctx, fnPath, instanceId, trackSharedWrites),
    )
    fnPath.skip()
  }
  if (exprPath.isFunctionExpression() || exprPath.isArrowFunctionExpression())
    captureNested(exprPath)
  else {
    if (exprPath.isIdentifier()) visit(exprPath)
    exprPath.traverse({
      Identifier(idPath) {
        if (idPath.isReferencedIdentifier()) visit(idPath)
      },
      Function: captureNested,
      'ClassProperty|ClassPrivateProperty'(path: NodePath<t.Node>) {
        validateOutsideBodyState(ctx, path, instanceId)
      },
    })
  }
  collectTransitiveWrites(ctx, calleeNames, directWriteDeclIds, directCollectionWriteDeclIds)

  const writeDeclIds = new Set(directWriteDeclIds)
  const allCollectionWriteDeclIds = new Set(directCollectionWriteDeclIds)
  collectTransitiveWrites(
    ctx,
    calleeNames,
    writeDeclIds,
    allCollectionWriteDeclIds,
    new Set(),
    true,
  )
  for (const child of nestedScopes) {
    for (const id of child.writeDeclIds) writeDeclIds.add(id)
    for (const id of child.allCollectionWriteDeclIds) allCollectionWriteDeclIds.add(id)
  }

  const start = exprPath.node.start!
  const end = exprPath.node.end!
  return {
    calleeNames,
    readDeclIds,
    directWriteDeclIds,
    directCollectionWriteDeclIds,
    writeDeclIds,
    allCollectionWriteDeclIds,
    finalize: (resolveUpdateCall) => {
      const allEdits = [...edits]
      finalizeFunctionReferences(ctx, functionReferences, resolveUpdateCall, allEdits, ast)
      for (const child of nestedScopes) {
        const childCode = child.finalize(resolveUpdateCall)
        allEdits.push({
          start: child.start,
          end: child.end,
          text: childCode,
        })
        if (ast) {
          ast.replace(child.node, child.parent, child.depth, () =>
            parseGeneratedFunctionBody(childCode, child.parent),
          )
        }
      }
      const updateCall = resolveUpdateCall(directWriteDeclIds, directCollectionWriteDeclIds)
      cleanupLocalDeclarations(ctx, nestedScopes, allEdits, ast)
      const rendered = ast ? ast.generate() : render(ctx.source, start, end, allEdits)
      const body = `${preserveReturn ? 'return ' : ''}(${rendered});`
      if (!updateCall.code)
        return directWriteDeclIds.size > 0 || calleeNames.size > 0
          ? `{ let ${dirtyName} = false; ${body} }`
          : asFunctionBody
            ? body
            : rendered
      const guardedBody = updateCall.needsCollectionBatch
        ? `__update_batch_depth__++; try { ${body} } finally { __update_batch_depth__--; if (${dirtyName}) { ${updateCall.code} } }`
        : `try { ${body} } finally { if (${dirtyName}) { ${updateCall.code} } }`
      return `{ let ${dirtyName} = false; ${guardedBody} }`
    },
  }
}

function compileErrorAtNode(message: string, path: NodePath<t.Node>): Error {
  const error = new Error(message)
  if (path.node.loc)
    Object.defineProperty(error, 'loc', { value: path.node.loc, configurable: true })
  return error
}

function validateOutsideBodyState(
  ctx: CompilerState,
  path: NodePath<t.Node>,
  instanceId: number,
  inspectNestedFunctions = false,
): void {
  const visit = (idPath: NodePath<t.Identifier>) => {
    if (idPath.isReferencedIdentifier() && resolveDeclId(ctx, idPath, instanceId)) {
      throw compileErrorAtNode(
        'compile: signal references outside function bodies (parameter initializers, class fields, computed method names) are not supported yet (scope limit)',
        idPath,
      )
    }
  }
  if (path.isIdentifier()) visit(path)
  path.traverse({
    Function(inner) {
      // フィールドの関数本体は通常の走査で変換するが、引数と計算名は
      // 全体を飛ばすため、その内部の関数もここで検査する必要がある。
      if (!inspectNestedFunctions) inner.skip()
    },
    Identifier: visit,
  })
}

// 引数の初期化は本体より先に実行されるので、本体の更新境界へ混ぜない。
// generatorの中断・再開は通常の関数出口とは異なるため、別の変換を要する。
function validateFunctionBoundary(
  ctx: CompilerState,
  fnPath: NodePath<t.Function>,
  instanceId: number,
): void {
  if ('generator' in fnPath.node && fnPath.node.generator) {
    throw compileErrorAtNode(
      'compile: generator function bodies are not supported yet (scope limit)',
      fnPath,
    )
  }
  for (const param of fnPath.get('params') as NodePath<t.Node>[]) {
    validateOutsideBodyState(ctx, param, instanceId, true)
  }
  if ('computed' in fnPath.node && fnPath.node.computed) {
    validateOutsideBodyState(ctx, fnPath.get('key') as NodePath<t.Node>, instanceId, true)
  }
}

// 関数式/arrow 1個ぶんの本体(ブロック or concise)を、置換対象の範囲
// ([start,end) -- ブロックなら中括弧込み、concise なら式そのもの)ごと解析する。
// action本体中のネストした関数(design D4-1)と、返り値クロージャ(D4-2)の
// 両方から使う共通処理。
function analyzeFunctionBodyScope(
  ctx: CompilerState,
  fnPath: NodePath<
    | t.FunctionDeclaration
    | t.FunctionExpression
    | t.ArrowFunctionExpression
    | t.ObjectMethod
    | t.ClassMethod
    | t.ClassPrivateMethod
  >,
  instanceId: number,
  trackSharedWrites = true,
): {
  functionPath: NodePath<t.Function>
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
  validateFunctionBoundary(ctx, fnPath, instanceId)
  const bodyPath = fnPath.get('body')
  if (bodyPath.isBlockStatement()) {
    const stmts = bodyPath.get('body') as NodePath<t.Statement>[]
    const inner =
      stmts.length > 0
        ? analyzeActionStatements(ctx, stmts, instanceId, trackSharedWrites)
        : {
            finalize: () => '',
            calleeNames: new Set<string>(),
            readDeclIds: new Set<DeclId>(),
            directWriteDeclIds: new Set<DeclId>(),
            directCollectionWriteDeclIds: new Set<DeclId>(),
            writeDeclIds: new Set<DeclId>(),
            allCollectionWriteDeclIds: new Set<DeclId>(),
          }
    return {
      functionPath: fnPath,
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
      finalize: (resolveUpdateCall) =>
        `{${mappedSource(inner.finalize(resolveUpdateCall), stmts[0]?.node.start ?? bodyPath.node.start!)}}`,
    }
  }
  const exprScope = analyzeActionExprScope(
    ctx,
    bodyPath as NodePath<t.Expression>,
    instanceId,
    trackSharedWrites,
  )
  return {
    functionPath: fnPath,
    start: bodyPath.node.start!,
    end: bodyPath.node.end!,
    node: bodyPath.node,
    parent: fnPath.node,
    depth: pathDepth(bodyPath as NodePath<t.Node>),
    finalize: (resolveUpdateCall) =>
      mappedSource(exprScope.finalize(resolveUpdateCall), bodyPath.node.start!),
    readDeclIds: exprScope.readDeclIds,
    directWriteDeclIds: exprScope.directWriteDeclIds,
    directCollectionWriteDeclIds: exprScope.directCollectionWriteDeclIds,
    writeDeclIds: exprScope.writeDeclIds,
    allCollectionWriteDeclIds: exprScope.allCollectionWriteDeclIds,
  }
}

export interface ActionBodyAnalysis {
  finalizeBody: (resolveUpdateCall: ResolveUpdateCall) => string
  readDeclIds: Set<DeclId>
  hasResult: boolean
  resultDeps: Set<DeclId>
  writeDeclIds: Set<DeclId>
  directCollectionWriteDeclIds: Set<DeclId>
}

// 空の表示用生成と後始末の最終化は、補助関数の呼出し先が異なる。
const NO_ACTION_UPDATE: ResolveUpdateCall = () => ({ code: '', needsCollectionBatch: false })
const NO_ACTION_RENDER: ResolveUpdateCall = () => ({ code: '', needsCollectionBatch: false })

// 後始末用の別名関数は元の定義と同じ字句範囲へ生成する。通常の関数と
// 出口の更新を分け、asyncやcallbackも生存するDOMへ更新しない。
const NO_HELPER_UPDATE: ResolveUpdateCall = () => ({ code: '', needsCollectionBatch: false })

type LifecycleKind = 'action' | 'onMount' | 'effect'

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

// 初期化自身のreturnだけを検査し、返却関数の実行時点と更新契約を
// 共通の本体解析へ渡す。returnを本文から取り出さないため、分岐やfinally、
// const/letの閉包とJavaScriptの返却順序をそのまま保持できる。
function analyzeLifecycleBody(
  ctx: CompilerState,
  body: NodePath<t.Expression> | NodePath<t.Statement>[],
  instanceId: number,
  kind: LifecycleKind,
): ActionBodyAnalysis {
  // 返却関数が初期化本体の局所関数を参照できるよう、返却の解析より先に登録する。
  if (Array.isArray(body)) {
    for (const stmt of body) {
      if (stmt.isFunctionDeclaration()) ctx.analyzedFunctions.add(stmt.node)
      else
        stmt.traverse({
          Function(path) {
            ctx.analyzedFunctions.add(path.node)
            path.skip()
          },
        })
    }
  }
  const resultScopes = new Map<t.Node, ReturnType<typeof analyzeFunctionBodyScope>>()
  const resultDeps = new Set<DeclId>()
  let hasResult = false
  const invalidResult = (path: NodePath<t.Node>) =>
    compileErrorAtNode(
      kind === 'action'
        ? 'compile: an action can only return a zero-argument update closure or { update?, destroy? } (scope limit)'
        : `compile: ${kind}() may only return a zero-argument cleanup function (scope limit)`,
      path,
    )
  const addResultFunction = (path: ActionResultFunctionPath, update: boolean) => {
    if (path.node.params.length !== 0) throw invalidResult(path)
    const scope = analyzeFunctionBodyScope(ctx, path, instanceId)
    if (update) for (const id of scope.readDeclIds) resultDeps.add(id)
    resultScopes.set(path.node, {
      ...scope,
      finalize: (resolve) => scope.finalize(update ? resolve : NO_ACTION_UPDATE),
    })
    hasResult = true
  }
  const validateResult = (path: NodePath<t.Expression>): void => {
    if (path.isIdentifier({ name: 'undefined' }) && !path.scope.getBinding('undefined')) return
    if (path.isUnaryExpression({ operator: 'void' })) return
    if (path.isConditionalExpression()) {
      validateResult(path.get('consequent'))
      validateResult(path.get('alternate'))
      return
    }
    if (path.isFunctionExpression() || path.isArrowFunctionExpression()) {
      addResultFunction(path, kind === 'action')
      return
    }
    if (!path.isObjectExpression() || kind !== 'action') throw invalidResult(path)
    const seen = new Set<string>()
    for (const property of path.get('properties') as NodePath<
      t.ObjectProperty | t.ObjectMethod | t.SpreadElement
    >[]) {
      const name = actionResultPropertyName(property)
      if (name !== 'update' && name !== 'destroy') {
        throw compileErrorAtNode(
          'compile: an action result object may only contain update and destroy (scope limit)',
          property,
        )
      }
      if (seen.has(name))
        throw compileErrorAtNode(
          `compile: an action result object cannot repeat ${name} (scope limit)`,
          property,
        )
      seen.add(name)
      const fn = actionResultFunctionPath(property)
      if (!fn || fn.node.params.length !== 0) {
        throw compileErrorAtNode(
          `compile: an action result object ${name} must be a zero-argument function (scope limit)`,
          property,
        )
      }
      addResultFunction(fn, name === 'update')
    }
    hasResult = true
  }
  const visitReturn = (path: NodePath<t.ReturnStatement>) => {
    if (path.node.argument) validateResult(path.get('argument') as NodePath<t.Expression>)
  }
  if (Array.isArray(body)) {
    for (const stmt of body) {
      if (stmt.isFunctionDeclaration()) continue
      if (stmt.isReturnStatement()) visitReturn(stmt)
      stmt.traverse({
        Function(path) {
          path.skip()
        },
        ReturnStatement: visitReturn,
      })
    }
    if (body.length === 0)
      return {
        finalizeBody: () => '',
        readDeclIds: new Set(),
        hasResult,
        resultDeps,
        writeDeclIds: new Set(),
        directCollectionWriteDeclIds: new Set(),
      }
    const scope = analyzeActionStatements(ctx, body, instanceId, true, true, resultScopes)
    return {
      finalizeBody: scope.finalize,
      readDeclIds: scope.readDeclIds,
      hasResult,
      resultDeps,
      writeDeclIds: scope.writeDeclIds,
      directCollectionWriteDeclIds: scope.allCollectionWriteDeclIds,
    }
  }
  const isResultExpression = (path: NodePath<t.Expression>): boolean =>
    path.isFunctionExpression() ||
    path.isArrowFunctionExpression() ||
    path.isObjectExpression() ||
    (path.isConditionalExpression() &&
      (isResultExpression(path.get('consequent')) || isResultExpression(path.get('alternate'))))
  const returnsResult = isResultExpression(body)
  if (returnsResult) validateResult(body)
  const scope = analyzeActionExprScope(
    ctx,
    body,
    instanceId,
    true,
    returnsResult,
    resultScopes,
    true,
  )
  return {
    finalizeBody: scope.finalize,
    readDeclIds: scope.readDeclIds,
    hasResult,
    resultDeps,
    writeDeclIds: scope.writeDeclIds,
    directCollectionWriteDeclIds: scope.allCollectionWriteDeclIds,
  }
}

export function analyzeActionBody(
  ctx: CompilerState,
  body: NodePath<t.Expression> | NodePath<t.Statement>[],
  instanceId: number,
): ActionBodyAnalysis {
  return analyzeLifecycleBody(ctx, body, instanceId, 'action')
}

export interface MountBodyAnalysis {
  finalizeBody: (resolveUpdateCall: ResolveUpdateCall) => string
  readDeclIds: Set<DeclId>
  writeDeclIds: Set<DeclId>
  directCollectionWriteDeclIds: Set<DeclId>
  hasCleanup: boolean
}

export function analyzeMountBody(
  ctx: CompilerState,
  callbackPath: NodePath<t.ArrowFunctionExpression>,
  instanceId: number,
): MountBodyAnalysis {
  const bodyPath = callbackPath.get('body')
  const body = bodyPath.isBlockStatement()
    ? (bodyPath.get('body') as NodePath<t.Statement>[])
    : (bodyPath as NodePath<t.Expression>)
  const analysis = analyzeLifecycleBody(ctx, body, instanceId, 'onMount')
  return {
    finalizeBody: analysis.finalizeBody,
    readDeclIds: analysis.readDeclIds,
    writeDeclIds: analysis.writeDeclIds,
    directCollectionWriteDeclIds: analysis.directCollectionWriteDeclIds,
    hasCleanup: analysis.hasResult,
  }
}

export interface EffectBodyAnalysis {
  finalizeBody: (resolveUpdateCall: ResolveUpdateCall) => string
  readDeclIds: Set<DeclId>
  hasCleanup: boolean
}

export function analyzeEffectBody(
  ctx: CompilerState,
  callbackPath: NodePath<t.ArrowFunctionExpression>,
  instanceId: number,
): EffectBodyAnalysis {
  const bodyPath = callbackPath.get('body')
  const body = bodyPath.isBlockStatement()
    ? (bodyPath.get('body') as NodePath<t.Statement>[])
    : (bodyPath as NodePath<t.Expression>)
  const analysis = analyzeLifecycleBody(ctx, body, instanceId, 'effect')
  if (analysis.writeDeclIds.size > 0)
    throw new Error('compile: effect() cannot write tracked signals (scope limit)')
  return {
    finalizeBody: analysis.finalizeBody,
    readDeclIds: analysis.readDeclIds,
    hasCleanup: analysis.hasResult,
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
