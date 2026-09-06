// 最終 codegen:コンパイラが収集した結果(フラット化された宣言文、マーカー、
// signal->marker 依存グラフ)から、createComponent()でインスタンス専有stateと
// update_<name>()を作るESモジュールを組み立てる。mountComponent()/
// hydrateComponent()は毎回新しいインスタンスを生成する互換エントリポイント。
// ここは文字列組み立てのみ - AST もコンパイラ状態も触らない。
//
// ADR-0006: 宣言はプレーン変数として出力される(signal()/derived() ラッパー
// は出力に現れない)。derived は遅延評価ではなくなるため、それが依存する
// root signal の update_* 内で先に再計算してからマーカーを更新する。
//
// M5(ADR-0005): リスト/条件分岐は「そのユニット専用の factory 関数」を
// 生成する。テンプレートは <template>+cloneNode(true) でスタンプし
// (renderElement 側では初期 HTML に埋め込まない ― mount/hydrate 直後に
// 一度 update_<name>() を呼んで populate する)、item/branch 内のローカル
// marker は __markers__ に登録せず、factory のクロージャに閉じ込める。
//
// M5.5: ネストした構造ユニットは、同じ factory 生成規則を外側 factory の
// クロージャ内へ深さ制限なしで再帰適用する(<template> だけは静的なので
// module スコープで共有)。root依存は外側markerへ合流し、局所依存は所有者
// factoryのupdateへ直接接続する。
//
// ADR-0015: Listのkey照合・DOM順序は最小ランタイムへ委譲し、item factoryは
// binding IDごとの前回値を使って変化した実DOMだけを更新する。

import type {
  ActionMarker,
  AttrBinding,
  DeclId,
  LocalDecl,
  MarkerId,
  TextMarker,
} from './compiler/state.ts'
import { attrBindingKind, innerTemplateSource } from './template.ts'

// M2/ADR-0020: compiler.ts が writeDeclIds をマーカーを持つroot signalへ
// 解決し、通常は updateNames、共有markerがあるときは updateBatchNameへ
// 変換した後の、codegen向けハンドラ表現。
export interface HandlerOutput {
  markerId: MarkerId
  eventName: string
  rendered: string
  /** authored handlerがasync関数またはasync arrowか。 */
  async: boolean
  /** renderedに本体・入れ子関数の更新文を含めているか。 */
  updatesInRendered: boolean
  updateNames: string[]
  /** 複数 root が同じ marker を共有するときだけ使う同期 batch 名。 */
  updateBatchName: string | null
  /** batch の本体で collection.update() の直接通知を遅延するか。 */
  updateBatchNeedsCollection: boolean
  /** ADR-0009: 第1仮引数(イベントオブジェクト)の authored 名。なければ null。 */
  param: string | null
  /** 同じ構造単位または祖先の局所signalへ書き込む場合に呼ぶ更新の
   * 字句スコープ位置。0はこのbody、1以降は祖先bodyを示す。 */
  localUpdateLevels: number[]
}

// M5: StructuralUnitBody(state.ts)のハンドラを HandlerDecl から
// HandlerOutput へ変換したもの。それ以外のフィールドは同じ形。
// M5.5: ネストした構造ユニットも localMarkers に含まれる。
export interface StructuralUnitBodyOutput {
  template: string
  localMarkers: (TextMarker | ListMarkerOutput | ConditionalMarkerOutput)[]
  localHandlers: HandlerOutput[]
  /** このfactory instanceが所有するaction。 */
  localActions: ActionOutput[]
  /** このfactory instanceが所有するonMount callback。 */
  localMounts: MountOutput[]
  /** このfactory instanceが所有するeffect callback。 */
  localEffects: LocalEffectOutput[]
  /** ADR-0012: このユニット専有の動的属性バインディング。 */
  localAttrBindings: AttrBinding[]
  /** same-file-component-composition: このユニット直下のローカルsignal宣言。 */
  localDecls: LocalDecl[]
  /** ルートsignal/derivedを読むため、親unitから更新を受ける依存。 */
  rootDeps: Set<DeclId>
}

export interface ListMarkerOutput {
  id: MarkerId
  kind: 'list'
  itemParam: string
  arrayRendered: string
  keyRendered: string
  collectionDeclId: DeclId | null
  collectionOutputName: string | null
  body: StructuralUnitBodyOutput
}

export interface ConditionalBranchOutput {
  body: StructuralUnitBodyOutput | null
}

export interface ConditionalMarkerOutput {
  id: MarkerId
  kind: 'conditional'
  condRendered: string
  isLogical: boolean
  branches: ConditionalBranchOutput[]
}

export type MarkerOutput = TextMarker | ListMarkerOutput | ConditionalMarkerOutput | ActionMarker

export interface UpdateBatchOutput {
  /** 生成コード内だけで使う batch 関数名。公開 instance API には出さない。 */
  name: string
  /** この batch に含める root signal の declId。 */
  signalIds: DeclId[]
  /** root signal の marker 集合の和集合(重複は除去済み)。 */
  markerIds: MarkerId[]
  /** collection.update() の直接通知をbatch末尾まで遅延する必要があるか。 */
  containsCollection: boolean
}

// ADR-0011: signalToMarkers/ctx.markerDeps 確定後に compiler.ts が組み立てる
// action1個ぶんの最終テキスト。bodyRendered/resultRendered は既に個別 update
// または同期 batch 呼び出し込み(design D4-1/D5) -- codegen はこれを文字列として
// 組み立てるだけで、ctx や AST には一切触れない。
export interface ActionOutput {
  markerId: MarkerId
  elParam: string | null
  bodyRendered: string
  /** 返り値(function または { update?, destroy? })。無ければ null。 */
  resultRendered: string | null
}

// ルートcomponentのonMount callback。callback本体はmount直後、cleanupは
// unmount時に実行する。cleanupへ更新呼び出しは挿入しない。
export interface MountOutput {
  bodyRendered: string
  cleanupRendered: string | null
}

// 構造unit内effectは依存を外側markerへ合流した後、factory自身のupdateへ
// 接続する。signal idはcompiler側の依存解決専用なので出力には保持しない。
export interface LocalEffectOutput {
  bodyRendered: string
  cleanupRendered: string | null
  /** root/derived依存がこのfactory更新を起動する出力名。 */
  signalNames: string[]
}

// ルートcomponentのeffect callback。signalIdsはcallback本体のreadをroot
// signalへ展開した依存で、専用update_*()の末尾からrunnerを呼ぶ。
export interface EffectOutput {
  bodyRendered: string
  cleanupRendered: string | null
  signalIds: DeclId[]
}

export interface GenerateModuleInput {
  /** compileProject()でリンクされた通常の関数/const。runtimeへは出さず、module scopeへ一度だけ出す。 */
  supportStatements: string[]
  /** 外部moduleとViteの資源import。compilerのAST解析へ入れず、生成moduleの先頭へ残す。 */
  externalImports: string[]
  /** compileProjectの使用済みmodule共有signalをmodule scopeへ置く。 */
  sharedStatements: string[]
  /** compileProjectの使用済みmodule共有derivedをmodule scopeへ置く。 */
  sharedDerivedStatements: string[]
  sharedSignalNames: string[]
  /** 共有derivedはinstance専有の再計算代入を持たない。 */
  sharedDerivedIds: Set<DeclId>
  declStatements: string[]
  markers: MarkerOutput[]
  signalToMarkers: Map<DeclId, Set<MarkerId>>
  updateBatches: UpdateBatchOutput[]
  declOutputName: Map<DeclId, string>
  derivedDeps: Map<DeclId, Set<DeclId>>
  derivedRecompute: Map<DeclId, string>
  collectionKeyRendered: Map<DeclId, string>
  handlers: HandlerOutput[]
  actions: ActionOutput[]
  mounts: MountOutput[]
  effects: EffectOutput[]
  attrBindings: AttrBinding[] // ADR-0012: トップレベルの動的属性
  // cross-function-handler-writes: 追跡対象として呼ばれた動きゾーン関数を
  // authored 名のままモジュールスコープへ1回だけ emit する(design D4)。
  emittedFns: { name: string; params: string; body: string; async: boolean }[]
  initialHtml: string
}

// クローンしたテンプレート内から data-iris-id を持つ要素を探す。ルート
// 要素自身がマーカーの場合(item/branch の直接の子に marker が付く形)は
// querySelector が自分自身を対象にしないので、先に自分自身を確認する。
const FIND_HELPER = `function __find__(root, id) { return root.getAttribute("data-iris-id") === id ? root : root.querySelector(\`[data-iris-id="\${id}"]\`); }`

// Structural units are represented by comment pairs instead of wrapper
// elements. Emit this lookup only for modules that contain a structural unit;
// ordinary text/attribute output therefore has no generated range helper.
const FIND_RANGE_HELPER = `function __findRange__(root, id) { let start = null; let end = null; const startText = "irisout:start:" + id; const endText = "irisout:end:" + id; const visit = (node) => { for (let child = node.firstChild; child; child = child.nextSibling) { if (child.nodeType === 8) { if (child.data === startText) start = child; else if (child.data === endText) end = child; } visit(child); } }; visit(root); return start && end ? { start, end } : null; }`

// itemParam: このハンドラを含む factory の item 仮引数名(無ければ null)。
// same-file-component-composition: ローカルsignal書き込み後に呼ぶ
// `update()`は itemParam != null の factory では item 引数を要求する
// (`function update(__next__) { <itemParam> = __next__; ... }`) ―
// 引数無しで呼ぶと item が undefined で上書きされる(design.md D5)。
function renderHandlerCall(
  h: HandlerOutput,
  itemParam: string | null,
  prelude = '',
  localUpdateExprs: (string | null)[] = [],
): string {
  const updateCalls = h.updateBatchName
    ? `${h.updateBatchName}();`
    : h.updateNames.map((name) => `update_${name}();`).join(' ')
  const localUpdateCalls = [
    ...new Set(
      h.localUpdateLevels
        .map((level) => localUpdateExprs[level])
        .filter((expr): expr is string => expr != null),
    ),
  ]
    .map((expr) => `${expr};`)
    .join(' ')
  const replaceLocalUpdates = (source: string): string =>
    source.replace(/__LOCAL_(SELF_UPDATE|ANCESTOR_(\d+))__\(\);?/g, (_match, kind, levelText) => {
      const level = kind === 'SELF_UPDATE' ? 0 : Number(levelText)
      const updateExpr = localUpdateExprs[level]
      if (!updateExpr) {
        throw new Error(
          `codegen: missing local update expression for handler ${h.markerId} at level ${level}`,
        )
      }
      return `${updateExpr};`
    })
  const body = `${prelude}${replaceLocalUpdates(h.rendered)}`
  const scopedBody =
    !h.updatesInRendered && h.updateBatchNeedsCollection
      ? `__update_batch_depth__++; try { ${body} } finally { __update_batch_depth__--; }`
      : body
  const tail = h.updatesInRendered
    ? ''
    : `${updateCalls}${localUpdateCalls ? ` ${localUpdateCalls}` : ''}`
  // ADR-0009 D4: 第1引数があるハンドラのみ authored 名を束縛する。
  const params = h.param ? `${h.param}, ...__args` : '...__args'
  return `${h.async ? 'async ' : ''}(${params}) => { ${scopedBody}${h.updatesInRendered ? '' : ';'}${tail ? ` ${tail}` : ''} }`
}

// ADR-0012 決定2: 動的属性1個ぶんの設定文。boolProp/prop はプロパティ代入、
// それ以外は setAttribute(update_* と factory の両方で使う)。
function renderAttrSet(elExpr: string, b: AttrBinding): string {
  return attrBindingKind(b.name) === 'attr'
    ? `${elExpr}.setAttribute(${JSON.stringify(b.name)}, ${b.rendered});`
    : `${elExpr}.${b.name} = ${b.rendered};`
}

// M5.5: ボディ内のテキストマーカー / ネストした構造ユニットマーカーの選別。
const bodyTexts = (body: StructuralUnitBodyOutput): TextMarker[] =>
  body.localMarkers.filter((m): m is TextMarker => m.kind === 'text')
const bodyUnits = (
  body: StructuralUnitBodyOutput,
): (ListMarkerOutput | ConditionalMarkerOutput)[] =>
  body.localMarkers.filter(
    (m): m is ListMarkerOutput | ConditionalMarkerOutput => m.kind !== 'text',
  )

function bodyHasList(body: StructuralUnitBodyOutput): boolean {
  return bodyUnits(body).some((unit) => {
    if (unit.kind === 'list') return true
    return unit.branches.some((branch) => branch.body != null && bodyHasList(branch.body))
  })
}

function bodyHasLifecycle(body: StructuralUnitBodyOutput): boolean {
  return (
    body.localActions.length > 0 ||
    body.localMounts.length > 0 ||
    body.localEffects.length > 0 ||
    bodyUnits(body).some((unit) => {
      if (unit.kind === 'list') return bodyHasLifecycle(unit.body)
      return unit.branches.some((branch) => branch.body != null && bodyHasLifecycle(branch.body))
    })
  )
}

function bodyHasResultActions(body: StructuralUnitBodyOutput): boolean {
  return (
    body.localActions.some((action) => action.resultRendered != null) ||
    bodyUnits(body).some((unit) => {
      if (unit.kind === 'list') return bodyHasResultActions(unit.body)
      return unit.branches.some(
        (branch) => branch.body != null && bodyHasResultActions(branch.body),
      )
    })
  )
}

function bodyHasLifecycleList(body: StructuralUnitBodyOutput): boolean {
  return bodyUnits(body).some((unit) => {
    if (unit.kind === 'list') return bodyHasLifecycle(unit.body)
    return unit.branches.some((branch) => branch.body != null && bodyHasLifecycleList(branch.body))
  })
}

function markerHasLifecycle(marker: ListMarkerOutput | ConditionalMarkerOutput): boolean {
  return marker.kind === 'list'
    ? bodyHasLifecycle(marker.body)
    : marker.branches.some((branch) => branch.body != null && bodyHasLifecycle(branch.body))
}

function bodyHasEffects(body: StructuralUnitBodyOutput): boolean {
  return (
    body.localEffects.length > 0 ||
    bodyUnits(body).some((unit) => {
      if (unit.kind === 'list') return bodyHasEffects(unit.body)
      return unit.branches.some((branch) => branch.body != null && bodyHasEffects(branch.body))
    })
  )
}

function markerHasEffects(marker: ListMarkerOutput | ConditionalMarkerOutput): boolean {
  return marker.kind === 'list'
    ? bodyHasEffects(marker.body)
    : marker.branches.some((branch) => branch.body != null && bodyHasEffects(branch.body))
}

function markersHaveStructuralEffects(markers: MarkerOutput[]): boolean {
  return markers.some((marker) => {
    if (marker.kind === 'list' || marker.kind === 'conditional') return markerHasEffects(marker)
    return false
  })
}

function markersHaveResultActions(markers: MarkerOutput[]): boolean {
  return markers.some((marker) => {
    if (marker.kind === 'action') return false
    if (marker.kind === 'list') return bodyHasResultActions(marker.body)
    if (marker.kind === 'conditional') {
      return marker.branches.some(
        (branch) => branch.body != null && bodyHasResultActions(branch.body),
      )
    }
    return false
  })
}

function markersHaveStructuralActions(markers: MarkerOutput[]): boolean {
  return markers.some((marker) => {
    if (marker.kind === 'list') return bodyHasLifecycle(marker.body)
    if (marker.kind === 'conditional') {
      return marker.branches.some((branch) => branch.body != null && bodyHasLifecycle(branch.body))
    }
    return false
  })
}

function markersHaveLifecycleList(markers: MarkerOutput[]): boolean {
  return markers.some((marker) => {
    if (marker.kind === 'list') return bodyHasLifecycle(marker.body)
    if (marker.kind === 'conditional') {
      return marker.branches.some(
        (branch) => branch.body != null && bodyHasLifecycleList(branch.body),
      )
    }
    return false
  })
}

function markersHaveList(markers: MarkerOutput[]): boolean {
  return markers.some((marker) => {
    if (marker.kind === 'list') return true
    if (marker.kind !== 'conditional') return false
    return marker.branches.some((branch) => branch.body != null && bodyHasList(branch.body))
  })
}

function bodyHasReactiveBindings(body: StructuralUnitBodyOutput): boolean {
  const hasLocalRefreshSource = body.localDecls.length > 0 || body.rootDeps.size > 0
  return (
    (hasLocalRefreshSource && (bodyTexts(body).length > 0 || body.localAttrBindings.length > 0)) ||
    bodyUnits(body).some((unit) => {
      if (unit.kind === 'list') return bodyHasReactiveBindings(unit.body)
      return unit.branches.some(
        (branch) => branch.body != null && bodyHasReactiveBindings(branch.body),
      )
    })
  )
}

function markersHaveReactiveBindings(markers: MarkerOutput[]): boolean {
  return markers.some((marker) => {
    if (marker.kind === 'list') return bodyHasReactiveBindings(marker.body)
    if (marker.kind === 'conditional') {
      return marker.branches.some(
        (branch) => branch.body != null && bodyHasReactiveBindings(branch.body),
      )
    }
    return false
  })
}

// ブランチ factory が update() を返すか。ネストしたユニットを含む場合と、
// 外側に item 仮引数があってテキストの再描画が要る場合のみ true ―
// それ以外のブランチは M5 と同じ set-once + { el } のまま(ADR-0004:
// 出力が膨らむ方向の変換は避ける)。
function branchHasUpdate(body: StructuralUnitBodyOutput, inItemScope: boolean): boolean {
  return (
    bodyUnits(body).length > 0 ||
    body.localActions.length > 0 ||
    body.localEffects.length > 0 ||
    body.rootDeps.size > 0 ||
    body.localDecls.length > 0 ||
    (inItemScope && (bodyTexts(body).length > 0 || body.localAttrBindings.length > 0))
  )
}

function condDispatchesUpdate(marker: ConditionalMarkerOutput, inItemScope: boolean): boolean {
  return marker.branches.some((b) => b.body != null && branchHasUpdate(b.body, inItemScope))
}

// factory 関数本体:テンプレートのクローン取得・ローカル marker の解決・
// ハンドラ登録・必要なupdate() クロージャをまとめて1関数にする(ADR-0005
// 決定2)。itemがない条件分岐branchでも、祖先itemのitem値に依存するmarkerは
// instance専有binding cacheを使って再計算する。
//
// M5.5: ネストした構造ユニットがある場合、その keyed Map・状態変数・factory
// 関数をこの factory のクロージャ内に入れ子で生成する(specs「ネストした
// 構造ユニットのfactory生成」)。update() はネストしたユニットの keyed diff /
// 条件分岐 update も再実行する。inItemScope は「外側のどこかに item 仮引数が
// あるか」― その場合のみブランチのテキストも update() で再描画する
// (外側 item の値差し替えを閉包経由で反映するため)。
function generateFactoryLegacy(
  factoryName: string,
  templateVar: string,
  itemParam: string | null,
  body: StructuralUnitBodyOutput,
  inItemScope: boolean,
  ancestorUpdateExprs: (string | null)[] = [],
): string[] {
  const texts = bodyTexts(body)
  const units = bodyUnits(body)
  const childScope = inItemScope || itemParam != null
  const refreshTexts =
    (itemParam != null || inItemScope || body.rootDeps.size > 0 || body.localDecls.length > 0) &&
    texts.length > 0
  const refreshAttrs =
    (itemParam != null || inItemScope || body.rootDeps.size > 0 || body.localDecls.length > 0) &&
    body.localAttrBindings.length > 0
  const hasLocalSelfUpdate = body.localHandlers.some((h) => h.localUpdateLevels.includes(0))
  const needsUpdate =
    itemParam != null || refreshTexts || refreshAttrs || units.length > 0 || hasLocalSelfUpdate
  const updateName = `${factoryName}update__`
  const bindingStateExpr = itemParam != null ? '__item__' : '__unit_state__'
  const selfUpdateExpr = needsUpdate
    ? itemParam
      ? `${updateName}(${itemParam})`
      : `${updateName}()`
    : null
  const localUpdateExprs = [selfUpdateExpr, ...ancestorUpdateExprs]

  // 通常のList itemは、行ごとのupdateクロージャではなくデータhandleを返す。
  // update関数はfactoryと同じスコープに1個だけ生成し、runtimeが
  // update(handle, next)として呼ぶ。ネスト構造またはローカルsignalを持つitemは
  // まだ外側のlexical scopeを必要とするため、下の汎用factory経路を使う。
  if (itemParam != null && units.length === 0 && body.localDecls.length === 0) {
    const lines: string[] = []
    const attrs = body.localAttrBindings
    const refIds = new Set<string>([
      ...body.localMarkers.map((m) => m.id),
      ...attrs.map((b) => b.markerId),
      ...body.localHandlers.map((h) => h.markerId),
    ])

    lines.push(`function ${updateName}(__handle__, __next__) {`)
    lines.push(`  const ${itemParam} = __handle__.value = __next__;`)
    lines.push('  const __item__ = __handle__.item;')
    for (const id of refIds) lines.push(`  const __${id}__ = __handle__.refs.${id};`)
    for (const m of texts) {
      const valueVar = `__value_${m.id}__`
      lines.push(
        `  const ${valueVar} = \`${innerTemplateSource(m.contentParts)}\`;`,
        `  if (__updateListBinding__(__item__, ${JSON.stringify(m.id)}, ${valueVar})) __${m.id}__.textContent = ${valueVar};`,
      )
    }
    attrs.forEach((b, i) => {
      const valueVar = `__attr_${i}__`
      const bindingId = `${b.markerId}:${b.name}`
      lines.push(
        `  const ${valueVar} = ${b.rendered};`,
        `  if (__updateListBinding__(__item__, ${JSON.stringify(bindingId)}, ${valueVar})) ${renderAttrSet(`__${b.markerId}__`, { ...b, rendered: valueVar })}`,
      )
    })
    lines.push('}')
    lines.push(`function ${factoryName}(${itemParam}, __item__) {`)
    lines.push(`  const __node__ = ${templateVar}.content.cloneNode(true);`)
    lines.push('  const __el__ = __node__.firstElementChild;')
    for (const id of refIds) {
      lines.push(`  const __${id}__ = __find__(__el__, ${JSON.stringify(id)});`)
    }
    const refs = [...refIds].map((id) => `${id}: __${id}__`).join(', ')
    lines.push(
      `  const __handle__ = { el: __el__, item: __item__, value: ${itemParam}, refs: { ${refs} } };`,
    )
    for (const h of body.localHandlers) {
      lines.push(
        `  __${h.markerId}__.addEventListener(${JSON.stringify(h.eventName)}, ${renderHandlerCall(h, itemParam, `${itemParam} = __handle__.value; `, [null, ...ancestorUpdateExprs])});`,
      )
    }
    lines.push(`  ${updateName}(__handle__, ${itemParam});`)
    lines.push('  return __handle__;')
    lines.push('}')
    return lines
  }

  const lines: string[] = []
  const params = itemParam ? `${itemParam}, __item__` : ''
  lines.push(`function ${factoryName}(${params}) {`)
  lines.push(`  const __node__ = ${templateVar}.content.cloneNode(true);`)
  lines.push('  const __el__ = __node__.firstElementChild;')
  if (itemParam == null && (refreshTexts || refreshAttrs)) {
    // 構造単位のfactory instanceごとにbinding cacheを持つ。分岐を再生成した
    // とき、祖先Listのcacheを共有すると同じ値を再設定せずtemplateの初期文字列
    // が残るため、DOM instanceの寿命とcacheの寿命を一致させる。
    lines.push('  const __unit_state__ = { bindings: new Map() };')
  }
  // same-file-component-composition: このユニットへインライン化された
  // コンポーネントのローカルsignal(CONTEXT.md)。module scopeへは出さず、
  // このfactoryインスタンス専有のクロージャ変数として宣言する(design D5)。
  for (const d of body.localDecls) {
    lines.push(`  let ${d.outputName} = ${d.rendered};`)
  }
  for (const m of body.localMarkers) {
    if (m.kind === 'text') {
      lines.push(`  const __${m.id}__ = __find__(__el__, ${JSON.stringify(m.id)});`)
    } else {
      lines.push(`  const __range_${m.id}__ = __findRange__(__el__, ${JSON.stringify(m.id)});`)
    }
  }
  // ADR-0012: 属性のみの要素のマーカーは localMarkers に居ないので、find 定数を
  // 別途確保する(text マーカーと同居する場合は重複させない)。
  const attrs = body.localAttrBindings
  const foundIds = new Set(body.localMarkers.map((m) => m.id))
  const elementRefIds = new Set([
    ...attrs.map((b) => b.markerId),
    ...body.localHandlers.map((h) => h.markerId),
  ])
  for (const id of elementRefIds) {
    if (!foundIds.has(id)) {
      lines.push(`  const __${id}__ = __find__(__el__, ${JSON.stringify(id)});`)
    }
  }
  // ネストしたユニットの状態・factory はこのクロージャ専有(specs
  // 「ネストした構造ユニットのライフサイクル」: 外側の DOM remove() とともに
  // 参照ごと失われる。明示的な teardown は生成しない ― ADR-0005 決定4)。
  for (const u of units) {
    if (u.kind === 'list') {
      lines.push(`  const __list_${u.id}__ = __createListRuntime__(${JSON.stringify(u.id)});`)
      lines.push(
        ...generateFactoryLegacy(
          `__create_${u.id}__`,
          `__tpl_${u.id}__`,
          u.itemParam,
          u.body,
          childScope,
          localUpdateExprs,
        ).map((l) => `  ${l}`),
      )
    } else {
      lines.push(`  let __cond_${u.id}__ = -1;`, `  let __cond_${u.id}_handle__ = null;`)
      u.branches.forEach((branch, i) => {
        if (!branch.body) return
        lines.push(
          ...generateFactoryLegacy(
            `__create_${u.id}_b${i}__`,
            `__tpl_${u.id}_b${i}__`,
            null,
            branch.body,
            childScope,
            localUpdateExprs,
          ).map((l) => `  ${l}`),
        )
      })
    }
  }
  for (const h of body.localHandlers) {
    lines.push(
      `  __${h.markerId}__.addEventListener(${JSON.stringify(h.eventName)}, ${renderHandlerCall(h, itemParam, '', localUpdateExprs)});`,
    )
  }
  // テキスト/属性の再設定が要るのは item 仮引数(自身または外側)を参照
  // しうる場合のみ。それ以外は静的なので一度だけ設定する(属性の初期値は
  // テンプレートに焼き込まれないため、この設定行が初期値を兼ねる —
  // ADR-0012 決定3)。
  if (!refreshTexts) {
    for (const m of texts) {
      lines.push(`  __${m.id}__.textContent = \`${innerTemplateSource(m.contentParts)}\`;`)
    }
  }
  if (!refreshAttrs) {
    for (const b of attrs) {
      lines.push(`  ${renderAttrSet(`__${b.markerId}__`, b)}`)
    }
  }
  if (needsUpdate) {
    lines.push(`  function ${updateName}(${itemParam ? '__next__' : ''}) {`)
    if (itemParam) lines.push(`    ${itemParam} = __next__;`)
    if (refreshTexts) {
      for (const m of texts) {
        const valueVar = `__value_${m.id}__`
        lines.push(
          `    const ${valueVar} = \`${innerTemplateSource(m.contentParts)}\`;`,
          `    if (__updateListBinding__(${bindingStateExpr}, ${JSON.stringify(m.id)}, ${valueVar})) __${m.id}__.textContent = ${valueVar};`,
        )
      }
    }
    if (refreshAttrs) {
      attrs.forEach((b, i) => {
        const valueVar = `__attr_${i}__`
        const bindingId = `${b.markerId}:${b.name}`
        lines.push(
          `    const ${valueVar} = ${b.rendered};`,
          `    if (__updateListBinding__(${bindingStateExpr}, ${JSON.stringify(bindingId)}, ${valueVar})) ${renderAttrSet(`__${b.markerId}__`, { ...b, rendered: valueVar })}`,
        )
      })
    }
    for (const u of units) {
      if (u.kind === 'list') {
        lines.push(...generateListUpdate(u, `__range_${u.id}__`).map((l) => `  ${l}`))
      } else {
        lines.push(
          ...generateConditionalUpdate(
            u,
            `__range_${u.id}__`,
            condDispatchesUpdate(u, childScope),
          ).map((l) => `  ${l}`),
        )
      }
    }
    lines.push('  }')
    lines.push(`  ${updateName}(${itemParam ?? ''});`)
    lines.push(`  return { el: __el__, update: ${updateName} };`)
  } else {
    lines.push('  return { el: __el__ };')
  }
  lines.push('}')
  return lines
}

// actionを含むunitは、DOM接続後のmountと、所有資源を逆順に解放する
// destroyを明示的に持つ。actionを含まないunitは上の既存経路を使い、生成
// コードと通常runtimeの経路を増やさない。
function generateLifecycleFactory(
  factoryName: string,
  templateVar: string,
  itemParam: string | null,
  body: StructuralUnitBodyOutput,
  inItemScope: boolean,
  ancestorUpdateExprs: (string | null)[] = [],
): string[] {
  const texts = bodyTexts(body)
  const units = bodyUnits(body)
  const ownActions = body.localActions
  const ownMounts = body.localMounts
  const ownEffects = body.localEffects
  const childScope = inItemScope || itemParam != null
  const refreshTexts =
    (itemParam != null || inItemScope || body.rootDeps.size > 0 || body.localDecls.length > 0) &&
    texts.length > 0
  const refreshAttrs =
    (itemParam != null || inItemScope || body.rootDeps.size > 0 || body.localDecls.length > 0) &&
    body.localAttrBindings.length > 0
  const hasLocalSelfUpdate = body.localHandlers.some((h) => h.localUpdateLevels.includes(0))
  const needsUpdate =
    itemParam != null ||
    refreshTexts ||
    refreshAttrs ||
    units.length > 0 ||
    hasLocalSelfUpdate ||
    ownActions.length > 0 ||
    ownEffects.length > 0
  const updateName = `${factoryName}update__`
  const bindingStateExpr = itemParam != null ? '__item__' : '__unit_state__'
  const selfUpdateExpr = itemParam
    ? `${updateName}(${itemParam}, null, true)`
    : `${updateName}(null, true)`
  const localUpdateExprs = [selfUpdateExpr, ...ancestorUpdateExprs]
  const lines: string[] = []
  const params = itemParam ? `${itemParam}, __item__` : ''

  lines.push(`function ${factoryName}(${params}) {`)
  lines.push(`  const __node__ = ${templateVar}.content.cloneNode(true);`)
  lines.push('  const __el__ = __node__.firstElementChild;')
  if (itemParam) lines.push(`  let __current_item__ = ${itemParam};`)
  if (itemParam == null && (refreshTexts || refreshAttrs)) {
    lines.push('  const __unit_state__ = { bindings: new Map() };')
  }
  for (const d of body.localDecls) lines.push(`  let ${d.outputName} = ${d.rendered};`)
  for (const action of ownActions) {
    if (action.resultRendered) {
      lines.push(
        `  let __use_update_${action.markerId}__;`,
        `  let __use_destroy_${action.markerId}__;`,
      )
    }
  }
  for (const [index, mount] of ownMounts.entries()) {
    if (mount.cleanupRendered) lines.push(`  let __unit_mount_cleanup_${index}__;`)
  }
  for (const [index, effect] of ownEffects.entries()) {
    if (effect.cleanupRendered) lines.push(`  let __unit_effect_cleanup_${index}__;`)
  }
  lines.push('  let __unit_mounted__ = false;', '  let __unit_destroyed__ = false;')

  for (const [index, effect] of ownEffects.entries()) {
    lines.push(...renderLocalEffectRunner(effect, index).map((line) => `  ${line}`))
  }

  for (const m of body.localMarkers) {
    if (m.kind === 'text') {
      lines.push(`  const __${m.id}__ = __find__(__el__, ${JSON.stringify(m.id)});`)
    } else {
      lines.push(`  const __range_${m.id}__ = __findRange__(__el__, ${JSON.stringify(m.id)});`)
    }
  }
  const attrs = body.localAttrBindings
  const foundIds = new Set(body.localMarkers.map((m) => m.id))
  const elementRefIds = new Set([
    ...attrs.map((b) => b.markerId),
    ...body.localHandlers.map((h) => h.markerId),
    ...ownActions.map((a) => a.markerId),
  ])
  for (const id of elementRefIds) {
    if (!foundIds.has(id)) {
      lines.push(`  const __${id}__ = __find__(__el__, ${JSON.stringify(id)});`)
    }
  }

  for (const u of units) {
    if (u.kind === 'list') {
      lines.push(`  const __list_${u.id}__ = __createListRuntime__(${JSON.stringify(u.id)});`)
      lines.push(
        ...generateFactory(
          `__create_${u.id}__`,
          `__tpl_${u.id}__`,
          u.itemParam,
          u.body,
          childScope,
          localUpdateExprs,
        ).map((l) => `  ${l}`),
      )
    } else {
      lines.push(`  let __cond_${u.id}__ = -1;`, `  let __cond_${u.id}_handle__ = null;`)
      u.branches.forEach((branch, i) => {
        if (!branch.body) return
        lines.push(
          ...generateFactory(
            `__create_${u.id}_b${i}__`,
            `__tpl_${u.id}_b${i}__`,
            null,
            branch.body,
            childScope,
            localUpdateExprs,
          ).map((l) => `  ${l}`),
        )
      })
    }
  }

  body.localHandlers.forEach((h, index) => {
    const handlerVar = `__unit_handler_${h.markerId}_${index}__`
    lines.push(
      `  const ${handlerVar} = ${renderHandlerCall(h, itemParam, '', localUpdateExprs)};`,
      `  __${h.markerId}__.addEventListener(${JSON.stringify(h.eventName)}, ${handlerVar});`,
    )
  })
  if (!refreshTexts) {
    for (const m of texts) {
      lines.push(`  __${m.id}__.textContent = \`${innerTemplateSource(m.contentParts)}\`;`)
    }
  }
  if (!refreshAttrs) {
    for (const b of attrs) lines.push(`  ${renderAttrSet(`__${b.markerId}__`, b)}`)
  }

  lines.push(
    `  function ${updateName}(${itemParam ? '__next__, ' : ''}__effect_trigger__ = null, __force_effects__ = false) {`,
  )
  lines.push('    if (__unit_destroyed__) return;')
  if (itemParam) {
    lines.push('    const __item_changed__ = !Object.is(__current_item__, __next__);')
    lines.push('    __current_item__ = __next__;')
    lines.push(`    ${itemParam} = __next__;`)
  } else {
    lines.push('    const __item_changed__ = false;')
  }
  if (refreshTexts) {
    for (const m of texts) {
      const valueVar = `__value_${m.id}__`
      lines.push(
        `    const ${valueVar} = \`${innerTemplateSource(m.contentParts)}\`;`,
        `    if (__updateListBinding__(${bindingStateExpr}, ${JSON.stringify(m.id)}, ${valueVar})) __${m.id}__.textContent = ${valueVar};`,
      )
    }
  }
  if (refreshAttrs) {
    attrs.forEach((b, i) => {
      const valueVar = `__attr_${i}__`
      const bindingId = `${b.markerId}:${b.name}`
      lines.push(
        `    const ${valueVar} = ${b.rendered};`,
        `    if (__updateListBinding__(${bindingStateExpr}, ${JSON.stringify(bindingId)}, ${valueVar})) ${renderAttrSet(`__${b.markerId}__`, { ...b, rendered: valueVar })}`,
      )
    })
  }
  for (const u of units) {
    if (u.kind === 'list') {
      lines.push(
        ...generateListUpdate(
          u,
          `__range_${u.id}__`,
          '__unit_mounted__',
          '__effect_trigger__',
          '__force_effects__',
        ).map((l) => `  ${l}`),
      )
    } else {
      lines.push(
        ...generateConditionalUpdate(
          u,
          `__range_${u.id}__`,
          condDispatchesUpdate(u, childScope),
          '__unit_mounted__',
          '__effect_trigger__',
          '__force_effects__',
        ).map((l) => `  ${l}`),
      )
    }
  }
  for (const action of ownActions) {
    if (action.resultRendered) {
      lines.push(`    if (__use_update_${action.markerId}__) __use_update_${action.markerId}__();`)
    }
  }
  for (const [index, effect] of ownEffects.entries()) {
    const triggerNames = effect.signalNames.map((name) => JSON.stringify(name)).join(', ')
    const triggerCheck = effect.signalNames.length
      ? `(__effect_trigger__ && [${triggerNames}].some((__name__) => __effect_trigger__.has(__name__)))`
      : 'false'
    lines.push(
      `    if (__force_effects__ || __item_changed__ || ${triggerCheck}) __run_unit_effect_${index}__();`,
    )
  }
  lines.push('  }')
  if (needsUpdate) lines.push(`  ${updateName}(${itemParam ?? ''});`)

  lines.push('  function __mount_unit__() {')
  lines.push('    if (__unit_destroyed__ || __unit_mounted__) return;')
  lines.push('    try {')
  for (const u of units) {
    if (u.kind === 'list') {
      if (bodyHasLifecycle(u.body)) {
        lines.push(`      __mountListRuntime__(__list_${u.id}__);`)
      }
    } else if (markerHasLifecycle(u)) {
      lines.push(`      if (__cond_${u.id}_handle__?.mount) __cond_${u.id}_handle__.mount();`)
    }
  }
  for (const action of ownActions) {
    lines.push(`      ${renderActionCall(action, `__${action.markerId}__`, localUpdateExprs)}`)
  }
  for (const [index, mount] of ownMounts.entries()) {
    lines.push(`      ${renderMountCall(mount, index, localUpdateExprs, '__unit_mount_cleanup_')}`)
  }
  lines.push(
    '      __unit_mounted__ = true;',
    ...ownEffects.map((_effect, index) => `      __run_unit_effect_${index}__();`),
    '    } catch (__error__) {',
    '      try { __destroy_unit__(); } catch (__cleanup_error__) {}',
    '      throw __error__;',
    '    }',
    '  }',
  )

  lines.push('  function __destroy_unit__() {')
  lines.push('    if (__unit_destroyed__) return;')
  lines.push('    __unit_destroyed__ = true;')
  lines.push('    __unit_mounted__ = false;')
  lines.push('    let __destroy_error__;')
  body.localHandlers.forEach((h, index) => {
    const handlerVar = `__unit_handler_${h.markerId}_${index}__`
    lines.push(
      `    __${h.markerId}__.removeEventListener(${JSON.stringify(h.eventName)}, ${handlerVar});`,
    )
  })
  for (const u of units) {
    if (u.kind === 'list') {
      if (bodyHasLifecycle(u.body)) {
        lines.push(
          `    try { __destroyListRuntime__(__list_${u.id}__); } catch (__error__) { __destroy_error__ ??= __error__; }`,
        )
      }
    } else if (markerHasLifecycle(u)) {
      lines.push(
        `    try { if (__cond_${u.id}_handle__) { const __handle__ = __cond_${u.id}_handle__; try { __handle__.destroy?.(); } catch (__unit_destroy_error__) { __destroy_error__ ??= __unit_destroy_error__; } try { __handle__.el.remove(); } catch (__unit_remove_error__) { __destroy_error__ ??= __unit_remove_error__; } } } catch (__error__) { __destroy_error__ ??= __error__; }`,
        `    __cond_${u.id}_handle__ = null;`,
        `    __cond_${u.id}__ = -1;`,
      )
    }
  }
  for (const action of [...ownActions].reverse()) {
    if (action.resultRendered) {
      lines.push(
        `    try { if (__use_destroy_${action.markerId}__) { const __destroy__ = __use_destroy_${action.markerId}__; __use_destroy_${action.markerId}__ = null; __use_update_${action.markerId}__ = null; __destroy__(); } else { __use_update_${action.markerId}__ = null; } } catch (__error__) { __destroy_error__ ??= __error__; }`,
      )
    }
  }
  for (const [index, mount] of [...ownMounts].reverse().entries()) {
    const mountIndex = ownMounts.length - 1 - index
    if (mount.cleanupRendered) {
      lines.push(
        `    try { if (__unit_mount_cleanup_${mountIndex}__) { const __cleanup__ = __unit_mount_cleanup_${mountIndex}__; __unit_mount_cleanup_${mountIndex}__ = null; __cleanup__(); } } catch (__error__) { __destroy_error__ ??= __error__; }`,
      )
    }
  }
  for (const [index, effect] of [...ownEffects].reverse().entries()) {
    const effectIndex = ownEffects.length - 1 - index
    if (effect.cleanupRendered) {
      lines.push(
        `    try { if (__unit_effect_cleanup_${effectIndex}__) { const __cleanup__ = __unit_effect_cleanup_${effectIndex}__; __unit_effect_cleanup_${effectIndex}__ = null; __cleanup__(); } } catch (__error__) { __destroy_error__ ??= __error__; }`,
      )
    }
  }
  lines.push('    if (__destroy_error__) throw __destroy_error__;', '  }')
  lines.push(
    `  return { el: __el__, update: ${updateName}, mount: __mount_unit__, destroy: __destroy_unit__ };`,
    '}',
  )
  return lines
}

function generateFactory(
  factoryName: string,
  templateVar: string,
  itemParam: string | null,
  body: StructuralUnitBodyOutput,
  inItemScope: boolean,
  ancestorUpdateExprs: (string | null)[] = [],
): string[] {
  return bodyHasLifecycle(body)
    ? generateLifecycleFactory(
        factoryName,
        templateVar,
        itemParam,
        body,
        inItemScope,
        ancestorUpdateExprs,
      )
    : generateFactoryLegacy(
        factoryName,
        templateVar,
        itemParam,
        body,
        inItemScope,
        ancestorUpdateExprs,
      )
}

interface StructuralUnitsCode {
  declLines: string[]
  templateSetupLines: string[]
  signalsNeedingInitialCall: Set<DeclId>
}

// リスト/条件分岐マーカーぶんの <template> 変数・factory 関数・(リストのみ)
// keyed Map をcomponent instanceスコープに置き、テンプレートの実体生成
// (document依存)はmount/hydrate内で行う行を別に組み立てる。
function generateStructuralUnits(
  markers: MarkerOutput[],
  signalToMarkers: Map<DeclId, Set<MarkerId>>,
): StructuralUnitsCode {
  const structuralMarkerIds = new Set<MarkerId>()
  for (const m of markers) {
    if (m.kind === 'list' || m.kind === 'conditional') structuralMarkerIds.add(m.id)
  }

  const declLines: string[] = []
  const templateSetupLines: string[] = []

  if (structuralMarkerIds.size > 0) {
    declLines.push('let __doc__;', FIND_HELPER, FIND_RANGE_HELPER, '')
  }

  // M5.5: ネストしたユニットの <template> はcomponent instanceに1つ置いて
  // その中のfactory間で共有する(keyed Map・状態変数・factory関数は外側
  // factoryのクロージャ内 ― generateFactory参照)。
  const emitNestedUnitTemplates = (body: StructuralUnitBodyOutput): void => {
    for (const u of bodyUnits(body)) {
      if (u.kind === 'list') {
        declLines.push(`let __tpl_${u.id}__;`)
        templateSetupLines.push(
          `  __tpl_${u.id}__ = __doc__.createElement('template'); __tpl_${u.id}__.innerHTML = ${JSON.stringify(u.body.template)};`,
        )
        emitNestedUnitTemplates(u.body)
      } else {
        u.branches.forEach((branch, i) => {
          if (!branch.body) return
          declLines.push(`let __tpl_${u.id}_b${i}__;`)
          templateSetupLines.push(
            `  __tpl_${u.id}_b${i}__ = __doc__.createElement('template'); __tpl_${u.id}_b${i}__.innerHTML = ${JSON.stringify(branch.body.template)};`,
          )
          emitNestedUnitTemplates(branch.body)
        })
      }
    }
  }

  for (const marker of markers) {
    if (marker.kind === 'list') {
      const tplVar = `__tpl_${marker.id}__`
      const factoryName = `__create_${marker.id}__`
      declLines.push(
        `let ${tplVar};`,
        `let __list_${marker.id}__ = __createListRuntime__(${JSON.stringify(marker.id)});`,
      )
      declLines.push(
        ...generateFactory(factoryName, tplVar, marker.itemParam, marker.body, false),
        '',
      )
      templateSetupLines.push(
        `  ${tplVar} = __doc__.createElement('template'); ${tplVar}.innerHTML = ${JSON.stringify(marker.body.template)};`,
      )
      emitNestedUnitTemplates(marker.body)
    } else if (marker.kind === 'conditional') {
      declLines.push(`let __cond_${marker.id}__ = -1;`, `let __cond_${marker.id}_handle__ = null;`)
      marker.branches.forEach((branch, i) => {
        if (!branch.body) return
        const tplVar = `__tpl_${marker.id}_b${i}__`
        const factoryName = `__create_${marker.id}_b${i}__`
        declLines.push(`let ${tplVar};`)
        declLines.push(...generateFactory(factoryName, tplVar, null, branch.body, false), '')
        templateSetupLines.push(
          `  ${tplVar} = __doc__.createElement('template'); ${tplVar}.innerHTML = ${JSON.stringify(branch.body.template)};`,
        )
        emitNestedUnitTemplates(branch.body)
      })
    }
  }

  // リスト/条件分岐は初期 HTML に埋め込まれない(mount 時点で空)ので、
  // それらが依存する signal は mount/hydrate 直後に一度 update_<name>() を
  // 呼んで populate する必要がある。text マーカーのみの signal は初期 HTML
  // で既に値が焼き込まれているので対象外(既存スナップショットを変えない)。
  const signalsNeedingInitialCall = new Set<DeclId>()
  const populatedMarkers = new Set<MarkerId>()
  for (const [signalId, markerIds] of signalToMarkers) {
    for (const mId of markerIds) {
      if (structuralMarkerIds.has(mId) && !populatedMarkers.has(mId)) {
        populatedMarkers.add(mId)
        signalsNeedingInitialCall.add(signalId)
      }
    }
  }

  return { declLines, templateSetupLines, signalsNeedingInitialCall }
}

// CONCEPT.v3: List のkey照合・DOM順序調整は小さな共有ランタイムへ委譲する。
// item factory は listId / itemId を持つ状態を受け取り、item内の各bindingは
// updateListBinding()で値が変わった箇所だけ実DOMへ反映する。
// M5.5: elExpr はリストのマーカー要素の取得式 ― トップレベルは
// __markers__.get()、ネスト時は外側 factory クロージャの __<id>__ 変数。
function generateListUpdate(
  marker: ListMarkerOutput,
  elExpr: string,
  mountExpr = 'true',
  effectTriggerExpr = 'null',
  effectForceExpr = 'false',
): string[] {
  const hasLifecycle = bodyHasLifecycle(marker.body)
  const usesSharedUpdater =
    bodyUnits(marker.body).length === 0 &&
    marker.body.localDecls.length === 0 &&
    marker.body.localActions.length === 0 &&
    marker.body.localMounts.length === 0 &&
    marker.body.localEffects.length === 0
  const updaterArg = usesSharedUpdater
    ? `, __create_${marker.id}__update__`
    : hasLifecycle
      ? `, (__handle__, __next__) => __handle__.update?.(__next__, ${effectTriggerExpr}, ${effectForceExpr})`
      : ''
  const keyOf = marker.collectionOutputName
    ? `(${marker.itemParam}) => { const __key__ = ${marker.keyRendered}; if (!Object.is(__collection_${marker.collectionOutputName}__.keyOf(${marker.itemParam}), __key__)) throw new Error("collection List key does not match collection identity"); return __key__; }`
    : `(${marker.itemParam}) => ${marker.keyRendered}`
  return [
    hasLifecycle
      ? `  __reconcileListWithLifecycle__(__list_${marker.id}__, ${elExpr}, ${marker.arrayRendered}, ${keyOf}, __create_${marker.id}__${updaterArg}, ${mountExpr});`
      : `  __reconcileList__(__list_${marker.id}__, ${elExpr}, ${marker.arrayRendered}, ${keyOf}, __create_${marker.id}__${updaterArg});`,
  ]
}

// update_<conditional>() 本体:条件式を再評価し、選択ブランチが変わった
// ときだけ古い要素を remove() して新しい要素を factory から作る(選択が
// 変わらない限り DOM もローカル状態もそのまま維持する ― ADR-0005 決定4、
// teardown 不要)。
// M5.5: dispatchUpdate が true のとき(ブランチ factory が update() を返す
// 場合のみ)、選択が変わらない間の更新を handle.update() へ委譲する ―
// ブランチ内にネストしたユニットの再 diff・テキスト再描画はここから届く。
function generateConditionalUpdate(
  marker: ConditionalMarkerOutput,
  elExpr: string,
  dispatchUpdate: boolean,
  mountExpr = 'true',
  effectTriggerExpr = 'null',
  effectForceExpr = 'false',
): string[] {
  const hasLifecycle = markerHasLifecycle(marker)
  const hasConsequent = marker.branches[0]?.body != null
  const hasAlternate = !marker.isLogical && marker.branches[1]?.body != null
  const targetExpr = marker.isLogical
    ? `(${marker.condRendered}) ? 0 : -1`
    : hasConsequent && hasAlternate
      ? `(${marker.condRendered}) ? 0 : 1`
      : hasConsequent
        ? `(${marker.condRendered}) ? 0 : -1`
        : `(${marker.condRendered}) ? -1 : 1`
  const stateVar = `__cond_${marker.id}__`
  const handleVar = `__cond_${marker.id}_handle__`
  const branchCreateLines = marker.branches
    .map((branch, i) =>
      branch.body
        ? `        if (__target__ === ${i}) ${handleVar} = __create_${marker.id}_b${i}__();`
        : null,
    )
    .filter((l): l is string => l !== null)
  const lines = hasLifecycle
    ? [
        '  {',
        `    const __target__ = ${targetExpr};`,
        '    let __conditional_error__;',
        `    if (__target__ !== ${stateVar}) {`,
        `      if (${handleVar}) { const __old_handle__ = ${handleVar}; try { __old_handle__.destroy?.(); } catch (__error__) { __conditional_error__ ??= __error__; } try { __old_handle__.el.remove(); } catch (__error__) { __conditional_error__ ??= __error__; } ${handleVar} = null; }`,
        `      ${stateVar} = __target__;`,
        '      try {',
        ...branchCreateLines,
        `        if (${handleVar}) { const __range__ = ${elExpr}; const __parent__ = __range__?.end.parentNode; if (__parent__) { __parent__.insertBefore(${handleVar}.el, __range__.end); if (${mountExpr} && ${handleVar}.mount) ${handleVar}.mount(); } }`,
        '      } catch (__error__) {',
        '        __conditional_error__ ??= __error__;',
        `        if (${handleVar}) { const __failed_handle__ = ${handleVar}; try { __failed_handle__.destroy?.(); } catch (__cleanup_error__) { __conditional_error__ ??= __cleanup_error__; } try { __failed_handle__.el.remove(); } catch (__cleanup_error__) { __conditional_error__ ??= __cleanup_error__; } ${handleVar} = null; }`,
        `        ${stateVar} = -1;`,
        '      }',
      ]
    : [
        '  {',
        `    const __target__ = ${targetExpr};`,
        `    if (__target__ !== ${stateVar}) {`,
        `      if (${handleVar}) { ${handleVar}.el.remove(); ${handleVar} = null; }`,
        `      ${stateVar} = __target__;`,
        ...branchCreateLines,
        `      if (${handleVar}) { const __range__ = ${elExpr}; const __parent__ = __range__?.end.parentNode; if (__parent__) __parent__.insertBefore(${handleVar}.el, __range__.end); }`,
      ]
  if (dispatchUpdate) {
    lines.push(
      `    } else if (${handleVar} && ${handleVar}.update) {`,
      `      ${handleVar}.update(${effectTriggerExpr}, ${effectForceExpr});`,
      '    }',
    )
  } else {
    lines.push('    }')
  }
  if (hasLifecycle) lines.push('    if (__conditional_error__) throw __conditional_error__;')
  lines.push('  }')
  return lines
}

// ADR-0011: mount/hydrate 末尾でaction本体を実行し、返り値を runtime の
// 正規化境界へ渡す。関数形式は update、object 形式は update/destroy として
// 保持する。既存の関数返り値は初期1回+依存 signal 更新時に呼ぶ。
function renderActionCall(
  a: ActionOutput,
  elementExpr: string,
  localUpdateExprs: (string | null)[] = [],
): string {
  const replaceLocalUpdates = (source: string): string =>
    source.replace(/__LOCAL_(SELF_UPDATE|ANCESTOR_(\d+))__\(\);?/g, (_match, kind, levelText) => {
      const level = kind === 'SELF_UPDATE' ? 0 : Number(levelText)
      const updateExpr = localUpdateExprs[level]
      if (!updateExpr) {
        throw new Error(
          `codegen: missing local update expression for action ${a.markerId} at level ${level}`,
        )
      }
      return `${updateExpr};`
    })
  const bodyRendered = replaceLocalUpdates(a.bodyRendered)
  const resultRendered = a.resultRendered ? replaceLocalUpdates(a.resultRendered) : null
  const fn = `function(${a.elParam ?? ''}) {${bodyRendered}${resultRendered ? ` return ${resultRendered};` : ''}}`
  const call = `(${fn})(${elementExpr})`
  if (!a.resultRendered) return `${call};`
  const resultVar = `__use_result_${a.markerId}__`
  return `{ const ${resultVar} = __normalizeUseActionResult__(${call}, ${JSON.stringify(a.markerId)}); __use_update_${a.markerId}__ = ${resultVar}.update ?? null; __use_destroy_${a.markerId}__ = ${resultVar}.destroy ?? null; if (__use_update_${a.markerId}__) __use_update_${a.markerId}__(); }`
}

// ADR-0025: onMount callbackをDOMへ接続しないcomponent-level lifecycleとして
// 呼び出す。cleanupを返す形だけ生成変数へ保持し、登録順の逆順でunmountする。
// callbackの戻り値形は解析段階で検証済みなので、action用の汎用runtime helperを
// importしない。
function renderMountCall(
  m: MountOutput,
  index: number,
  localUpdateExprs: (string | null)[] = [],
  cleanupPrefix = '__on_mount_cleanup_',
): string {
  const bodyRendered = m.bodyRendered.replace(
    /__LOCAL_(SELF_UPDATE|ANCESTOR_(\d+))__\(\);?/g,
    (_match, kind, levelText) => {
      const level = kind === 'SELF_UPDATE' ? 0 : Number(levelText)
      const updateExpr = localUpdateExprs[level]
      if (!updateExpr) {
        throw new Error(`codegen: missing local update expression for mount at level ${level}`)
      }
      return `${updateExpr};`
    },
  )
  const body = bodyRendered ? `${bodyRendered};` : ''
  const callback = `(function() { ${body}${m.cleanupRendered ? ` return ${m.cleanupRendered};` : ''} })()`
  if (!m.cleanupRendered) return `${callback};`
  const cleanupName = `${cleanupPrefix}${index}__`
  return `{ const __mount_cleanup_result__ = ${callback}; ${cleanupName} = __mount_cleanup_result__; }`
}

// effect callbackはinstance専用runnerへ固定する。再実行時は前回cleanupを
// 先に空にしてからcallbackを呼ぶため、callbackが例外を投げても同じcleanupを
// unmountで二重に呼ばない。
function renderEffectRunner(e: EffectOutput, index: number): string[] {
  const body = e.bodyRendered ? `${e.bodyRendered};` : ''
  const callback = `(function() { ${body}${e.cleanupRendered ? ` return ${e.cleanupRendered};` : ''} })()`
  const lines = [
    `function __run_effect_${index}__() {`,
    '  if (!__mounted__ || __unmounted__) return;',
  ]
  if (e.cleanupRendered) {
    lines.push(
      `  if (__effect_cleanup_${index}__) { const __cleanup__ = __effect_cleanup_${index}__; __effect_cleanup_${index}__ = null; __cleanup__(); }`,
      `  __effect_cleanup_${index}__ = ${callback};`,
    )
  } else {
    lines.push(`  ${callback};`)
  }
  lines.push('}')
  return lines
}

// 構造unit内effectはrootの状態変数を共有せず、factory instanceの
// mount/update/destroyへ閉じ込める。runnerを使わないunitにはこの関数も
// cleanup slotも生成しない。
function renderLocalEffectRunner(e: LocalEffectOutput, index: number): string[] {
  const body = e.bodyRendered ? `${e.bodyRendered};` : ''
  const callback = `(function() { ${body}${e.cleanupRendered ? ` return ${e.cleanupRendered};` : ''} })()`
  const lines = [
    `function __run_unit_effect_${index}__() {`,
    '  if (!__unit_mounted__ || __unit_destroyed__) return;',
  ]
  if (e.cleanupRendered) {
    lines.push(
      `  if (__unit_effect_cleanup_${index}__) { const __cleanup__ = __unit_effect_cleanup_${index}__; __unit_effect_cleanup_${index}__ = null; __cleanup__(); }`,
      `  __unit_effect_cleanup_${index}__ = ${callback};`,
    )
  } else {
    lines.push(`  ${callback};`)
  }
  lines.push('}')
  return lines
}

export function generateModule({
  supportStatements,
  externalImports,
  sharedStatements,
  sharedDerivedStatements,
  sharedSignalNames,
  sharedDerivedIds,
  declStatements,
  markers,
  signalToMarkers,
  updateBatches,
  declOutputName,
  derivedDeps,
  derivedRecompute,
  collectionKeyRendered,
  handlers,
  actions,
  mounts,
  effects,
  attrBindings,
  emittedFns,
  initialHtml,
}: GenerateModuleInput): string {
  const moduleLines: string[] = []
  const instanceLines: string[] = []
  const hasStructuralUnits = markers.some(
    (marker) => marker.kind === 'list' || marker.kind === 'conditional',
  )
  const hasStructuralEffects = markersHaveStructuralEffects(markers)
  const runtimeImports = hasStructuralUnits
    ? ['mountWithRanges as __mount__', 'hydrateWithRanges as __hydrate__']
    : ['mount as __mount__', 'hydrate as __hydrate__']
  if (actions.some((a) => a.resultRendered) || markersHaveResultActions(markers)) {
    runtimeImports.push('normalizeUseActionResult as __normalizeUseActionResult__')
  }
  if (markersHaveList(markers)) {
    runtimeImports.push(
      'createListRuntime as __createListRuntime__',
      'reconcileList as __reconcileList__',
      'updateListBinding as __updateListBinding__',
    )
  } else if (markersHaveReactiveBindings(markers)) {
    runtimeImports.push('updateListBinding as __updateListBinding__')
  }
  if (markersHaveLifecycleList(markers)) {
    runtimeImports.push(
      'reconcileListWithLifecycle as __reconcileListWithLifecycle__',
      'mountListRuntime as __mountListRuntime__',
      'destroyListRuntime as __destroyListRuntime__',
    )
  }
  if (collectionKeyRendered.size > 0) {
    runtimeImports.push(
      'createCollectionState as __createCollectionState__',
      'replaceCollection as __replaceCollection__',
      'updateCollectionItem as __updateCollectionItem__',
    )
    if (markers.some((marker) => marker.kind === 'list' && marker.collectionDeclId !== null)) {
      runtimeImports.push('updateListItem as __updateListItem__')
    }
  }
  if (sharedStatements.length > 0) runtimeImports.push('sharedSignal as __sharedSignal__')
  if (externalImports.length > 0) moduleLines.push(...externalImports, '')
  moduleLines.push(`import { ${runtimeImports.join(', ')} } from '@irisout/runtime';`, '')
  if (supportStatements.length > 0) moduleLines.push(...supportStatements, '')
  if (sharedStatements.length > 0) moduleLines.push(...sharedStatements, '')
  if (sharedDerivedStatements.length > 0) moduleLines.push(...sharedDerivedStatements, '')
  instanceLines.push(...declStatements, '')
  // cross-function-handler-writes design D4: 追跡された動きゾーン関数をauthored
  // 名のままinstanceスコープへemitする(update_*()は本体に入れない — D3)。
  // 関数宣言なのでhoistされ、ハンドラ/他の追跡関数からそのまま呼べる。
  for (const fn of emittedFns) {
    instanceLines.push(`${fn.async ? 'async ' : ''}function ${fn.name}(${fn.params}) {${fn.body}}`)
  }
  if (emittedFns.length > 0) instanceLines.push('')
  instanceLines.push(`const __INITIAL_HTML__ = ${JSON.stringify(initialHtml)};`, '')

  // 検証用の期待マーカー ID(実要素を指すトップレベルマーカー+ハンドラの
  // マーカー)。構造ユニットは要素ではなくコメント範囲なので、別の
  // __RANGE_IDS__ として検証する。factory内部のローカルマーカーは
  // <template>由来で欠落し得ないため対象外。
  const structuralMarkerIds = markers
    .filter(
      (m): m is ListMarkerOutput | ConditionalMarkerOutput =>
        m.kind === 'list' || m.kind === 'conditional',
    )
    .map((m) => m.id)
  const markerIds = [
    ...new Set<string>([
      ...markers.filter((m) => m.kind !== 'list' && m.kind !== 'conditional').map((m) => m.id),
      ...handlers.map((h) => h.markerId),
      ...attrBindings.map((b) => b.markerId),
    ]),
  ]
  instanceLines.push(`const __MARKER_IDS__ = ${JSON.stringify(markerIds)};`, '')
  if (structuralMarkerIds.length > 0) {
    instanceLines.push(`const __RANGE_IDS__ = ${JSON.stringify(structuralMarkerIds)};`, '')
  }

  const { declLines, templateSetupLines, signalsNeedingInitialCall } = generateStructuralUnits(
    markers,
    signalToMarkers,
  )
  if (declLines.length > 0) instanceLines.push(...declLines, '')

  // 返り値を持つactionだけ、update/destroy を保持するinstanceスコープ変数を
  // 宣言する。返り値の無いactionには既存どおり配線機構を出力しない。
  const actionDeclLines = actions
    .filter((a) => a.resultRendered)
    .flatMap((a) => [`let __use_update_${a.markerId}__;`, `let __use_destroy_${a.markerId}__;`])
  if (actionDeclLines.length > 0) instanceLines.push(...actionDeclLines, '')

  // onMountのcleanup返り値を持つcallbackだけ、component instance専有の参照を
  // 生成する。onMount未使用、またはcleanupなしのcallbackでは関連コードを
  // 出力しない。
  const mountCleanupDeclLines = mounts
    .map((mount, index) => (mount.cleanupRendered ? `let __on_mount_cleanup_${index}__;` : null))
    .filter((line): line is string => line !== null)
  if (mountCleanupDeclLines.length > 0) instanceLines.push(...mountCleanupDeclLines, '')

  // effectのcleanup返り値を持つcallbackだけ、component instance専有の参照を
  // 生成する。effect未使用、またはcleanupなしのcallbackでは関連コードを
  // 出力しない。
  const effectCleanupDeclLines = effects
    .map((effect, index) => (effect.cleanupRendered ? `let __effect_cleanup_${index}__;` : null))
    .filter((line): line is string => line !== null)
  if (effectCleanupDeclLines.length > 0) instanceLines.push(...effectCleanupDeclLines, '')

  const sharedUnsubscribeDeclLines = sharedSignalNames.map(
    (_name, index) => `let __shared_unsubscribe_${index}__;`,
  )
  if (sharedUnsubscribeDeclLines.length > 0) instanceLines.push(...sharedUnsubscribeDeclLines, '')

  // collection.update()を含む同期batchだけが使う、インスタンス専有の
  // 深さカウンタ。ハンドラ/actionの本体中は直接DOM通知を抑止し、scope末尾
  // のbatchが最終状態を一度だけ反映する。
  if (updateBatches.some((batch) => batch.containsCollection)) {
    instanceLines.push('let __update_batch_depth__ = 0;', '')
  }

  // ハンドラのラッパー関数:元のハンドラ本体(書き込みは代入済み)を実行した
  // 後、そのハンドラが書き込んだ signal ぶんの update_* をまとめて呼ぶ。
  for (const h of handlers) {
    instanceLines.push(
      `const __handler_${h.markerId}_${h.eventName} = ${renderHandlerCall(h, null)};`,
    )
  }
  if (handlers.length > 0) instanceLines.push('')

  // mountComponent と hydrateComponent で共有する addEventListener 配線行
  // (markers の取得手段だけが違う: innerHTML 書き込みありか、なしか)。
  const setupLines = handlers.map(
    (h) =>
      `  __markers__.get(${JSON.stringify(h.markerId)})?.addEventListener(${JSON.stringify(h.eventName)}, __handler_${h.markerId}_${h.eventName});`,
  )
  const sharedSubscribeLines = sharedSignalNames.map(
    (name, index) => `  __shared_unsubscribe_${index}__ = ${name}.subscribe(update_${name});`,
  )

  // M5: リスト/条件分岐は初期 HTML に含まれないので、mount/hydrate 直後に
  // 依存 signal ぶんの update_<name>() を一度呼んで populate する。
  const initialUpdateCalls = [...signalsNeedingInitialCall].map(
    (id) => `  update_${declOutputName.get(id)}();`,
  )
  const docSetupLines =
    templateSetupLines.length > 0
      ? ['  __doc__ = container.ownerDocument;', ...templateSetupLines]
      : []

  // 生成された template は instance が保持する DOM 文書フラグメントでもある。
  // unmount 後に instance を保持してもそれらを参照し続けないよう、トップレベル
  // と nested unit の全 template 変数を収集して解放する。nested unit の
  // ListRuntime は外側 runtime の items を clear すれば handle ごと到達不能になる。
  const templateVars = new Set<string>()
  const collectBodyTemplateVars = (body: StructuralUnitBodyOutput): void => {
    for (const unit of bodyUnits(body)) {
      if (unit.kind === 'list') {
        templateVars.add(`__tpl_${unit.id}__`)
        collectBodyTemplateVars(unit.body)
      } else {
        unit.branches.forEach((branch, index) => {
          if (!branch.body) return
          templateVars.add(`__tpl_${unit.id}_b${index}__`)
          collectBodyTemplateVars(branch.body)
        })
      }
    }
  }
  for (const marker of markers) {
    if (marker.kind === 'list') {
      templateVars.add(`__tpl_${marker.id}__`)
      collectBodyTemplateVars(marker.body)
    } else if (marker.kind === 'conditional') {
      marker.branches.forEach((branch, index) => {
        if (!branch.body) return
        templateVars.add(`__tpl_${marker.id}_b${index}__`)
        collectBodyTemplateVars(branch.body)
      })
    }
  }

  // design Decision 2: 呼び出し順は マーカー収集 → ハンドラ配線 →
  // 初期update_*(populate) → action → onMount → effect初期実行。
  const actionCallLines = actions.map(
    (a) => `  ${renderActionCall(a, `__markers__.get(${JSON.stringify(a.markerId)})`)}`,
  )
  const mountCallLines = mounts.map((mount, index) => `  ${renderMountCall(mount, index)}`)
  const effectRunnerLines = effects.flatMap((effect, index) => renderEffectRunner(effect, index))
  if (effectRunnerLines.length > 0) instanceLines.push(...effectRunnerLines, '')
  const effectCallLines = effects.map((_, index) => `  __run_effect_${index}__();`)

  const actionDestroyOperations = actions
    .filter((a) => a.resultRendered)
    .reverse()
    .map(
      (a) =>
        `if (__use_destroy_${a.markerId}__) { const __destroy__ = __use_destroy_${a.markerId}__; __use_destroy_${a.markerId}__ = null; __use_update_${a.markerId}__ = null; __destroy__(); } else { __use_update_${a.markerId}__ = null; }`,
    )
  const mountCleanupOperations = mounts
    .map((mount, index) =>
      mount.cleanupRendered
        ? `if (__on_mount_cleanup_${index}__) { const __cleanup__ = __on_mount_cleanup_${index}__; __on_mount_cleanup_${index}__ = null; __cleanup__(); }`
        : null,
    )
    .filter((operation): operation is string => operation !== null)
    .reverse()
  const effectCleanupOperations = effects
    .map((effect, index) =>
      effect.cleanupRendered
        ? `if (__effect_cleanup_${index}__) { const __cleanup__ = __effect_cleanup_${index}__; __effect_cleanup_${index}__ = null; __cleanup__(); }`
        : null,
    )
    .filter((operation): operation is string => operation !== null)
    .reverse()
  const handlerRemoveLines = handlers.map(
    (h) =>
      `  __markers__?.get(${JSON.stringify(h.markerId)})?.removeEventListener(${JSON.stringify(h.eventName)}, __handler_${h.markerId}_${h.eventName});`,
  )
  const structuralDestroyOperations: string[] = []
  const listCleanupLines = markers
    .filter((marker): marker is ListMarkerOutput => marker.kind === 'list')
    .flatMap((marker) => {
      if (bodyHasLifecycle(marker.body)) {
        structuralDestroyOperations.push(
          `if (__list_${marker.id}__) __destroyListRuntime__(__list_${marker.id}__)`,
        )
        return [`  __list_${marker.id}__ = null;`]
      }
      return [
        `  if (__list_${marker.id}__) __list_${marker.id}__.items.clear();`,
        `  __list_${marker.id}__ = null;`,
      ]
    })
  const conditionalCleanupLines = markers
    .filter((marker): marker is ConditionalMarkerOutput => marker.kind === 'conditional')
    .flatMap((marker) => {
      if (markerHasLifecycle(marker)) {
        structuralDestroyOperations.push(
          `if (__cond_${marker.id}_handle__) { const __handle__ = __cond_${marker.id}_handle__; try { __handle__.destroy?.(); } catch (__structural_destroy_error__) { __destroy_error__ ??= __structural_destroy_error__; } try { __handle__.el.remove(); } catch (__structural_remove_error__) { __destroy_error__ ??= __structural_remove_error__; } }`,
        )
        return [`  __cond_${marker.id}_handle__ = null;`, `  __cond_${marker.id}__ = -1;`]
      }
      return [
        `  if (__cond_${marker.id}_handle__) __cond_${marker.id}_handle__.el.remove();`,
        `  __cond_${marker.id}_handle__ = null;`,
        `  __cond_${marker.id}__ = -1;`,
      ]
    })
  const templateCleanupLines = [...templateVars].map((name) => `  ${name} = null;`)
  const documentCleanupLines = templateSetupLines.length > 0 ? ['  __doc__ = undefined;'] : []
  const destroyOperations = [...structuralDestroyOperations, ...actionDestroyOperations]
  destroyOperations.push(...mountCleanupOperations, ...effectCleanupOperations)
  const destroyErrorLines =
    destroyOperations.length > 0
      ? [
          '  let __destroy_error__;',
          ...destroyOperations.map(
            (line) => `  try { ${line} } catch (__error__) { __destroy_error__ ??= __error__; }`,
          ),
        ]
      : []
  const destroyErrorThrow =
    destroyOperations.length > 0 ? ['  if (__destroy_error__) throw __destroy_error__;'] : []
  const initializationLines = [
    ...docSetupLines,
    ...setupLines,
    ...initialUpdateCalls,
    ...actionCallLines,
    ...mountCallLines,
    ...effectCallLines,
  ]
  const shouldGuardInitialization =
    actions.length > 0 ||
    markersHaveStructuralActions(markers) ||
    mounts.length > 0 ||
    effects.length > 0
  const guardedInitializationLines =
    shouldGuardInitialization && initializationLines.length > 0
      ? [
          '  try {',
          ...initializationLines.map((line) => `  ${line}`),
          '  } catch (__error__) {',
          '    try { unmount(); } catch (__cleanup_error__) {}',
          '    throw __error__;',
          '  }',
        ]
      : initializationLines

  instanceLines.push(
    'let __markers__;',
    ...(structuralMarkerIds.length > 0 ? ['let __ranges__;'] : []),
    'let __container__;',
    'let __mounted__ = false;',
    'let __unmounted__ = false;',
    ...(hasStructuralEffects ? ['let __effect_trigger__ = null;'] : []),
    ...(effects.length > 0 ? ['let __initializing__ = false;'] : []),
    'function mount(container) {',
    '  if (__mounted__ || __unmounted__) throw new Error("component instance can only be mounted or hydrated once");',
    structuralMarkerIds.length > 0
      ? '  ({ markers: __markers__, ranges: __ranges__ } = __mount__(container, __INITIAL_HTML__, __MARKER_IDS__, __RANGE_IDS__));'
      : '  ({ markers: __markers__ } = __mount__(container, __INITIAL_HTML__, __MARKER_IDS__));',
    '  __container__ = container;',
    '  __mounted__ = true;',
    ...sharedSubscribeLines,
    ...(effects.length > 0 ? ['  __initializing__ = true;'] : []),
    ...guardedInitializationLines,
    ...(effects.length > 0 ? ['  __initializing__ = false;'] : []),
    '}',
    '',
    'function hydrateComponentInstance(container) {',
    '  if (__mounted__ || __unmounted__) throw new Error("component instance can only be mounted or hydrated once");',
    structuralMarkerIds.length > 0
      ? '  ({ markers: __markers__, ranges: __ranges__ } = __hydrate__(container, __MARKER_IDS__, __RANGE_IDS__));'
      : '  ({ markers: __markers__ } = __hydrate__(container, __MARKER_IDS__));',
    '  __container__ = container;',
    '  __mounted__ = true;',
    ...sharedSubscribeLines,
    ...(effects.length > 0 ? ['  __initializing__ = true;'] : []),
    ...guardedInitializationLines,
    ...(effects.length > 0 ? ['  __initializing__ = false;'] : []),
    '}',
    '',
    'function unmount() {',
    '  if (!__mounted__ || __unmounted__) return;',
    '  __unmounted__ = true;',
    '  __mounted__ = false;',
    ...(effects.length > 0 ? ['  __initializing__ = false;'] : []),
    ...handlerRemoveLines,
    ...sharedSignalNames.map(
      (_name, index) =>
        `  if (__shared_unsubscribe_${index}__) { const __unsubscribe__ = __shared_unsubscribe_${index}__; __shared_unsubscribe_${index}__ = null; __unsubscribe__(); }`,
    ),
    ...destroyErrorLines,
    ...listCleanupLines,
    ...conditionalCleanupLines,
    '  if (__container__) __container__.replaceChildren();',
    '  __container__ = null;',
    '  if (__markers__) __markers__.clear();',
    '  __markers__ = undefined;',
    ...(structuralMarkerIds.length > 0
      ? ['  if (__ranges__) __ranges__.clear();', '  __ranges__ = undefined;']
      : []),
    ...documentCleanupLines,
    ...templateCleanupLines,
    ...destroyErrorThrow,
    '}',
    '',
  )

  // root signal/collection -> それに(直接・間接)依存する derived declId の
  // 一覧。derived は依存先より先に再計算する必要があるため、全体の
  // トポロジカル順序を作ってからrootごとの到達集合へ絞り込む。
  const derivedOrder: DeclId[] = []
  const visitingDerived = new Set<DeclId>()
  const visitedDerived = new Set<DeclId>()
  const visitDerived = (derivedId: DeclId): void => {
    if (visitedDerived.has(derivedId)) return
    if (visitingDerived.has(derivedId)) {
      throw new Error(`compile: derived dependency cycle includes "${derivedId}"`)
    }
    visitingDerived.add(derivedId)
    for (const dependency of derivedDeps.get(derivedId) ?? []) {
      if (derivedDeps.has(dependency)) visitDerived(dependency)
    }
    visitingDerived.delete(derivedId)
    visitedDerived.add(derivedId)
    derivedOrder.push(derivedId)
  }
  for (const derivedId of derivedDeps.keys()) visitDerived(derivedId)

  const directDerivedChildren = new Map<DeclId, DeclId[]>()
  for (const [derivedId, deps] of derivedDeps) {
    for (const dependency of deps) {
      const children = directDerivedChildren.get(dependency) ?? []
      children.push(derivedId)
      directDerivedChildren.set(dependency, children)
    }
  }

  const signalToDerivedRecomputes = new Map<DeclId, DeclId[]>()
  const collectDerivedDescendants = (rootId: DeclId): Set<DeclId> => {
    const descendants = new Set<DeclId>()
    const visit = (dependency: DeclId): void => {
      for (const child of directDerivedChildren.get(dependency) ?? []) {
        if (descendants.has(child)) continue
        descendants.add(child)
        visit(child)
      }
    }
    visit(rootId)
    return descendants
  }
  for (const dependency of directDerivedChildren.keys()) {
    if (derivedDeps.has(dependency)) continue
    const descendants = collectDerivedDescendants(dependency)
    signalToDerivedRecomputes.set(
      dependency,
      derivedOrder.filter((derivedId) => descendants.has(derivedId)),
    )
  }
  const orderedDerivedIds = (ids: Set<DeclId>): DeclId[] =>
    derivedOrder.filter((derivedId) => ids.has(derivedId))

  const derivedForRoots = (rootIds: Iterable<DeclId>): DeclId[] => {
    const ids = new Set<DeclId>()
    for (const rootId of rootIds) {
      for (const derivedId of signalToDerivedRecomputes.get(rootId) ?? []) ids.add(derivedId)
    }
    return orderedDerivedIds(ids)
  }

  // ADR-0012: marker id -> トップレベル動的属性の逆引き(update_* 生成用)。
  const attrsByMarker = new Map<MarkerId, AttrBinding[]>()
  for (const b of attrBindings) {
    const list = attrsByMarker.get(b.markerId) ?? []
    list.push(b)
    attrsByMarker.set(b.markerId, list)
  }
  const actionMarkerIds = new Set(actions.map((action) => action.markerId))
  const effectsBySignal = new Map<DeclId, number[]>()
  effects.forEach((effect, index) => {
    for (const signalId of effect.signalIds) {
      const indexes = effectsBySignal.get(signalId) ?? []
      indexes.push(index)
      effectsBySignal.set(signalId, indexes)
    }
  })
  const appendEffectUpdates = (lines: string[], signalIds: Iterable<DeclId>): void => {
    const indexes = new Set<number>()
    for (const signalId of signalIds) {
      for (const index of effectsBySignal.get(signalId) ?? []) indexes.add(index)
    }
    for (const index of [...indexes].sort((a, b) => a - b)) {
      lines.push(`  if (!__initializing__) __run_effect_${index}__();`)
    }
  }

  const appendMarkerUpdate = (lines: string[], mId: MarkerId, effectTriggerExpr = 'null'): void => {
    // 動的属性の再設定(属性のみの marker id は markers に実体を持たない
    // ため、marker 解決より先に処理する)。
    const bindings = attrsByMarker.get(mId)
    if (bindings) {
      lines.push(
        `  { const __el = __markers__.get(${JSON.stringify(mId)}); if (__el) { ${bindings.map((b) => renderAttrSet('__el', b)).join(' ')} } }`,
      )
    }
    const marker = markers.find((m) => m.id === mId)
    if (!marker) return
    if (marker.kind === 'text') {
      lines.push(
        `  { const __el = __markers__.get(${JSON.stringify(mId)}); if (__el) { __el.textContent = \`${innerTemplateSource(marker.contentParts)}\`; } }`,
      )
      if (actionMarkerIds.has(mId)) {
        lines.push(`  if (__use_update_${mId}__) __use_update_${mId}__();`)
      }
    } else if (marker.kind === 'list') {
      lines.push(
        ...generateListUpdate(
          marker,
          `__ranges__.get(${JSON.stringify(marker.id)})`,
          'true',
          effectTriggerExpr,
        ),
      )
    } else if (marker.kind === 'action') {
      lines.push(`  if (__use_update_${mId}__) __use_update_${mId}__();`)
    } else {
      lines.push(
        ...generateConditionalUpdate(
          marker,
          `__ranges__.get(${JSON.stringify(marker.id)})`,
          condDispatchesUpdate(marker, false),
          'true',
          effectTriggerExpr,
        ),
      )
    }
  }

  for (const [signalId, markerIds] of signalToMarkers) {
    const name = declOutputName.get(signalId)
    instanceLines.push(`function update_${name}() {`)
    instanceLines.push('  if (!__mounted__ || __unmounted__) return;')
    for (const derivedId of signalToDerivedRecomputes.get(signalId) ?? []) {
      if (sharedDerivedIds.has(derivedId)) continue
      instanceLines.push(`  ${declOutputName.get(derivedId)} = ${derivedRecompute.get(derivedId)};`)
    }
    if (hasStructuralEffects) {
      instanceLines.push(`  const __previous_effect_trigger__ = __effect_trigger__;`)
      instanceLines.push(`  __effect_trigger__ = new Set([${JSON.stringify(name)}]);`)
      instanceLines.push('  try {')
      for (const mId of markerIds) appendMarkerUpdate(instanceLines, mId, '__effect_trigger__')
      instanceLines.push(
        '  } finally {',
        '    __effect_trigger__ = __previous_effect_trigger__;',
        '  }',
      )
    } else {
      for (const mId of markerIds) appendMarkerUpdate(instanceLines, mId)
    }
    appendEffectUpdates(instanceLines, [signalId])
    instanceLines.push('}', '')
  }

  // 同じ同期スコープで複数 root signal が書き込まれ、marker 集合が重なる
  // 場合だけ compiler.ts が batch を登録する。各 derived は root の複数経路
  // から到達しても一度だけ再計算し、marker も和集合を一度だけ更新する。
  // 既存の update_<name>() は互換性のため残し、batch は内部の呼び出し先に
  // とどめる(公開 subscription/scheduler は導入しない)。
  for (const batch of updateBatches) {
    const derivedIds = derivedForRoots(batch.signalIds)
    instanceLines.push(`function ${batch.name}() {`)
    instanceLines.push('  if (!__mounted__ || __unmounted__) return;')
    for (const derivedId of derivedIds) {
      if (sharedDerivedIds.has(derivedId)) continue
      instanceLines.push(`  ${declOutputName.get(derivedId)} = ${derivedRecompute.get(derivedId)};`)
    }
    if (hasStructuralEffects) {
      instanceLines.push('  const __previous_effect_trigger__ = __effect_trigger__;')
      instanceLines.push(
        `  __effect_trigger__ = new Set(${JSON.stringify(batch.signalIds.map((id) => declOutputName.get(id)))})`,
      )
      instanceLines.push('  try {')
      for (const markerId of batch.markerIds) {
        appendMarkerUpdate(instanceLines, markerId, '__effect_trigger__')
      }
      instanceLines.push(
        '  } finally {',
        '    __effect_trigger__ = __previous_effect_trigger__;',
        '  }',
      )
    } else {
      for (const markerId of batch.markerIds) appendMarkerUpdate(instanceLines, markerId)
    }
    appendEffectUpdates(instanceLines, batch.signalIds)
    instanceLines.push('}', '')
  }

  for (const collectionId of collectionKeyRendered.keys()) {
    const name = declOutputName.get(collectionId)!
    const directLists = markers.filter(
      (marker): marker is ListMarkerOutput =>
        marker.kind === 'list' && marker.collectionDeclId === collectionId,
    )
    instanceLines.push(`function update_${name}_item(__key__, __updater__) {`)
    instanceLines.push('  if (!__mounted__ || __unmounted__) return;')
    instanceLines.push(
      `  const __next__ = __updateCollectionItem__(__collection_${name}__, __key__, __updater__);`,
    )
    const directUpdateLines: string[] = []
    for (const derivedId of signalToDerivedRecomputes.get(collectionId) ?? []) {
      if (sharedDerivedIds.has(derivedId)) continue
      directUpdateLines.push(
        `  ${declOutputName.get(derivedId)} = ${derivedRecompute.get(derivedId)};`,
      )
    }
    for (const mId of signalToMarkers.get(collectionId) ?? []) {
      const direct = directLists.find((marker) => marker.id === mId)
      if (!direct) {
        appendMarkerUpdate(
          directUpdateLines,
          mId,
          hasStructuralEffects ? '__effect_trigger__' : 'null',
        )
        continue
      }
      const usesSharedUpdater =
        bodyUnits(direct.body).length === 0 &&
        direct.body.localDecls.length === 0 &&
        direct.body.localActions.length === 0 &&
        direct.body.localEffects.length === 0
      const updaterArg = usesSharedUpdater ? `, __create_${direct.id}__update__` : ''
      directUpdateLines.push(
        `  __updateListItem__(__list_${direct.id}__, __key__, __next__${updaterArg});`,
      )
    }
    if (updateBatches.some((batch) => batch.containsCollection)) {
      instanceLines.push('  if (__update_batch_depth__ === 0) {')
      instanceLines.push(...directUpdateLines.map((line) => `  ${line}`))
      instanceLines.push('  }')
    } else {
      instanceLines.push(...directUpdateLines)
    }
    appendEffectUpdates(instanceLines, [collectionId])
    instanceLines.push('}', '')
  }

  const updateNames = [...signalToMarkers.keys()].map((id) => `update_${declOutputName.get(id)}`)
  instanceLines.push(
    `return { mount, hydrate: hydrateComponentInstance, unmount${updateNames.map((name) => `, ${name}`).join('')} };`,
  )

  moduleLines.push('export function createComponent() {')
  moduleLines.push(...instanceLines.map((line) => (line ? `  ${line}` : '')))
  moduleLines.push('}', '')
  moduleLines.push(
    'export function mountComponent(container) {',
    '  const instance = createComponent();',
    '  instance.mount(container);',
    '  return instance;',
    '}',
    '',
    'export function hydrateComponent(container) {',
    '  const instance = createComponent();',
    '  instance.hydrate(container);',
    '  return instance;',
    '}',
    '',
  )

  return moduleLines.join('\n')
}
