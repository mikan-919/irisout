// 最終 codegen:コンパイラが収集した結果(フラット化された宣言文、マーカー、
// signal->marker 依存グラフ)から、mountComponent() とルート signal ごとの
// update_<name>() を持つ1つの ES モジュールを組み立てる。
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

// M2: compiler.ts が writeDeclIds を(マーカーを持つ signal だけに絞って)
// updateNames へ変換した後の、codegen 向けハンドラ表現。
export interface HandlerOutput {
  markerId: MarkerId
  eventName: string
  rendered: string
  updateNames: string[]
  /** ADR-0009: 第1仮引数(イベントオブジェクト)の authored 名。なければ null。 */
  param: string | null
  /** same-file-component-composition: このユニット自身のローカルsignalへ
   * 書き込む場合、既存のupdateNames呼び出しに加えてこのユニットの
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

// ADR-0011: signalToMarkers/ctx.markerDeps 確定後に compiler.ts が組み立てる
// action1個ぶんの最終テキスト。bodyRendered/closureRendered は既に
// update_* 呼び出し込み(design D4-1/D5) -- codegen はこれを文字列として
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
  declOutputName: Map<DeclId, string>
  derivedDeps: Map<DeclId, Set<DeclId>>
  derivedRecompute: Map<DeclId, string>
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
function renderHandlerCall(h: HandlerOutput, itemParam: string | null): string {
  const updateCalls = h.updateNames.map((name) => `update_${name}();`).join(' ')
  // same-file-component-composition: このユニット自身のローカルsignalへの
  // 書き込みは、モジュールscopeのupdate_*ではなくこのfactory自身の
  // `update()`クロージャを呼ぶ(design.md D5、bare識別子 ― 同一ユニット
  // 直下限定なので関数宣言の巻き上げにより参照は曖昧にならない)。
  const localUpdateCall = h.callLocalUpdate ? `update(${itemParam ?? ''});` : ''
  // ADR-0009 D4: 第1引数があるハンドラのみ authored 名を束縛する。
  const params = h.param ? `${h.param}, ...__args` : '...__args'
  return `(${params}) => { ${h.rendered}; ${updateCalls}${localUpdateCall ? ` ${localUpdateCall}` : ''} }`
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
// keyed Map を module スコープに、テンプレートの実体生成(document 依存)は
// mountComponent/hydrateComponent 内で行う行を別に組み立てる。
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

  // M5.5: ネストしたユニットの <template> は静的な文字列なので、module
  // スコープに1つ置けば全 factory インスタンスで共有できる(keyed Map・
  // 状態変数・factory 関数は外側 factory のクロージャ内 ― generateFactory 参照)。
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
  return [
    `  __reconcileList__(__list_${marker.id}__, ${elExpr}, ${marker.arrayRendered}, (${marker.itemParam}) => ${marker.keyRendered}, __create_${marker.id}__);`,
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
  declOutputName,
  derivedDeps,
  derivedRecompute,
  handlers,
  actions,
  attrBindings,
  emittedFns,
  initialHtml,
}: GenerateModuleInput): string {
  const outLines: string[] = []
  const runtimeImports = ['mount', 'hydrate']
  if (markersHaveList(markers)) {
    runtimeImports.push(
      'createListRuntime as __createListRuntime__',
      'reconcileList as __reconcileList__',
      'updateListBinding as __updateListBinding__',
    )
  }
  outLines.push(`import { ${runtimeImports.join(', ')} } from '@irisout/runtime';`, '')
  outLines.push(...declStatements.map((s) => `export ${s}`), '')
  // cross-function-handler-writes design D4: 追跡された動きゾーン関数を authored
  // 名のままモジュールスコープへ emit する(update_*() は本体に入れない — D3)。
  // 関数宣言なので hoist され、ハンドラ/他の追跡関数からそのまま呼べる。
  for (const fn of emittedFns) {
    outLines.push(`function ${fn.name}(${fn.params}) {${fn.body}}`)
  }
  if (emittedFns.length > 0) outLines.push('')
  outLines.push(`const __INITIAL_HTML__ = ${JSON.stringify(initialHtml)};`, '')

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
  outLines.push(`const __MARKER_IDS__ = ${JSON.stringify(markerIds)};`, '')

  const { declLines, templateSetupLines, signalsNeedingInitialCall } = generateStructuralUnits(
    markers,
    signalToMarkers,
  )
  if (declLines.length > 0) outLines.push(...declLines, '')

  // 返り値クロージャを持つactionだけ、それを保持するモジュールスコープ変数を
  // 宣言する(design Decision 5: クロージャが無ければ機構自体を出力しない)。
  const actionDeclLines = actions
    .filter((a) => a.closureRendered)
    .map((a) => `let __use_${a.markerId}__;`)
  if (actionDeclLines.length > 0) outLines.push(...actionDeclLines, '')

  // ハンドラのラッパー関数:元のハンドラ本体(書き込みは代入済み)を実行した
  // 後、そのハンドラが書き込んだ signal ぶんの update_* をまとめて呼ぶ。
  for (const h of handlers) {
    outLines.push(`const __handler_${h.markerId}_${h.eventName} = ${renderHandlerCall(h, null)};`)
  }
  if (handlers.length > 0) outLines.push('')

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

  outLines.push(
    'let __markers__;',
    'export function mountComponent(container) {',
    '  ({ markers: __markers__ } = mount(container, __INITIAL_HTML__, __MARKER_IDS__));',
    ...docSetupLines,
    ...setupLines,
    ...initialUpdateCalls,
    ...actionCallLines,
    '}',
    '',
    'export function hydrateComponent(container) {',
    '  ({ markers: __markers__ } = hydrate(container, __MARKER_IDS__));',
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

  for (const [signalId, markerIds] of signalToMarkers) {
    const name = declOutputName.get(signalId)
    outLines.push(`export function update_${name}() {`)
    for (const derivedId of signalToDerivedRecomputes.get(signalId) ?? []) {
      outLines.push(`  ${declOutputName.get(derivedId)} = ${derivedRecompute.get(derivedId)};`)
    }
    for (const mId of markerIds) {
      // 動的属性の再設定(属性のみの marker id は markers に実体を持たない
      // ため、marker 解決より先に処理する)。
      const bindings = attrsByMarker.get(mId)
      if (bindings) {
        outLines.push(
          `  { const __el = __markers__.get(${JSON.stringify(mId)}); if (__el) { ${bindings.map((b) => renderAttrSet('__el', b)).join(' ')} } }`,
        )
      }
      const marker = markers.find((m) => m.id === mId)
      if (!marker) continue
      if (marker.kind === 'text') {
        outLines.push(
          `  { const __el = __markers__.get(${JSON.stringify(mId)}); if (__el) { __el.textContent = \`${innerTemplateSource(marker.contentParts)}\`; } }`,
        )
      } else if (marker.kind === 'list') {
        outLines.push(
          ...generateListUpdate(marker, `__markers__.get(${JSON.stringify(marker.id)})`),
        )
      } else if (marker.kind === 'action') {
        // design Decision 5: ガード付き呼び出し(action呼び出し前のpopulate中は
        // __use_<id>__ が未初期化のため)。
        outLines.push(`  if (__use_${mId}__) __use_${mId}__();`)
      } else {
        outLines.push(
          ...generateConditionalUpdate(
            marker,
            `__markers__.get(${JSON.stringify(marker.id)})`,
            condDispatchesUpdate(marker, false),
          ),
        )
      }
    }
    outLines.push('}', '')
  }

  return outLines.join('\n')
}
