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

import type {
  ActionMarker,
  DeclId,
  MarkerId,
  TextMarker,
} from './compiler/state.js'
import { innerTemplateSource } from './template.js'

// M2: compiler.ts が writeDeclIds を(マーカーを持つ signal だけに絞って)
// updateNames へ変換した後の、codegen 向けハンドラ表現。
export interface HandlerOutput {
  markerId: MarkerId
  eventName: string
  rendered: string
  updateNames: string[]
  /** ADR-0009: 第1仮引数(イベントオブジェクト)の authored 名。なければ null。 */
  param: string | null
}

// M5: StructuralUnitBody(state.ts)のハンドラを HandlerDecl から
// HandlerOutput へ変換したもの。それ以外のフィールドは同じ形。
export interface StructuralUnitBodyOutput {
  template: string
  localMarkers: TextMarker[]
  localHandlers: HandlerOutput[]
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

export type MarkerOutput =
  | TextMarker
  | ListMarkerOutput
  | ConditionalMarkerOutput
  | ActionMarker

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
  initialHtml: string
}

// クローンしたテンプレート内から data-iris-id を持つ要素を探す。ルート
// 要素自身がマーカーの場合(item/branch の直接の子に marker が付く形)は
// querySelector が自分自身を対象にしないので、先に自分自身を確認する。
const FIND_HELPER = `function __find__(root, id) { return root.getAttribute("data-iris-id") === id ? root : root.querySelector(\`[data-iris-id="\${id}"]\`); }`

function renderHandlerCall(h: HandlerOutput): string {
  const updateCalls = h.updateNames.map((name) => `update_${name}();`).join(' ')
  // ADR-0009 D4: 第1引数があるハンドラのみ authored 名を束縛する。
  const params = h.param ? `${h.param}, ...__args` : '...__args'
  return `(${params}) => { ${h.rendered}; ${updateCalls} }`
}

// factory 関数本体:テンプレートのクローン取得・ローカル marker の解決・
// ハンドラ登録・(item がある場合のみ)update() クロージャをまとめて1関数に
// する(ADR-0005 決定2)。item がない(条件分岐ブランチ)場合、ローカル
// marker の内容は一度だけ設定する ― 分岐内で追跡 signal を参照することは
// render.ts 側の scope limit で既に禁止しているので、以後の再計算は要らない。
function generateFactory(
  factoryName: string,
  templateVar: string,
  itemParam: string | null,
  body: StructuralUnitBodyOutput,
): string[] {
  const lines: string[] = []
  lines.push(`function ${factoryName}(${itemParam ?? ''}) {`)
  lines.push(`  const __node__ = ${templateVar}.content.cloneNode(true);`)
  lines.push('  const __el__ = __node__.firstElementChild;')
  for (const m of body.localMarkers) {
    lines.push(
      `  const __${m.id}__ = __find__(__el__, ${JSON.stringify(m.id)});`,
    )
  }
  for (const h of body.localHandlers) {
    lines.push(
      `  __find__(__el__, ${JSON.stringify(h.markerId)}).addEventListener(${JSON.stringify(h.eventName)}, ${renderHandlerCall(h)});`,
    )
  }
  if (itemParam) {
    lines.push('  function update(__next__) {')
    lines.push(`    ${itemParam} = __next__;`)
    for (const m of body.localMarkers) {
      lines.push(
        `    __${m.id}__.textContent = \`${innerTemplateSource(m.contentParts)}\`;`,
      )
    }
    lines.push('  }')
    lines.push(`  update(${itemParam});`)
    lines.push('  return { el: __el__, update };')
  } else {
    for (const m of body.localMarkers) {
      lines.push(
        `  __${m.id}__.textContent = \`${innerTemplateSource(m.contentParts)}\`;`,
      )
    }
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
    if (m.kind === 'list' || m.kind === 'conditional')
      structuralMarkerIds.add(m.id)
  }

  const declLines: string[] = []
  const templateSetupLines: string[] = []

  if (structuralMarkerIds.size > 0) {
    declLines.push('let __doc__;', FIND_HELPER, '')
  }

  for (const marker of markers) {
    if (marker.kind === 'list') {
      const tplVar = `__tpl_${marker.id}__`
      const factoryName = `__create_${marker.id}__`
      declLines.push(
        `let ${tplVar};`,
        `const __list_${marker.id}__ = new Map();`,
      )
      declLines.push(
        ...generateFactory(factoryName, tplVar, marker.itemParam, marker.body),
        '',
      )
      templateSetupLines.push(
        `  ${tplVar} = __doc__.createElement('template'); ${tplVar}.innerHTML = ${JSON.stringify(marker.body.template)};`,
      )
    } else if (marker.kind === 'conditional') {
      declLines.push(
        `let __cond_${marker.id}__ = -1;`,
        `let __cond_${marker.id}_handle__ = null;`,
      )
      marker.branches.forEach((branch, i) => {
        if (!branch.body) return
        const tplVar = `__tpl_${marker.id}_b${i}__`
        const factoryName = `__create_${marker.id}_b${i}__`
        declLines.push(`let ${tplVar};`)
        declLines.push(
          ...generateFactory(factoryName, tplVar, null, branch.body),
          '',
        )
        templateSetupLines.push(
          `  ${tplVar} = __doc__.createElement('template'); ${tplVar}.innerHTML = ${JSON.stringify(branch.body.template)};`,
        )
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

// update_<list>() 本体:keyed reuse(ADR-0005 決定3)。既存 key は
// handle.update() で値だけ差し替え、新規 key は factory を新規呼び出しする。
// 配列(.map() の対象そのもの)から消えた key のみ Map から破棄し remove()
// する(spec.md「配列脱落とフィルタ除外の区別」)。
function generateListUpdate(marker: ListMarkerOutput): string[] {
  const listVar = `__list_${marker.id}__`
  const factoryName = `__create_${marker.id}__`
  return [
    '  {',
    `    const __arr__ = ${marker.arrayRendered};`,
    `    const __listEl__ = __markers__.get(${JSON.stringify(marker.id)});`,
    '    const __seen__ = new Set();',
    `    for (const ${marker.itemParam} of __arr__) {`,
    `      const __key__ = ${marker.keyRendered};`,
    '      __seen__.add(__key__);',
    `      let __handle__ = ${listVar}.get(__key__);`,
    '      if (!__handle__) {',
    `        __handle__ = ${factoryName}(${marker.itemParam});`,
    `        ${listVar}.set(__key__, __handle__);`,
    '      } else {',
    `        __handle__.update(${marker.itemParam});`,
    '      }',
    '      if (__listEl__) __listEl__.appendChild(__handle__.el);',
    '    }',
    `    for (const [__key__, __handle__] of ${listVar}) {`,
    `      if (!__seen__.has(__key__)) { __handle__.el.remove(); ${listVar}.delete(__key__); }`,
    '    }',
    '  }',
  ]
}

// update_<conditional>() 本体:条件式を再評価し、選択ブランチが変わった
// ときだけ古い要素を remove() して新しい要素を factory から作る(選択が
// 変わらない限り DOM もローカル状態もそのまま維持する ― ADR-0005 決定4、
// teardown 不要)。
function generateConditionalUpdate(marker: ConditionalMarkerOutput): string[] {
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
  return [
    '  {',
    `    const __target__ = ${targetExpr};`,
    `    if (__target__ !== ${stateVar}) {`,
    `      if (${handleVar}) { ${handleVar}.el.remove(); ${handleVar} = null; }`,
    `      ${stateVar} = __target__;`,
    ...branchCreateLines,
    `      if (${handleVar}) { const __el__ = __markers__.get(${JSON.stringify(marker.id)}); if (__el__) __el__.appendChild(${handleVar}.el); }`,
    '    }',
    '  }',
  ]
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
  initialHtml,
}: GenerateModuleInput): string {
  const outLines: string[] = []
  outLines.push("import { mount, hydrate } from '../src/runtime.js';", '')
  outLines.push(...declStatements.map((s) => `export ${s}`), '')
  outLines.push(`const __INITIAL_HTML__ = ${JSON.stringify(initialHtml)};`, '')

  const { declLines, templateSetupLines, signalsNeedingInitialCall } =
    generateStructuralUnits(markers, signalToMarkers)
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
    outLines.push(
      `const __handler_${h.markerId}_${h.eventName} = ${renderHandlerCall(h)};`,
    )
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
    '  ({ markers: __markers__ } = mount(container, __INITIAL_HTML__));',
    ...docSetupLines,
    ...setupLines,
    ...initialUpdateCalls,
    ...actionCallLines,
    '}',
    '',
    'export function hydrateComponent(container) {',
    '  ({ markers: __markers__ } = hydrate(container));',
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

  for (const [signalId, markerIds] of signalToMarkers) {
    const name = declOutputName.get(signalId)
    outLines.push(`export function update_${name}() {`)
    for (const derivedId of signalToDerivedRecomputes.get(signalId) ?? []) {
      outLines.push(
        `  ${declOutputName.get(derivedId)} = ${derivedRecompute.get(derivedId)};`,
      )
    }
    for (const mId of markerIds) {
      const marker = markers.find((m) => m.id === mId)
      if (!marker) continue
      if (marker.kind === 'text') {
        outLines.push(
          `  { const __el = __markers__.get(${JSON.stringify(mId)}); if (__el) { __el.textContent = \`${innerTemplateSource(marker.contentParts)}\`; } }`,
        )
      } else if (marker.kind === 'list') {
        outLines.push(...generateListUpdate(marker))
      } else if (marker.kind === 'action') {
        // design Decision 5: ガード付き呼び出し(action呼び出し前のpopulate中は
        // __use_<id>__ が未初期化のため)。
        outLines.push(`  if (__use_${mId}__) __use_${mId}__();`)
      } else {
        outLines.push(...generateConditionalUpdate(marker))
      }
    }
    outLines.push('}', '')
  }

  return outLines.join('\n')
}
