// 式の解析:識別子を追跡中の declId に解決し、(a) ビルド時実行用のソース
// (ADR-0001 #3 discovery で使う本物の signal/derived アクセサ呼び出しを保つ)
// と (b) 本番出力用のソース (ADR-0006: signal()/derived() ラッパーを持たない
// ので `count()` のような読み取り呼び出しを裸の識別子 `count` へ書き換える)
// の両方を組み立てる。

import type { NodePath } from '@babel/traverse'
import type * as t from '@babel/types'
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

  if (path.isIdentifier()) visit(path)
  path.traverse({
    Identifier(idPath) {
      if (idPath.isReferencedIdentifier()) visit(idPath)
    },
  })

  const start = path.node.start!
  const end = path.node.end!
  return {
    deps,
    rendered: render(ctx.source, start, end, outputEdits),
    sourceRendered: render(ctx.source, start, end, sourceEdits),
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
  if (!exprPath.isCallExpression() || exprPath.node.arguments.length !== 0)
    return null
  const callee = exprPath.get('callee')
  if (!callee.isIdentifier()) return null
  return resolveDeclId(ctx, callee, instanceId)
}
