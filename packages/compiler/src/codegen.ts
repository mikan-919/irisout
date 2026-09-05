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
// M5.5: 1階層ネストした構造ユニットは、同じ factory 生成規則を外側 factory の
// クロージャ内へ再帰適用する(<template> だけは静的なので module スコープで
// 共有)。ネストしたユニットの依存は render.ts が外側マーカーへ合流済みなので、
// update_<signal>() → 外側 update → handle.update() の順で内側へ更新が届く。
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
  updateNames: string[]
  /** 複数 root が同じ marker を共有するときだけ使う同期 batch 名。 */
  updateBatchName: string | null
  /** batch の本体で collection.update() の直接通知を遅延するか。 */
  updateBatchNeedsCollection: boolean
  /** ADR-0009: 第1仮引数(イベントオブジェクト)の authored 名。なければ null。 */
  param: string | null
  /** same-file-component-composition: このユニット自身のローカルsignalへ
   * 書き込む場合、既存のroot更新呼び出しに加えてこのユニットの
   * factoryが持つ`update()`クロージャも呼ぶ(design.md D5)。 */
  callLocalUpdate: boolean
}

// M5: StructuralUnitBody(state.ts)のハンドラを HandlerDecl から
// HandlerOutput へ変換したもの。それ以外のフィールドは同じ形。
// M5.5: 1階層ネストした構造ユニットも localMarkers に含まれる。
export interface StructuralUnitBodyOutput {
  template: string
  localMarkers: (TextMarker | ListMarkerOutput | ConditionalMarkerOutput)[]
  localHandlers: HandlerOutput[]
  /** ADR-0012: このユニット専有の動的属性バインディング。 */
  localAttrBindings: AttrBinding[]
  /** same-file-component-composition: このユニット直下のローカルsignal宣言。 */
  localDecls: LocalDecl[]
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
// action1個ぶんの最終テキスト。bodyRendered/closureRendered は既に
// 個別 update または同期 batch 呼び出し込み(design D4-1/D5) -- codegen はこれを文字列として
// 組み立てるだけで、ctx や AST には一切触れない。
export interface ActionOutput {
  markerId: MarkerId
  elParam: string | null
  bodyRendered: string
  /** 返り値クロージャの完全な関数式テキスト。無ければ null(design Decision 5)。 */
  closureRendered: string | null
}

export interface GenerateModuleInput {
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
  attrBindings: AttrBinding[] // ADR-0012: トップレベルの動的属性
  // cross-function-handler-writes: 追跡対象として呼ばれた動きゾーン関数を
  // authored 名のままモジュールスコープへ1回だけ emit する(design D4)。
  emittedFns: { name: string; params: string; body: string }[]
  initialHtml: string
}

// クローンしたテンプレート内から data-iris-id を持つ要素を探す。ルート
// 要素自身がマーカーの場合(item/branch の直接の子に marker が付く形)は
// querySelector が自分自身を対象にしないので、先に自分自身を確認する。
const FIND_HELPER = `function __find__(root, id) { return root.getAttribute("data-iris-id") === id ? root : root.querySelector(\`[data-iris-id="\${id}"]\`); }`

// itemParam: このハンドラを含む factory の item 仮引数名(無ければ null)。
// same-file-component-composition: ローカルsignal書き込み後に呼ぶ
// `update()`は itemParam != null の factory では item 引数を要求する
// (`function update(__next__) { <itemParam> = __next__; ... }`) ―
// 引数無しで呼ぶと item が undefined で上書きされる(design.md D5)。
function renderHandlerCall(h: HandlerOutput, itemParam: string | null, prelude = ''): string {
  const updateCalls = h.updateBatchName
    ? `${h.updateBatchName}();`
    : h.updateNames.map((name) => `update_${name}();`).join(' ')
  // same-file-component-composition: このユニット自身のローカルsignalへの
  // 書き込みは、モジュールscopeのupdate_*ではなくこのfactory自身の
  // `update()`クロージャを呼ぶ(design.md D5、bare識別子 ― 同一ユニット
  // 直下限定なので関数宣言の巻き上げにより参照は曖昧にならない)。
  const localUpdateCall = h.callLocalUpdate ? `update(${itemParam ?? ''});` : ''
  const body = `${prelude}${h.rendered}`
  const scopedBody = h.updateBatchNeedsCollection
    ? `__update_batch_depth__++; try { ${body} } finally { __update_batch_depth__--; }`
    : body
  // ADR-0009 D4: 第1引数があるハンドラのみ authored 名を束縛する。
  const params = h.param ? `${h.param}, ...__args` : '...__args'
  return `(${params}) => { ${scopedBody}; ${updateCalls}${localUpdateCall ? ` ${localUpdateCall}` : ''} }`
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

function markersHaveList(markers: MarkerOutput[]): boolean {
  return markers.some((marker) => {
    if (marker.kind === 'list') return true
    if (marker.kind !== 'conditional') return false
    return marker.branches.some((branch) => branch.body != null && bodyHasList(branch.body))
  })
}

// ブランチ factory が update() を返すか。ネストしたユニットを含む場合と、
// 外側に item 仮引数があってテキストの再描画が要る場合のみ true ―
// それ以外のブランチは M5 と同じ set-once + { el } のまま(ADR-0004:
// 出力が膨らむ方向の変換は避ける)。
function branchHasUpdate(body: StructuralUnitBodyOutput, inItemScope: boolean): boolean {
  return (
    bodyUnits(body).length > 0 ||
    (inItemScope && (bodyTexts(body).length > 0 || body.localAttrBindings.length > 0))
  )
}

function condDispatchesUpdate(marker: ConditionalMarkerOutput, inItemScope: boolean): boolean {
  return marker.branches.some((b) => b.body != null && branchHasUpdate(b.body, inItemScope))
}

// factory 関数本体:テンプレートのクローン取得・ローカル marker の解決・
// ハンドラ登録・(item がある場合のみ)update() クロージャをまとめて1関数に
// する(ADR-0005 決定2)。item がない(条件分岐ブランチ)場合、ローカル
// marker の内容は一度だけ設定する ― 分岐内で追跡 signal を参照することは
// render.ts 側の scope limit で既に禁止しているので、以後の再計算は要らない。
//
// M5.5: ネストした構造ユニットがある場合、その keyed Map・状態変数・factory
// 関数をこの factory のクロージャ内に入れ子で生成する(specs「ネストした
// 構造ユニットのfactory生成」)。update() はネストしたユニットの keyed diff /
// 条件分岐 update も再実行する。inItemScope は「外側のどこかに item 仮引数が
// あるか」― その場合のみブランチのテキストも update() で再描画する
// (外側 item の値差し替えを閉包経由で反映するため)。
function generateFactory(
  factoryName: string,
  templateVar: string,
  itemParam: string | null,
  body: StructuralUnitBodyOutput,
  inItemScope: boolean,
): string[] {
  const texts = bodyTexts(body)
  const units = bodyUnits(body)
  const childScope = inItemScope || itemParam != null

  // 通常のList itemは、行ごとのupdateクロージャではなくデータhandleを返す。
  // update関数はfactoryと同じスコープに1個だけ生成し、runtimeが
  // update(handle, next)として呼ぶ。ネスト構造またはローカルsignalを持つitemは
  // まだ外側のlexical scopeを必要とするため、下の汎用factory経路を使う。
  if (itemParam != null && units.length === 0 && body.localDecls.length === 0) {
    const lines: string[] = []
    const updateName = `${factoryName}update__`
    const attrs = body.localAttrBindings
    const foundIds = new Set(body.localMarkers.map((m) => m.id))
    const refIds = new Set<string>([
      ...body.localMarkers.map((m) => m.id),
      ...attrs.map((b) => b.markerId),
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
    for (const m of body.localMarkers) {
      lines.push(`  const __${m.id}__ = __find__(__el__, ${JSON.stringify(m.id)});`)
    }
    for (const id of new Set(attrs.map((b) => b.markerId))) {
      if (!foundIds.has(id)) {
        lines.push(`  const __${id}__ = __find__(__el__, ${JSON.stringify(id)});`)
      }
    }
    const refs = [...refIds].map((id) => `${id}: __${id}__`).join(', ')
    lines.push(
      `  const __handle__ = { el: __el__, item: __item__, value: ${itemParam}, refs: { ${refs} } };`,
    )
    for (const h of body.localHandlers) {
      lines.push(
        `  __find__(__el__, ${JSON.stringify(h.markerId)}).addEventListener(${JSON.stringify(h.eventName)}, ${renderHandlerCall(h, itemParam, `${itemParam} = __handle__.value; `)});`,
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
  // same-file-component-composition: このユニットへインライン化された
  // コンポーネントのローカルsignal(CONTEXT.md)。module scopeへは出さず、
  // このfactoryインスタンス専有のクロージャ変数として宣言する(design D5)。
  for (const d of body.localDecls) {
    lines.push(`  let ${d.outputName} = ${d.rendered};`)
  }
  for (const m of body.localMarkers) {
    lines.push(`  const __${m.id}__ = __find__(__el__, ${JSON.stringify(m.id)});`)
  }
  // ADR-0012: 属性のみの要素のマーカーは localMarkers に居ないので、find 定数を
  // 別途確保する(text マーカーと同居する場合は重複させない)。
  const attrs = body.localAttrBindings
  const foundIds = new Set(body.localMarkers.map((m) => m.id))
  for (const id of new Set(attrs.map((b) => b.markerId))) {
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
        ...generateFactory(
          `__create_${u.id}__`,
          `__tpl_${u.id}__`,
          u.itemParam,
          u.body,
          childScope,
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
          ).map((l) => `  ${l}`),
        )
      })
    }
  }
  for (const h of body.localHandlers) {
    lines.push(
      `  __find__(__el__, ${JSON.stringify(h.markerId)}).addEventListener(${JSON.stringify(h.eventName)}, ${renderHandlerCall(h, itemParam)});`,
    )
  }
  // テキスト/属性の再設定が要るのは item 仮引数(自身または外側)を参照
  // しうる場合のみ。それ以外は静的なので一度だけ設定する(属性の初期値は
  // テンプレートに焼き込まれないため、この設定行が初期値を兼ねる —
  // ADR-0012 決定3)。
  const refreshTexts = (itemParam != null || inItemScope) && texts.length > 0
  const refreshAttrs = (itemParam != null || inItemScope) && attrs.length > 0
  const needsUpdate = itemParam != null || refreshTexts || refreshAttrs || units.length > 0
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
    lines.push(`  function update(${itemParam ? '__next__' : ''}) {`)
    if (itemParam) lines.push(`    ${itemParam} = __next__;`)
    if (refreshTexts) {
      for (const m of texts) {
        const valueVar = `__value_${m.id}__`
        lines.push(
          `    const ${valueVar} = \`${innerTemplateSource(m.contentParts)}\`;`,
          `    if (__updateListBinding__(__item__, ${JSON.stringify(m.id)}, ${valueVar})) __${m.id}__.textContent = ${valueVar};`,
        )
      }
    }
    if (refreshAttrs) {
      attrs.forEach((b, i) => {
        const valueVar = `__attr_${i}__`
        const bindingId = `${b.markerId}:${b.name}`
        lines.push(
          `    const ${valueVar} = ${b.rendered};`,
          `    if (__updateListBinding__(__item__, ${JSON.stringify(bindingId)}, ${valueVar})) ${renderAttrSet(`__${b.markerId}__`, { ...b, rendered: valueVar })}`,
        )
      })
    }
    for (const u of units) {
      if (u.kind === 'list') {
        lines.push(...generateListUpdate(u, `__${u.id}__`).map((l) => `  ${l}`))
      } else {
        lines.push(
          ...generateConditionalUpdate(u, `__${u.id}__`, condDispatchesUpdate(u, childScope)).map(
            (l) => `  ${l}`,
          ),
        )
      }
    }
    lines.push('  }')
    lines.push(`  update(${itemParam ?? ''});`)
    lines.push('  return { el: __el__, update };')
  } else {
    lines.push('  return { el: __el__ };')
  }
  lines.push('}')
  return lines
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
    declLines.push('let __doc__;', FIND_HELPER, '')
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
        `const __list_${marker.id}__ = __createListRuntime__(${JSON.stringify(marker.id)});`,
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
  for (const [signalId, markerIds] of signalToMarkers) {
    for (const mId of markerIds) {
      if (structuralMarkerIds.has(mId)) {
        signalsNeedingInitialCall.add(signalId)
        break
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
function generateListUpdate(marker: ListMarkerOutput, elExpr: string): string[] {
  const usesSharedUpdater =
    bodyUnits(marker.body).length === 0 && marker.body.localDecls.length === 0
  const updaterArg = usesSharedUpdater ? `, __create_${marker.id}__update__` : ''
  const keyOf = marker.collectionOutputName
    ? `(${marker.itemParam}) => { const __key__ = ${marker.keyRendered}; if (!Object.is(__collection_${marker.collectionOutputName}__.keyOf(${marker.itemParam}), __key__)) throw new Error("collection List key does not match collection identity"); return __key__; }`
    : `(${marker.itemParam}) => ${marker.keyRendered}`
  return [
    `  __reconcileList__(__list_${marker.id}__, ${elExpr}, ${marker.arrayRendered}, ${keyOf}, __create_${marker.id}__${updaterArg});`,
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
): string[] {
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
        ? `      if (__target__ === ${i}) ${handleVar} = __create_${marker.id}_b${i}__();`
        : null,
    )
    .filter((l): l is string => l !== null)
  const lines = [
    '  {',
    `    const __target__ = ${targetExpr};`,
    `    if (__target__ !== ${stateVar}) {`,
    `      if (${handleVar}) { ${handleVar}.el.remove(); ${handleVar} = null; }`,
    `      ${stateVar} = __target__;`,
    ...branchCreateLines,
    `      if (${handleVar}) { const __el__ = ${elExpr}; if (__el__) __el__.appendChild(${handleVar}.el); }`,
  ]
  if (dispatchUpdate) {
    lines.push(
      `    } else if (${handleVar} && ${handleVar}.update) {`,
      `      ${handleVar}.update();`,
      '    }',
    )
  } else {
    lines.push('    }')
  }
  lines.push('  }')
  return lines
}

// ADR-0011 design Decision 2/5: mount/hydrate 末尾でaction本体を実行し、
// 返り値クロージャがあれば `__use_<id>__` へ代入して直後に1回初期実行する。
// クロージャが無いactionは呼び出しのみ(配線コードを一切出さない)。
function renderActionCall(a: ActionOutput): string {
  const fn = `function(${a.elParam ?? ''}) {${a.bodyRendered}${a.closureRendered ? ` return ${a.closureRendered};` : ''}}`
  const call = `(${fn})(__markers__.get(${JSON.stringify(a.markerId)}))`
  if (!a.closureRendered) return `${call};`
  return `__use_${a.markerId}__ = ${call}; if (__use_${a.markerId}__) __use_${a.markerId}__();`
}

export function generateModule({
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
  attrBindings,
  emittedFns,
  initialHtml,
}: GenerateModuleInput): string {
  const moduleLines: string[] = []
  const instanceLines: string[] = []
  const runtimeImports = ['mount as __mount__', 'hydrate as __hydrate__']
  if (markersHaveList(markers)) {
    runtimeImports.push(
      'createListRuntime as __createListRuntime__',
      'reconcileList as __reconcileList__',
      'updateListBinding as __updateListBinding__',
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
  moduleLines.push(`import { ${runtimeImports.join(', ')} } from '@irisout/runtime';`, '')
  instanceLines.push(...declStatements, '')
  // cross-function-handler-writes design D4: 追跡された動きゾーン関数をauthored
  // 名のままinstanceスコープへemitする(update_*()は本体に入れない — D3)。
  // 関数宣言なのでhoistされ、ハンドラ/他の追跡関数からそのまま呼べる。
  for (const fn of emittedFns) {
    instanceLines.push(`function ${fn.name}(${fn.params}) {${fn.body}}`)
  }
  if (emittedFns.length > 0) instanceLines.push('')
  instanceLines.push(`const __INITIAL_HTML__ = ${JSON.stringify(initialHtml)};`, '')

  // 検証用の期待マーカー ID(トップレベルマーカー全部+ハンドラのみの
  // マーカー)。factory 内部のローカルマーカーは <template> 由来で欠落
  // し得ないため対象外。検証ループはランタイム側(ADR-0004: 出力の膨張を
  // 最小化)。
  const markerIds = [
    ...new Set<string>([
      ...markers.map((m) => m.id),
      ...handlers.map((h) => h.markerId),
      ...attrBindings.map((b) => b.markerId),
    ]),
  ]
  instanceLines.push(`const __MARKER_IDS__ = ${JSON.stringify(markerIds)};`, '')

  const { declLines, templateSetupLines, signalsNeedingInitialCall } = generateStructuralUnits(
    markers,
    signalToMarkers,
  )
  if (declLines.length > 0) instanceLines.push(...declLines, '')

  // 返り値クロージャを持つactionだけ、それを保持するinstanceスコープ変数を
  // 宣言する(design Decision 5: クロージャが無ければ機構自体を出力しない)。
  const actionDeclLines = actions
    .filter((a) => a.closureRendered)
    .map((a) => `let __use_${a.markerId}__;`)
  if (actionDeclLines.length > 0) instanceLines.push(...actionDeclLines, '')

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

  // M5: リスト/条件分岐は初期 HTML に含まれないので、mount/hydrate 直後に
  // 依存 signal ぶんの update_<name>() を一度呼んで populate する。
  const initialUpdateCalls = [...signalsNeedingInitialCall].map(
    (id) => `  update_${declOutputName.get(id)}();`,
  )
  const docSetupLines =
    templateSetupLines.length > 0
      ? ['  __doc__ = container.ownerDocument;', ...templateSetupLines]
      : []

  // design Decision 2: 呼び出し順は マーカー収集 → ハンドラ配線 →
  // 初期update_*(populate) → action呼び出し+返り値クロージャ初期実行。
  const actionCallLines = actions.map((a) => `  ${renderActionCall(a)}`)

  instanceLines.push(
    'let __markers__;',
    'function mount(container) {',
    '  ({ markers: __markers__ } = __mount__(container, __INITIAL_HTML__, __MARKER_IDS__));',
    ...docSetupLines,
    ...setupLines,
    ...initialUpdateCalls,
    ...actionCallLines,
    '}',
    '',
    'function hydrateComponentInstance(container) {',
    '  ({ markers: __markers__ } = __hydrate__(container, __MARKER_IDS__));',
    ...docSetupLines,
    ...setupLines,
    ...initialUpdateCalls,
    ...actionCallLines,
    '}',
    '',
  )

  // signal declId -> それに直接依存する derived declId の一覧。M1 では
  // derived-of-derived を禁止しているので、これはフラットな逆引きで足りる。
  const signalToDerivedRecomputes = new Map<DeclId, DeclId[]>()
  for (const [derivedId, deps] of derivedDeps) {
    for (const dep of deps) {
      const list = signalToDerivedRecomputes.get(dep) ?? []
      list.push(derivedId)
      signalToDerivedRecomputes.set(dep, list)
    }
  }

  // ADR-0012: marker id -> トップレベル動的属性の逆引き(update_* 生成用)。
  const attrsByMarker = new Map<MarkerId, AttrBinding[]>()
  for (const b of attrBindings) {
    const list = attrsByMarker.get(b.markerId) ?? []
    list.push(b)
    attrsByMarker.set(b.markerId, list)
  }

  const appendMarkerUpdate = (lines: string[], mId: MarkerId): void => {
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
    } else if (marker.kind === 'list') {
      lines.push(...generateListUpdate(marker, `__markers__.get(${JSON.stringify(marker.id)})`))
    } else if (marker.kind === 'action') {
      lines.push(`  if (__use_${mId}__) __use_${mId}__();`)
    } else {
      lines.push(
        ...generateConditionalUpdate(
          marker,
          `__markers__.get(${JSON.stringify(marker.id)})`,
          condDispatchesUpdate(marker, false),
        ),
      )
    }
  }

  for (const [signalId, markerIds] of signalToMarkers) {
    const name = declOutputName.get(signalId)
    instanceLines.push(`function update_${name}() {`)
    for (const derivedId of signalToDerivedRecomputes.get(signalId) ?? []) {
      instanceLines.push(`  ${declOutputName.get(derivedId)} = ${derivedRecompute.get(derivedId)};`)
    }
    for (const mId of markerIds) appendMarkerUpdate(instanceLines, mId)
    instanceLines.push('}', '')
  }

  // 同じ同期スコープで複数 root signal が書き込まれ、marker 集合が重なる
  // 場合だけ compiler.ts が batch を登録する。各 derived は root の複数経路
  // から到達しても一度だけ再計算し、marker も和集合を一度だけ更新する。
  // 既存の update_<name>() は互換性のため残し、batch は内部の呼び出し先に
  // とどめる(公開 subscription/scheduler は導入しない)。
  for (const batch of updateBatches) {
    const derivedIds = new Set<DeclId>()
    for (const signalId of batch.signalIds) {
      for (const derivedId of signalToDerivedRecomputes.get(signalId) ?? []) {
        derivedIds.add(derivedId)
      }
    }
    instanceLines.push(`function ${batch.name}() {`)
    for (const derivedId of derivedIds) {
      instanceLines.push(`  ${declOutputName.get(derivedId)} = ${derivedRecompute.get(derivedId)};`)
    }
    for (const markerId of batch.markerIds) appendMarkerUpdate(instanceLines, markerId)
    instanceLines.push('}', '')
  }

  for (const collectionId of collectionKeyRendered.keys()) {
    const name = declOutputName.get(collectionId)!
    const directLists = markers.filter(
      (marker): marker is ListMarkerOutput =>
        marker.kind === 'list' && marker.collectionDeclId === collectionId,
    )
    instanceLines.push(`function update_${name}_item(__key__, __updater__) {`)
    instanceLines.push(
      `  const __next__ = __updateCollectionItem__(__collection_${name}__, __key__, __updater__);`,
    )
    const directUpdateLines: string[] = []
    for (const derivedId of signalToDerivedRecomputes.get(collectionId) ?? []) {
      directUpdateLines.push(
        `  ${declOutputName.get(derivedId)} = ${derivedRecompute.get(derivedId)};`,
      )
    }
    for (const mId of signalToMarkers.get(collectionId) ?? []) {
      const direct = directLists.find((marker) => marker.id === mId)
      if (!direct) {
        appendMarkerUpdate(directUpdateLines, mId)
        continue
      }
      const usesSharedUpdater =
        bodyUnits(direct.body).length === 0 && direct.body.localDecls.length === 0
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
    instanceLines.push('}', '')
  }

  const updateNames = [...signalToMarkers.keys()].map((id) => `update_${declOutputName.get(id)}`)
  instanceLines.push(
    `return { mount, hydrate: hydrateComponentInstance${updateNames.map((name) => `, ${name}`).join('')} };`,
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
