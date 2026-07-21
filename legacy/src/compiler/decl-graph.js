// declId の依存グラフ:derived を辿ってルート signal の集合まで展開する。
// analyze.js(ハンドラの書き込み先解決)と compiler.js(marker -> signal の
// 推移閉包)の両方から使う。

export function resolveToSignals(ctx, declId, visited) {
  if (visited.has(declId)) return new Set();
  visited.add(declId);
  if (ctx.declKind.get(declId) === 'signal') return new Set([declId]);
  const result = new Set();
  for (const upstream of ctx.derivedDeps.get(declId) ?? []) {
    for (const sig of resolveToSignals(ctx, upstream, visited)) result.add(sig);
  }
  return result;
}
