// declId の依存グラフ:derived を辿ってルート signal の集合まで展開する。
// analyze.ts(将来のハンドラの書き込み先解決)と compiler.ts(marker -> signal の
// 推移閉包)の両方から使う。

import type { CompilerState, DeclId } from './state.ts'

export function resolveToSignals(
  ctx: CompilerState,
  declId: DeclId,
  visited: Set<DeclId>,
): Set<DeclId> {
  if (visited.has(declId)) return new Set()
  visited.add(declId)
  if (ctx.declKind.get(declId) === 'signal') return new Set([declId])
  const result = new Set<DeclId>()
  for (const upstream of ctx.derivedDeps.get(declId) ?? []) {
    for (const sig of resolveToSignals(ctx, upstream, visited)) result.add(sig)
  }
  return result
}
