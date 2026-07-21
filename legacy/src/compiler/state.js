// compile() 全体で共有するミュータブルな状態。analyze.js / render.js /
// decl-graph.js はここで作った ctx を受け取って読み書きする。

export function createCompilerState(source) {
  return {
    source,
    sliceSrc: (path) => source.slice(path.node.start, path.node.end),

    // key: `${instanceId}:${declaratorStart}` -> declId。同じ declarator ノードは
    // コンポーネントのインスタンスごとに再訪されるので複合キーにしている。
    declIdByKey: new Map(),
    declKind: new Map(), // declId -> 'signal' | 'derived'
    declOutputName: new Map(), // declId -> hygienic な出力識別子
    derivedDeps: new Map(), // declId -> Set<declId>
    usedOutputNames: new Set(),

    markers: [], // { id, contentParts }
    markerDeps: new Map(), // markerId -> Set<declId>(直接依存、推移閉包を取る前)
    handlers: [], // { markerId, eventName, rendered, writeDeclIds }(signalToMarkers 確定後に updateNames へ変換)

    markerCounter: 0,
    instanceCounter: 0,
  };
}

export const declKey = (instanceId, start) => `${instanceId}:${start}`;

export function nextMarkerId(ctx) {
  return `m${ctx.markerCounter++}`;
}

export function nextInstanceId(ctx) {
  return ctx.instanceCounter++;
}

export function assignOutputName(ctx, naturalName, declId) {
  let candidate = naturalName;
  let n = 1;
  while (ctx.usedOutputNames.has(candidate)) candidate = `${naturalName}$${n++}`;
  ctx.usedOutputNames.add(candidate);
  ctx.declOutputName.set(declId, candidate);
  return candidate;
}
