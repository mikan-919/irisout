// 式の解析:識別子を追跡中の declId に解決し、(a) ビルド時実行用のソース
// (ADR-0001 #3 discovery で使う本物の signal/derived アクセサ呼び出しを保つ)
// と (b) 本番出力用のソース (ADR-0006: signal()/derived() ラッパーを持たない
// ので `count()` のような読み取り呼び出しを裸の識別子 `count` へ書き換える)
// の両方を組み立てる。

import type { NodePath } from '@babel/traverse'
import type * as t from '@babel/types'
import { resolveToSignals } from './decl-graph.js'
import type { CompilerState, DeclId } from './state.js'
import { declKey } from './state.js'

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
  return ctx.declIdByKey.get(declKey(instanceId, start)) ?? null
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

function render(
  source: string,
  start: number,
  end: number,
  edits: Edit[],
): string {
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

export function analyzeExpr(
  ctx: CompilerState,
  path: NodePath<t.Expression>,
  instanceId: number,
): AnalyzeResult {
  const deps = new Set<DeclId>()
  const outputEdits: Edit[] = []
  const sourceEdits: Edit[] = []

  const visit = (idPath: NodePath<t.Identifier>) => {
    const id = resolveDeclId(ctx, idPath, instanceId)
    if (!id) return
    deps.add(id)
    const outputName = ctx.declOutputName.get(id)
    if (!outputName) return

    const idStart = idPath.node.start!
    const idEnd = idPath.node.end!
    if (outputName !== idPath.node.name) {
      sourceEdits.push({ start: idStart, end: idEnd, text: outputName })
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
      outputEdits.push({
        start: parent.node.start!,
        end: parent.node.end!,
        text: outputName,
      })
      return
    }

    if (outputName !== idPath.node.name) {
      outputEdits.push({ start: idStart, end: idEnd, text: outputName })
    }
  }

  forEachReferencedIdentifier(path, visit)

  const start = path.node.start!
  const end = path.node.end!
  return {
    deps,
    rendered: render(ctx.source, start, end, outputEdits),
    sourceRendered: render(ctx.source, start, end, sourceEdits),
  }
}

export interface HandlerAnalysis {
  /** 出力向け(書き込み呼び出しを代入文へ書き換え済み)。 */
  rendered: string
  /** このハンドラが書き込む root signal の declId 集合(推移解決済み)。 */
  writeDeclIds: Set<DeclId>
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
  const edits: Edit[] = []

  const visit = (idPath: NodePath<t.Identifier>) => {
    const id = resolveDeclId(ctx, idPath, instanceId)
    if (!id) return
    const outputName = ctx.declOutputName.get(id)
    if (!outputName) return

    const parent = idPath.parentPath
    if (parent?.isCallExpression() && parent.node.callee === idPath.node) {
      if (parent.node.arguments.length === 0) {
        edits.push({
          start: parent.node.start!,
          end: parent.node.end!,
          text: outputName,
        })
        return
      }
      if (parent.node.arguments.length > 1) {
        throw new Error(
          `compile: signal writes take exactly one argument, got ${parent.node.arguments.length} for "${idPath.node.name}" (scope limit)`,
        )
      }
      if (ctx.declKind.get(id) === 'derived') {
        throw new Error(
          `compile: cannot write to derived "${idPath.node.name}"`,
        )
      }
      const arg = parent.node.arguments[0]!
      edits.push({
        start: parent.node.start!,
        end: arg.start!,
        text: `${outputName} = `,
      })
      edits.push({ start: arg.end!, end: parent.node.end!, text: '' })
      for (const sig of resolveToSignals(ctx, id, new Set()))
        writeDeclIds.add(sig)
      return
    }

    if (outputName !== idPath.node.name) {
      edits.push({
        start: idPath.node.start!,
        end: idPath.node.end!,
        text: outputName,
      })
    }
  }

  forEachReferencedIdentifier(exprPath, visit)

  return {
    rendered: render(
      ctx.source,
      exprPath.node.start!,
      exprPath.node.end!,
      edits,
    ),
    writeDeclIds,
  }
}

// ADR-0009 D2: IfStatement の consequent/alternate は「4文種そのもの」か
// 「4文種のみからなる BlockStatement」のどちらか。両形を同じ文配列へ均す。
function eachBranchStatement(
  branch: NodePath<t.Statement>,
): NodePath<t.Statement>[] {
  return branch.isBlockStatement()
    ? (branch.get('body') as NodePath<t.Statement>[])
    : [branch]
}

// ADR-0009 D2/質問2: 4文種(式文 / const・let / if / 裸の return)以外・
// var・値を返す return を compile error で拒否する。if の枝は再帰検証する。
// allowValueReturn: ADR-0011 design D4-1。action本体にネストした関数式/arrow
// 自身の return は「通常の関数の返り値」でありこの規則の対象外(design.md
// Decision 4-1)なので、その本体を検証する再帰呼び出しでのみ true を渡す。
function validateHandlerStatement(
  stmt: NodePath<t.Statement>,
  allowValueReturn = false,
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
      throw new Error(
        'compile: a handler `return` must not return a value (scope limit)',
      )
    }
    return
  }
  if (stmt.isIfStatement()) {
    for (const s of eachBranchStatement(
      stmt.get('consequent') as NodePath<t.Statement>,
    )) {
      validateHandlerStatement(s, allowValueReturn)
    }
    const alt = stmt.get('alternate')
    if (alt.node) {
      for (const s of eachBranchStatement(alt as NodePath<t.Statement>)) {
        validateHandlerStatement(s, allowValueReturn)
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
    for (const s of eachBranchStatement(
      stmt.get('consequent') as NodePath<t.Statement>,
    )) {
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
  for (const stmt of stmts) validateHandlerStatement(stmt)

  if (stmts.length === 0) return { rendered: '', writeDeclIds: new Set() }

  const writeDeclIds = new Set<DeclId>()
  const edits: Edit[] = []
  let firstWriteStart: number | null = null

  const visit = (idPath: NodePath<t.Identifier>) => {
    const id = resolveDeclId(ctx, idPath, instanceId)
    if (!id) return
    const outputName = ctx.declOutputName.get(id)
    if (!outputName) return

    const parent = idPath.parentPath
    if (parent?.isCallExpression() && parent.node.callee === idPath.node) {
      if (parent.node.arguments.length === 0) {
        edits.push({
          start: parent.node.start!,
          end: parent.node.end!,
          text: outputName,
        })
        return
      }
      if (parent.node.arguments.length > 1) {
        throw new Error(
          `compile: signal writes take exactly one argument, got ${parent.node.arguments.length} for "${idPath.node.name}" (scope limit)`,
        )
      }
      if (ctx.declKind.get(id) === 'derived') {
        throw new Error(
          `compile: cannot write to derived "${idPath.node.name}"`,
        )
      }
      const arg = parent.node.arguments[0]!
      edits.push({
        start: parent.node.start!,
        end: arg.start!,
        text: `${outputName} = `,
      })
      edits.push({ start: arg.end!, end: parent.node.end!, text: '' })
      if (firstWriteStart == null || parent.node.start! < firstWriteStart) {
        firstWriteStart = parent.node.start!
      }
      for (const sig of resolveToSignals(ctx, id, new Set()))
        writeDeclIds.add(sig)
      return
    }

    if (outputName !== idPath.node.name) {
      edits.push({
        start: idPath.node.start!,
        end: idPath.node.end!,
        text: outputName,
      })
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
    rendered: render(
      ctx.source,
      stmts[0]!.node.start!,
      stmts[stmts.length - 1]!.node.end!,
      edits,
    ),
    writeDeclIds,
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
  onWrite: (start: number) => void,
): void {
  const id = resolveDeclId(ctx, idPath, instanceId)
  if (!id) return
  const outputName = ctx.declOutputName.get(id)
  if (!outputName) return

  const parent = idPath.parentPath
  if (parent?.isCallExpression() && parent.node.callee === idPath.node) {
    if (parent.node.arguments.length === 0) {
      readDeclIds.add(id)
      edits.push({
        start: parent.node.start!,
        end: parent.node.end!,
        text: outputName,
      })
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
      text: `${outputName} = `,
    })
    edits.push({ start: arg.end!, end: parent.node.end!, text: '' })
    for (const sig of resolveToSignals(ctx, id, new Set()))
      writeDeclIds.add(sig)
    onWrite(parent.node.start!)
    return
  }

  readDeclIds.add(id)
  if (outputName !== idPath.node.name) {
    edits.push({
      start: idPath.node.start!,
      end: idPath.node.end!,
      text: outputName,
    })
  }
}

interface ActionScopeAnalysis {
  /** signalToMarkers 確定後に、このスコープ末尾へ挿入する update_* 呼び出し
   * (design Decision 5)込みの最終テキストを組み立てる。 */
  finalize: (resolveUpdateNames: (ids: Set<DeclId>) => string[]) => string
  /** このスコープが直接読む signal/derived(推移解決前)。クロージャの依存
   * 解析にのみ使う。 */
  readDeclIds: Set<DeclId>
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
): ActionScopeAnalysis {
  for (const stmt of stmts) validateHandlerStatement(stmt, allowValueReturn)

  const readDeclIds = new Set<DeclId>()
  const writeDeclIds = new Set<DeclId>()
  const edits: Edit[] = []
  const nestedScopes: ReturnType<typeof analyzeFunctionBodyScope>[] = []
  let firstWriteStart: number | null = null

  const visit = (idPath: NodePath<t.Identifier>) =>
    analyzeActionIdentifier(
      ctx,
      instanceId,
      idPath,
      edits,
      readDeclIds,
      writeDeclIds,
      (pos) => {
        if (firstWriteStart == null || pos < firstWriteStart) {
          firstWriteStart = pos
        }
      },
    )

  const captureNested = (
    fnPath: NodePath<t.FunctionExpression | t.ArrowFunctionExpression>,
  ) => {
    nestedScopes.push(analyzeFunctionBodyScope(ctx, fnPath, instanceId))
    fnPath.skip()
  }

  for (const stmt of stmts) {
    stmt.traverse({
      Identifier(idPath) {
        if (idPath.isReferencedIdentifier()) visit(idPath)
      },
      FunctionExpression: captureNested,
      ArrowFunctionExpression: captureNested,
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

  const start = stmts[0]!.node.start!
  const end = stmts[stmts.length - 1]!.node.end!

  return {
    readDeclIds,
    finalize: (resolveUpdateNames) => {
      const allEdits = [...edits]
      for (const child of nestedScopes) {
        allEdits.push({
          start: child.start,
          end: child.end,
          text: child.finalize(resolveUpdateNames),
        })
      }
      const names = resolveUpdateNames(writeDeclIds)
      if (names.length > 0) {
        allEdits.push({
          start: end,
          end,
          text: ` ${names.map((n) => `update_${n}();`).join(' ')}`,
        })
      }
      return render(ctx.source, start, end, allEdits)
    },
  }
}

// 単一式本体(inline arrow の concise body)向けの同型解析。文レベルの
// 4文種検証・D3 は該当しない(式1つなので早期 return が存在しえない)。
// 書き込みが挿入する update_* が必要になった場合のみブロックへ包む
// (design D4-1: 「同じ書き換え」を式本体にも適用する最小コスト実装)。
//
// ponytail: 式本体の中に更にネストした関数(リスナー等)がある場合、その
// 内部の書き込みはこのスコープの writeDeclIds に合流し、末尾(式全体の後)に
// まとめて update_* が挿入される -- ネストしたリスナー発火のたびではなく
// 式本体自身が実行された時点になる。ブロック本体(analyzeActionStatements)
// は正しく分離するが、concise body の入れ子分離は実例が出た時点で拡張する。
function analyzeActionExprScope(
  ctx: CompilerState,
  exprPath: NodePath<t.Expression>,
  instanceId: number,
): ActionScopeAnalysis {
  const readDeclIds = new Set<DeclId>()
  const writeDeclIds = new Set<DeclId>()
  const edits: Edit[] = []

  forEachReferencedIdentifier(exprPath, (idPath) =>
    analyzeActionIdentifier(
      ctx,
      instanceId,
      idPath,
      edits,
      readDeclIds,
      writeDeclIds,
      () => {},
    ),
  )

  const start = exprPath.node.start!
  const end = exprPath.node.end!
  return {
    readDeclIds,
    finalize: (resolveUpdateNames) => {
      const rendered = render(ctx.source, start, end, edits)
      const names = resolveUpdateNames(writeDeclIds)
      return names.length > 0
        ? `{ ${rendered}; ${names.map((n) => `update_${n}();`).join(' ')} }`
        : rendered
    },
  }
}

// 関数式/arrow 1個ぶんの本体(ブロック or concise)を、置換対象の範囲
// ([start,end) -- ブロックなら中括弧込み、concise なら式そのもの)ごと解析する。
// action本体中のネストした関数(design D4-1)と、返り値クロージャ(D4-2)の
// 両方から使う共通処理。
function analyzeFunctionBodyScope(
  ctx: CompilerState,
  fnPath: NodePath<t.FunctionExpression | t.ArrowFunctionExpression>,
  instanceId: number,
): {
  start: number
  end: number
  finalize: (resolveUpdateNames: (ids: Set<DeclId>) => string[]) => string
  readDeclIds: Set<DeclId>
} {
  const bodyPath = fnPath.get('body')
  if (bodyPath.isBlockStatement()) {
    const stmts = bodyPath.get('body') as NodePath<t.Statement>[]
    const inner =
      stmts.length > 0
        ? analyzeActionStatements(ctx, stmts, instanceId, true)
        : { finalize: () => '', readDeclIds: new Set<DeclId>() }
    return {
      start: bodyPath.node.start!,
      end: bodyPath.node.end!,
      readDeclIds: inner.readDeclIds,
      finalize: (resolveUpdateNames) =>
        `{${inner.finalize(resolveUpdateNames)}}`,
    }
  }
  const exprScope = analyzeActionExprScope(
    ctx,
    bodyPath as NodePath<t.Expression>,
    instanceId,
  )
  return {
    start: bodyPath.node.start!,
    end: bodyPath.node.end!,
    finalize: exprScope.finalize,
    readDeclIds: exprScope.readDeclIds,
  }
}

export interface ActionBodyAnalysis {
  finalizeBody: (resolveUpdateNames: (ids: Set<DeclId>) => string[]) => string
  /** 返り値クロージャ(design D4-2)。無ければ null(design Decision 5: 配線
   * コード自体を生成しない)。 */
  closure: {
    finalize: (resolveUpdateNames: (ids: Set<DeclId>) => string[]) => string
    /** クロージャが直接読む signal/derived(推移解決前 -- ctx.markerDeps と
     * 同じ形、resolveToSignals による展開は compiler.ts の buildSignalToMarkers
     * に任せる)。 */
    deps: Set<DeclId>
  } | null
}

// ADR-0011 design D4/D5: action本体の解析エントリポイント。render.ts の
// resolveHandlerBody が返す body(ブロック文配列 or inline arrow の単一式)を
// そのまま受け取る。本体トップレベルの末尾 `return <0引数関数式>` だけを
// 返り値クロージャとして分離し(D4-2)、残りの文には通常のハンドラ同型解析
// (ネストした関数本体への再帰込み、D4-1)を適用する。
export function analyzeActionBody(
  ctx: CompilerState,
  body: NodePath<t.Expression> | NodePath<t.Statement>[],
  instanceId: number,
): ActionBodyAnalysis {
  if (!Array.isArray(body)) {
    const scope = analyzeActionExprScope(ctx, body, instanceId)
    return { finalizeBody: scope.finalize, closure: null }
  }

  const last = body[body.length - 1]
  let bodyStmts = body
  let closure: ActionBodyAnalysis['closure'] = null

  if (last?.isReturnStatement() && last.node.argument != null) {
    const argPath = last.get('argument') as NodePath<t.Expression>
    if (
      (!argPath.isFunctionExpression() &&
        !argPath.isArrowFunctionExpression()) ||
      argPath.node.params.length !== 0
    ) {
      throw new Error(
        'compile: an action can only `return` a zero-argument closure (scope limit)',
      )
    }
    bodyStmts = body.slice(0, -1)
    const closureScope = analyzeFunctionBodyScope(ctx, argPath, instanceId)
    // クロージャは0引数(検証済み)なので、関数キーワード/params/矢印までの
    // 前置テキストは書き換え不要でそのまま source から取り出せる。
    const prefix = ctx.source.slice(argPath.node.start!, closureScope.start)
    closure = {
      deps: closureScope.readDeclIds,
      finalize: (resolveUpdateNames) =>
        `${prefix}${closureScope.finalize(resolveUpdateNames)}`,
    }
  }

  const bodyScope =
    bodyStmts.length > 0
      ? analyzeActionStatements(ctx, bodyStmts, instanceId, false)
      : { finalize: () => '' }

  return { finalizeBody: bodyScope.finalize, closure }
}

// `count()` のような裸の読み取り - 追跡済み signal/derived の引数なし
// 呼び出しで周囲に計算がないもの。M1 では prop エイリアスは使わないが、
// 将来のマイルストーンで再利用するため legacy 同様の形で残す。
export function bareTrackedDeclId(
  ctx: CompilerState,
  exprPath: NodePath<t.Expression>,
  instanceId: number,
): DeclId | null {
  if (!exprPath.isCallExpression() || exprPath.node.arguments.length !== 0)
    return null
  const callee = exprPath.get('callee')
  if (!callee.isIdentifier()) return null
  return resolveDeclId(ctx, callee, instanceId)
}
