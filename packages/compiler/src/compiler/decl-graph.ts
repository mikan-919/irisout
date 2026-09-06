// declId の依存グラフ:derived を辿ってルート signal の集合まで展開する。
// analyze.ts(将来のハンドラの書き込み先解決)と compiler.ts(marker -> signal の
// 推移閉包)の両方から使う。

import type { CompilerState, DeclId } from './state.ts'

/**
 * derived の依存先だけを辿り、循環を検出する。`resolveToSignals` は呼び出し
 * 側ごとに新しい集合を渡すため、ここではコンパイル済み宣言を一度に検査する。
 */
export function assertAcyclicDerivedGraph(ctx: CompilerState): void {
  const visiting = new Set<DeclId>()
  const visited = new Set<DeclId>()

  const visit = (derivedId: DeclId): void => {
    if (visited.has(derivedId)) return
    if (visiting.has(derivedId)) {
      throw new Error(`compile: derived dependency cycle includes "${derivedId}"`)
    }
    visiting.add(derivedId)
    for (const dependency of ctx.derivedDeps.get(derivedId) ?? []) {
      if (ctx.derivedDeps.has(dependency)) visit(dependency)
    }
    visiting.delete(derivedId)
    visited.add(derivedId)
  }

  for (const derivedId of ctx.derivedDeps.keys()) visit(derivedId)
}

export function resolveToSignals(
  ctx: CompilerState,
  declId: DeclId,
  visited: Set<DeclId>,
): Set<DeclId> {
  if (visited.has(declId)) {
    throw new Error(`compile: derived dependency cycle includes "${declId}"`)
  }
  visited.add(declId)
  if (ctx.declKind.get(declId) !== 'derived') {
    visited.delete(declId)
    return new Set([declId])
  }
  const result = new Set<DeclId>()
  for (const upstream of ctx.derivedDeps.get(declId) ?? []) {
    for (const sig of resolveToSignals(ctx, upstream, visited)) result.add(sig)
  }
  visited.delete(declId)
  return result
}
