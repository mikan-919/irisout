// JSX ツリーを深さ優先で辿り、宣言・マーカーを ctx に積みながらフラットな
// HTML テンプレートソース(ビルド時実行用)を組み立てる。
//
// M1 スコープ: 単一コンポーネント(子コンポーネント参照は scope-limit error)、
// signal()/derived() 宣言、テキストマーカーのみ。属性・ハンドラ・条件分岐・
// リストは M2/M4/M5 で追加する。
//
// ADR-0008: コンポーネントは「変数ゾーン(const)→ UIゾーン(render())→
// 動きゾーン(function宣言)」の3構造で書く。UI宣言は return ではなく
// render(<JSX>) マーカー、ハンドラは render 後方の function宣言への識別子参照
// (または UIゾーン内の inline arrow)で書く。配置違反は compile error。

import type { NodePath } from '@babel/traverse'
import type * as t from '@babel/types'
import {
  attrBindingKind,
  cleanJSXText,
  escapeTemplateText,
  innerTemplateSource,
  renderStaticAttrs,
  type StaticAttr,
} from '../template.js'
import {
  analyzeActionBody,
  analyzeExpr,
  analyzeHandlerBody,
  analyzeHandlerExpr,
} from './analyze.js'
import type {
  CompilerState,
  ConditionalMarker,
  ContentPart,
  DeclId,
  ListMarker,
  MarkerId,
  StructuralUnitBody,
  TextMarker,
} from './state.js'
import { assignOutputName, declKey, nextMarkerId, toDeclId } from './state.js'

export interface RenderOutput {
  declStatements: string[]
  instrumentedDeclStatements: string[]
}

type JSXChild =
  | t.JSXText
  | t.JSXExpressionContainer
  | t.JSXElement
  | t.JSXFragment
  | t.JSXSpreadChild

// 動きゾーン(render後)の function宣言テーブル。ハンドラの識別子参照を
// この表で解決する(ADR-0008)。render の1パス中だけ有効な一時状態なので
// ctx には積まず、renderElement/collectAttrs へ引数で渡す。
type HandlerFns = Map<string, NodePath<t.FunctionDeclaration>>

function emitSignal(
  ctx: CompilerState,
  instanceId: number,
  declaratorStart: number,
  naturalName: string,
  rendered: string,
  sourceRendered: string,
  out: RenderOutput,
): DeclId {
  const id = toDeclId(`decl_${instanceId}_${declaratorStart}`)
  ctx.declIdByKey.set(declKey(instanceId, declaratorStart), id)
  ctx.declKind.set(id, 'signal')
  const outputName = assignOutputName(ctx, naturalName, id)
  // 出力: プレーン変数(ADR-0006) -- signal() ラッパーは出力に現れない。
  out.declStatements.push(`let ${outputName} = ${rendered};`)
  // ビルド時実行専用: registry 検証のため本物の signal() を declId 付きで呼ぶ。
  out.instrumentedDeclStatements.push(
    `const ${outputName} = signal(${sourceRendered}, ${JSON.stringify(id)});`,
  )
  return id
}

function emitDerived(
  ctx: CompilerState,
  instanceId: number,
  declaratorStart: number,
  naturalName: string,
  argPath: NodePath<t.Expression>,
  out: RenderOutput,
): DeclId {
  if (
    !argPath.isArrowFunctionExpression() ||
    argPath.node.params.length !== 0
  ) {
    throw new Error(
      'compile: derived() must be called with a zero-arg concise arrow function `() => expr` (scope limit)',
    )
  }
  const bodyPath = argPath.get('body')
  if (bodyPath.isBlockStatement()) {
    throw new Error(
      'compile: derived() body must be a single expression, not a block (scope limit)',
    )
  }

  const id = toDeclId(`decl_${instanceId}_${declaratorStart}`)
  ctx.declIdByKey.set(declKey(instanceId, declaratorStart), id)
  ctx.declKind.set(id, 'derived')
  const outputName = assignOutputName(ctx, naturalName, id)

  const { deps, rendered, sourceRendered } = analyzeExpr(
    ctx,
    bodyPath as NodePath<t.Expression>,
    instanceId,
  )
  for (const dep of deps) {
    if (ctx.declKind.get(dep) === 'derived') {
      throw new Error(
        'compile: derived-of-derived is not supported yet (scope limit)',
      )
    }
  }
  ctx.derivedDeps.set(id, deps)
  // ADR-0006: root signal の update_* がこの式で再計算する(codegen.ts 参照)。
  ctx.derivedRecompute.set(id, rendered)

  // 出力: 初回値をその場で計算するプレーン変数。
  out.declStatements.push(`let ${outputName} = ${rendered};`)
  out.instrumentedDeclStatements.push(
    `const ${outputName} = derived(() => ${sourceRendered}, ${JSON.stringify(id)});`,
  )
  return id
}

function processDeclarationStatement(
  ctx: CompilerState,
  stmt: NodePath<t.Statement>,
  instanceId: number,
  out: RenderOutput,
): void {
  const scopeLimit = new Error(
    'compile: only top-level `signal()`/`derived()` declarations are supported in this milestone (scope limit)',
  )
  if (!stmt.isVariableDeclaration() || stmt.node.declarations.length !== 1) {
    throw scopeLimit
  }
  const declarator = stmt.node.declarations[0]!
  const init = declarator.init
  if (
    init?.type !== 'CallExpression' ||
    init.callee.type !== 'Identifier' ||
    (init.callee.name !== 'signal' && init.callee.name !== 'derived')
  ) {
    throw scopeLimit
  }

  // 分割代入宣言子(`const [a] = signal(0)` 等)は無検証キャストで素通り
  // するとビルド時実行の生 ReferenceError になる。ここで明示拒否する。
  if (declarator.id.type !== 'Identifier') {
    throw new Error(
      'compile: destructuring signal()/derived() declarations are not supported (scope limit)',
    )
  }

  const argPath = stmt.get(
    'declarations.0.init.arguments.0',
  ) as NodePath<t.Expression>
  const naturalName = declarator.id.name
  if (init.callee.name === 'signal') {
    const { rendered, sourceRendered } = analyzeExpr(ctx, argPath, instanceId)
    emitSignal(
      ctx,
      instanceId,
      declarator.start!,
      naturalName,
      rendered,
      sourceRendered,
      out,
    )
  } else {
    emitDerived(ctx, instanceId, declarator.start!, naturalName, argPath, out)
  }
}

// JSXText/式の子の連なりを、1回の textContent 置換で更新するアトミックな
// ユニットとして扱う:マーカーを登録し、ビルド時実行向けの内側テンプレート
// ソース(read call を保った sourceRendered 版)を返す。
function buildTextMarker(
  ctx: CompilerState,
  runPaths: NodePath<t.JSXText | t.JSXExpressionContainer>[],
  instanceId: number,
): { markerId: MarkerId; sourceInner: string } {
  const id = nextMarkerId(ctx)
  const outputParts: ContentPart[] = []
  const sourceParts: ContentPart[] = []
  const deps = new Set<DeclId>()
  for (const p of runPaths) {
    if (p.isJSXText()) {
      const text = cleanJSXText(p.node.value)
      outputParts.push({ type: 'text', value: text })
      sourceParts.push({ type: 'text', value: text })
    } else if (p.isJSXExpressionContainer()) {
      const exprPath = p.get('expression')
      if (exprPath.isJSXEmptyExpression()) continue
      const {
        deps: exprDeps,
        rendered,
        sourceRendered,
      } = analyzeExpr(ctx, exprPath as NodePath<t.Expression>, instanceId)
      outputParts.push({ type: 'expr', code: rendered })
      // ビルド時実行で初期 HTML に焼き込まれる式値のみ HTML エスケープする
      // (escape-initial-html design D1)。出力側(textContent 用の rendered)は
      // HTML を解釈しないのでエスケープ不要 ― ADR-0004: 出力を膨らませない。
      sourceParts.push({ type: 'expr', code: `__esc__(${sourceRendered})` })
      for (const d of exprDeps) deps.add(d)
    }
  }
  ctx.markers.push({ id, kind: 'text', contentParts: outputParts })
  ctx.markerDeps.set(id, deps)
  return { markerId: id, sourceInner: innerTemplateSource(sourceParts) }
}

interface HandlerAttr {
  eventName: string
  rendered: string
  writeDeclIds: Set<DeclId>
  param: string | null
}

interface HandlerBody {
  /** 第1仮引数(イベントオブジェクト)の authored 名。なければ null。 */
  param: string | null
  /** 単一式(inline arrow の式本体)、またはブロック本体の文配列(design D1)。 */
  body: NodePath<t.Expression> | NodePath<t.Statement>[]
}

// ADR-0009 質問1: 第1仮引数(単純な識別子)のみ受理し、authored 名を返す。
// 分割代入・第2引数以降は初回スコープ外として scope limit で拒否する。
function resolveHandlerParam(
  params: NodePath<t.Node>[],
  attrName: string,
): string | null {
  if (params.length === 0) return null
  if (params.length > 1) {
    throw new Error(
      `compile: handler "${attrName}" only supports a single parameter (scope limit)`,
    )
  }
  const first = params[0]!
  if (!first.isIdentifier()) {
    throw new Error(
      `compile: handler "${attrName}" destructured parameters are not supported yet (scope limit)`,
    )
  }
  return first.node.name
}

// ホスト要素の属性を「ハンドラ / 静的 / 拒否」の3分岐で収集する
// (design.md 決定1)。on[A-Z]... はハンドラ、文字列リテラル値・値なし属性は
// 静的属性、式コンテナ値・namespaced 名・spread は scope limit で拒否する。
// ハンドラ属性値から、配線対象の本体(単一式 or 文配列)+第1引数名を取り出す
// (ADR-0009 D1)。inline arrow(UIゾーン内は許容)と、render 後方の
// function宣言への識別子参照(ADR-0008)の2形をサポートする。
function resolveHandlerBody(
  exprPath: NodePath<t.Expression>,
  attrName: string,
  handlerFns: HandlerFns,
): HandlerBody {
  if (exprPath.isArrowFunctionExpression()) {
    const param = resolveHandlerParam(exprPath.get('params'), attrName)
    const bodyPath = exprPath.get('body')
    if (bodyPath.isBlockStatement()) {
      return { param, body: bodyPath.get('body') as NodePath<t.Statement>[] }
    }
    return { param, body: bodyPath as NodePath<t.Expression> }
  }
  if (exprPath.isIdentifier()) {
    // ADR-0008: 識別子参照の解決先は render() より後ろの function宣言に限る。
    // 変数ゾーンの arrow(const handler = ...)は handlerFns に入らないので
    // ここで弾かれる(=「UIより前の動き」の拒否)。未定義参照も同じ経路。
    const fn = handlerFns.get(exprPath.node.name)
    if (!fn) {
      throw new Error(
        `compile: handler "${attrName}" must reference a function declared after render() (scope limit)`,
      )
    }
    const param = resolveHandlerParam(fn.get('params'), attrName)
    return { param, body: fn.get('body.body') as NodePath<t.Statement>[] }
  }
  throw new Error(
    `compile: handler "${attrName}" must be an arrow function or a reference to one (scope limit)`,
  )
}

function collectAttrs(
  ctx: CompilerState,
  elementPath: NodePath<t.JSXElement>,
  instanceId: number,
  handlerFns: HandlerFns,
  skipAttrName?: string,
): {
  handlerAttrs: HandlerAttr[]
  staticAttrs: StaticAttr[]
  actionAttr: HandlerBody | null
  dynamicAttrPaths: { name: string; exprPath: NodePath<t.Expression> }[]
} {
  const handlerAttrs: HandlerAttr[] = []
  const staticAttrs: StaticAttr[] = []
  const dynamicAttrPaths: { name: string; exprPath: NodePath<t.Expression> }[] =
    []
  let actionAttr: HandlerBody | null = null
  for (const attr of elementPath.get('openingElement').get('attributes')) {
    if (!attr.isJSXAttribute()) {
      // JSXSpreadAttribute({...props})は引き続き拒否する。
      throw new Error(
        'compile: host element attributes are not supported yet (scope limit)',
      )
    }
    const attrName = attr.node.name
    // M5: リストアイテムの `key={...}` はkeyed reuseの索引専用で、host
    // 属性としては出力しない(design.md Decision 5)。
    if (
      skipAttrName &&
      attrName.type === 'JSXIdentifier' &&
      attrName.name === skipAttrName
    ) {
      continue
    }
    const valueNode = attr.node.value
    // ADR-0011: `use={fn}` は第3分類(ハンドラ/静的のどちらでもない)。
    // 識別子参照・inline arrow の配線ルールはハンドラと同一(resolveHandlerBody
    // を流用)なので、resolveHandlerBody で本体を取り出すだけでよい。
    if (attrName.type === 'JSXIdentifier' && attrName.name === 'use') {
      if (actionAttr) {
        throw new Error(
          'compile: an element can only have one `use` attribute (scope limit)',
        )
      }
      if (valueNode?.type !== 'JSXExpressionContainer') {
        throw new Error('compile: `use` must be an expression (scope limit)')
      }
      const exprPath = attr.get('value.expression') as NodePath<t.Expression>
      actionAttr = resolveHandlerBody(exprPath, 'use', handlerFns)
      continue
    }
    if (attrName.type !== 'JSXIdentifier' || !/^on[A-Z]/.test(attrName.name)) {
      // ハンドラ以外: 属性名が JSXIdentifier で、値が文字列リテラルまたは
      // 値なしなら静的属性、式コンテナなら動的属性バインディング(ADR-0012)。
      // JSXNamespacedName は引き続き拒否する。
      if (attrName.type === 'JSXIdentifier' && valueNode == null) {
        staticAttrs.push({ name: attrName.name, valueless: true })
        continue
      }
      if (
        attrName.type === 'JSXIdentifier' &&
        valueNode?.type === 'StringLiteral'
      ) {
        staticAttrs.push({ name: attrName.name, value: valueNode.value })
        continue
      }
      if (
        attrName.type === 'JSXIdentifier' &&
        valueNode?.type === 'JSXExpressionContainer' &&
        valueNode.expression.type !== 'JSXEmptyExpression'
      ) {
        dynamicAttrPaths.push({
          name: attrName.name,
          exprPath: attr.get('value.expression') as NodePath<t.Expression>,
        })
        continue
      }
      throw new Error(
        'compile: host element attributes are not supported yet (scope limit)',
      )
    }
    if (valueNode?.type !== 'JSXExpressionContainer') {
      throw new Error(
        `compile: handler "${attrName.name}" must be an expression (scope limit)`,
      )
    }
    const exprPath = attr.get('value.expression') as NodePath<t.Expression>
    const { param, body } = resolveHandlerBody(
      exprPath,
      attrName.name,
      handlerFns,
    )
    const eventName = attrName.name.slice(2).toLowerCase()
    const { rendered, writeDeclIds } = Array.isArray(body)
      ? analyzeHandlerBody(ctx, body, instanceId)
      : analyzeHandlerExpr(ctx, body, instanceId)
    handlerAttrs.push({ eventName, rendered, writeDeclIds, param })
  }
  return { handlerAttrs, staticAttrs, actionAttr, dynamicAttrPaths }
}

// design.md Decision 4/5: action本体の解析(ADR-0009の機械+ネストした関数への
// 再帰+返り値クロージャの分離)を実行し、markerId に対して ctx.actions へ登録
// する。返り値クロージャがある場合のみ、その依存を signal/derived の依存解決
// (ctx.markerDeps/ctx.markers)に相乗りさせる -- クロージャの update_* 配線は
// テキストマーカー等と同じ「マーカーの依存」機構をそのまま再利用できる
// (design Decision 5: 返り値の無いactionは配線コード自体を生成しない)。
function registerAction(
  ctx: CompilerState,
  markerId: MarkerId,
  action: HandlerBody,
  instanceId: number,
): void {
  const { finalizeBody, closure } = analyzeActionBody(
    ctx,
    action.body,
    instanceId,
  )
  if (closure) {
    ctx.markers.push({ id: markerId, kind: 'action' })
    ctx.markerDeps.set(markerId, closure.deps)
  }
  ctx.actions.push({
    markerId,
    elParam: action.param,
    finalizeBody,
    finalizeClosure: closure?.finalize ?? null,
  })
}

interface RenderElementOpts {
  /** M5: この要素直下の `key` 属性を host 属性として出力しない(リストアイテムの root)。 */
  skipAttrName?: string
  /** M5.5: いま歩いている位置を囲む構造ユニット本体の数(トップレベル=0)。
   * 深さ2(1階層ネスト)までの構造ユニットを受理し、深さ3以降は scope limit
   * で拒否する(design.md Decision 3: カウンタ1つで無制限再帰を防ぐ)。 */
  unitDepth?: number
}

function renderElement(
  ctx: CompilerState,
  elementPath: NodePath<t.JSXElement>,
  instanceId: number,
  handlerFns: HandlerFns,
  opts: RenderElementOpts = {},
): string {
  const openingName = elementPath.node.openingElement.name
  if (openingName.type !== 'JSXIdentifier') {
    throw new Error('compile: unsupported JSX tag form (scope limit)')
  }
  const tagName = openingName.name

  if (/^[A-Z]/.test(tagName)) {
    throw new Error(
      `compile: component references (<${tagName}/>) are not supported yet (scope limit)`,
    )
  }
  const { handlerAttrs, staticAttrs, actionAttr, dynamicAttrPaths } =
    collectAttrs(ctx, elementPath, instanceId, handlerFns, opts.skipAttrName)
  const elementUnitDepth = opts.unitDepth ?? 0
  // ADR-0011 design.md Decision 3: 返り値クロージャの動的レジストリが要るため、
  // リストアイテム/条件分岐ブランチの中の `use=` は対象外のまま。
  if (actionAttr && elementUnitDepth > 0) {
    throw new Error(
      'compile: use= inside list/conditional units is not supported yet (scope limit)',
    )
  }
  const attrs = renderStaticAttrs(staticAttrs)

  // ADR-0012: 動的属性バインディング。トップレベルのみビルド時実行で初期値を
  // 焼き込む(design D3 — ユニット内のテンプレートは innerHTML に生で渡る
  // ため `${...}` を属性位置に置けない。factory 側の設定行が初期値を兼ねる)。
  const dynAttrs = dynamicAttrPaths.map((d) => ({
    name: d.name,
    ...analyzeExpr(ctx, d.exprPath, instanceId),
  }))
  const dynBake =
    elementUnitDepth === 0
      ? dynAttrs
          .map((a) =>
            attrBindingKind(a.name) === 'boolProp'
              ? `\${(${a.sourceRendered}) ? " ${a.name}" : ""}`
              : ` ${a.name}="\${__escAttr__(${a.sourceRendered})}"`,
          )
          .join('')
      : ''
  // 要素のマーカー id に相乗りさせて登録する(text/handler と同じ前例)。
  // トップレベルでは deps を markerDeps へ合流させ update_<name>() の対象に
  // する。ユニット内は renderStructuralUnitBody の splice が回収し、deps は
  // scope limit 判定に使う(ADR-0012 決定5)。
  const attachAttrBindings = (markerId: MarkerId): void => {
    for (const a of dynAttrs) {
      ctx.attrBindings.push({
        markerId,
        name: a.name,
        rendered: a.rendered,
        deps: a.deps,
      })
      if (elementUnitDepth === 0) {
        const set = ctx.markerDeps.get(markerId) ?? new Set<DeclId>()
        for (const d of a.deps) set.add(d)
        ctx.markerDeps.set(markerId, set)
      }
    }
  }

  const children = elementPath.get('children') as NodePath<JSXChild>[]

  // M5: リスト(`.map()`)・条件分岐(三項/`&&`)の構造ユニット検出。
  // ADR-0005「1階層のみ」に合わせ、対象の式コンテナが親の非空白な唯一の
  // 子である場合に限って受理する(design.md: sole-child 制約)。
  const nonWhitespace = children.filter(
    (c) => !(c.isJSXText() && cleanJSXText(c.node.value) === ''),
  )
  const soleExprChild =
    nonWhitespace.length === 1 && nonWhitespace[0]!.isJSXExpressionContainer()
      ? nonWhitespace[0]
      : null
  const soleKind = soleExprChild
    ? classifyStructuralExpr(
        soleExprChild.get('expression') as NodePath<
          t.Expression | t.JSXEmptyExpression
        >,
      )
    : null

  if (soleKind) {
    // M5.5: 1階層のネスト(深さ2)までは既存のfactory生成を再帰適用する
    // (design.md Decision 3)。深さ3以降のみ scope limit で拒否する。
    const unitDepth = opts.unitDepth ?? 0
    if (unitDepth >= 2) {
      throw new Error(
        'compile: nested structural unit exceeds 1 level of nesting is not supported yet (scope limit)',
      )
    }
    const exprPath = soleExprChild!.get('expression') as NodePath<t.Expression>
    const markerId =
      soleKind === 'list'
        ? renderListUnit(
            ctx,
            exprPath as NodePath<t.CallExpression>,
            instanceId,
            handlerFns,
            unitDepth + 1,
          )
        : renderConditionalUnit(
            ctx,
            exprPath,
            instanceId,
            handlerFns,
            unitDepth + 1,
          )
    if (actionAttr) registerAction(ctx, markerId, actionAttr, instanceId)
    // ユニットホスト要素のハンドラ/動的属性はユニットのマーカー id へ相乗り
    // する(従来ハンドラは黙って捨てられていた — silent drop 修正、
    // change dynamic-attribute-bindings design D5)。
    for (const h of handlerAttrs) {
      ctx.handlers.push({ markerId, ...h })
    }
    attachAttrBindings(markerId)
    return `<${tagName}${attrs}${dynBake} data-iris-id="${markerId}"></${tagName}>`
  }

  // sole child ではない位置にリスト/条件分岐の式コンテナが混ざっている場合
  // (兄弟要素との共存): 本changeではコメントアンカー機構を持たないため
  // scope limit で拒否する(design.md: 1階層のみのシンプルな実装として、
  // 専用のラッパー要素の唯一の子にすることを要求する)。
  const hasStructuralAmongMultiple = children.some(
    (c) =>
      c.isJSXExpressionContainer() &&
      classifyStructuralExpr(
        c.get('expression') as NodePath<t.Expression | t.JSXEmptyExpression>,
      ) !== null,
  )
  if (hasStructuralAmongMultiple) {
    throw new Error(
      'compile: list/conditional rendering must be the sole child of its parent element (scope limit)',
    )
  }

  const hasDirectExpr = children.some((c) => c.isJSXExpressionContainer())

  if (!hasDirectExpr) {
    let inner = ''
    for (const child of children) {
      if (child.isJSXText())
        inner += escapeTemplateText(cleanJSXText(child.node.value))
      else if (child.isJSXElement())
        inner += renderElement(ctx, child, instanceId, handlerFns, {
          unitDepth: opts.unitDepth,
        })
      else throw new Error('compile: unsupported JSX child (scope limit)')
    }
    if (handlerAttrs.length === 0 && !actionAttr && dynAttrs.length === 0) {
      return `<${tagName}${attrs}>${inner}</${tagName}>`
    }
    // reactive text を持たない要素にハンドラ/action/動的属性だけが付く場合、
    // mount() が拾えるようこの要素専用のマーカーを新規に発行する。
    const markerId = nextMarkerId(ctx)
    for (const h of handlerAttrs) {
      ctx.handlers.push({ markerId, ...h })
    }
    if (actionAttr) registerAction(ctx, markerId, actionAttr, instanceId)
    attachAttrBindings(markerId)
    return `<${tagName}${attrs}${dynBake} data-iris-id="${markerId}">${inner}</${tagName}>`
  }

  const runPaths: NodePath<t.JSXText | t.JSXExpressionContainer>[] = []
  for (const child of children) {
    if (child.isJSXText() || child.isJSXExpressionContainer())
      runPaths.push(child)
    else
      throw new Error(
        'compile: mixing elements into a reactive text unit is not supported yet (scope limit)',
      )
  }

  const { markerId, sourceInner } = buildTextMarker(ctx, runPaths, instanceId)
  // この要素が reactive text マーカーを既に持つ場合は、そのマーカーIDへ
  // ハンドラ/actionを相乗りさせる(新規マーカーは発行しない)。
  for (const h of handlerAttrs) {
    ctx.handlers.push({ markerId, ...h })
  }
  if (actionAttr) registerAction(ctx, markerId, actionAttr, instanceId)
  attachAttrBindings(markerId)
  return `<${tagName}${attrs}${dynBake} data-iris-id="${markerId}">${sourceInner}</${tagName}>`
}

// M5(ADR-0005): 式コンテナの中身が「リスト(`.map()`)」「条件分岐(三項/`&&`)」
// のどちらかの構造ユニットの形をしているかを判定する。どちらでもなければ
// null(既存の text マーカー等、通常の子として扱われる)。
function classifyStructuralExpr(
  exprPath: NodePath<t.Expression | t.JSXEmptyExpression>,
): 'list' | 'conditional' | null {
  if (exprPath.isCallExpression()) {
    const callee = exprPath.get('callee')
    if (
      callee.isMemberExpression() &&
      !callee.node.computed &&
      callee.get('property').isIdentifier({ name: 'map' }) &&
      exprPath.node.arguments.length === 1
    ) {
      const arg = exprPath.get('arguments')[0]
      const params = arg?.isArrowFunctionExpression() ? arg.get('params') : null
      if (
        arg?.isArrowFunctionExpression() &&
        params?.length === 1 &&
        params[0]!.isIdentifier() &&
        arg.get('body').isJSXElement()
      ) {
        return 'list'
      }
    }
    return null
  }
  if (exprPath.isLogicalExpression() && exprPath.node.operator === '&&') {
    return exprPath.get('right').isJSXElement() ? 'conditional' : null
  }
  if (exprPath.isConditionalExpression()) {
    const consequent = exprPath.get('consequent')
    const alternate = exprPath.get('alternate')
    const isBranchable = (p: NodePath<t.Node>) =>
      p.isJSXElement() || p.isNullLiteral()
    if (
      isBranchable(consequent) &&
      isBranchable(alternate) &&
      (consequent.isJSXElement() || alternate.isJSXElement())
    ) {
      return 'conditional'
    }
    return null
  }
  return null
}

// リストアイテム/条件分岐ブランチの中身を renderElement で再帰的に走査し、
// その過程で ctx.markers/ctx.handlers に積まれた分だけを splice で取り出して
// ローカルスコープの StructuralUnitBody に変換する。「クロージャ境界の外に
// 出さない」という ADR-0005 決定2の実現方法: グローバルな ctx への書き込みは
// renderElement の既存ロジックをそのまま再利用しつつ、事後にこのユニット
// 専有分だけを引き剥がす。
//
// M5.5: 本体にネストした構造ユニット(list/conditional)がある場合、その
// マーカーも localMarkers へ取り込み、依存(条件式・配列式のdeps)だけを
// nestedDeps として返す。呼び出し元が外側マーカーの依存へ合流させることで、
// 依存 signal の update_* が外側ユニットの update を(そして外側の update が
// 内側の update を)駆動する。テキストマーカーの追跡 signal 参照は引き続き
// scope limit。
function renderStructuralUnitBody(
  ctx: CompilerState,
  elementPath: NodePath<t.JSXElement>,
  instanceId: number,
  handlerFns: HandlerFns,
  unitDepth: number,
  skipAttrName?: string,
): { body: StructuralUnitBody; nestedDeps: Set<DeclId> } {
  const markersBefore = ctx.markers.length
  const handlersBefore = ctx.handlers.length
  const attrsBefore = ctx.attrBindings.length
  const template = renderElement(ctx, elementPath, instanceId, handlerFns, {
    skipAttrName,
    unitDepth,
  })
  const localMarkers = ctx.markers.splice(markersBefore) as (
    | TextMarker
    | ListMarker
    | ConditionalMarker
  )[]
  const localHandlers = ctx.handlers.splice(handlersBefore)
  // ADR-0012 決定5: ユニット内の属性式が追跡 signal を参照するのはテキストと
  // 同じ scope limit(item フィールド参照のみ許す)。
  const localAttrBindings = ctx.attrBindings.splice(attrsBefore)
  for (const b of localAttrBindings) {
    if (b.deps.size > 0) {
      throw new Error(
        'compile: attribute binding referencing a tracked signal inside a list item or conditional branch is not supported yet (scope limit)',
      )
    }
  }
  const nestedDeps = new Set<DeclId>()
  for (const m of localMarkers) {
    const deps = ctx.markerDeps.get(m.id)
    ctx.markerDeps.delete(m.id)
    if (m.kind === 'text') {
      if (deps && deps.size > 0) {
        throw new Error(
          'compile: referencing a tracked signal inside a list item or conditional branch is not supported yet (scope limit)',
        )
      }
    } else {
      // ネストした構造ユニット自身の依存(さらに内側からバブル済みの分を含む)。
      for (const d of deps ?? []) nestedDeps.add(d)
    }
  }
  return {
    body: { template, localMarkers, localHandlers, localAttrBindings },
    nestedDeps,
  }
}

// `{expr.map((item) => <li key={...}>...)}` を1つの ListMarker にする。
// item 仮引数は追跡対象ではない(素の closure 変数)ので、本体の解析は
// 既存の analyzeExpr/analyzeHandlerExpr にそのまま任せてよい -- item への
// 参照は declId が引けず無編集で通過する。
function renderListUnit(
  ctx: CompilerState,
  exprPath: NodePath<t.CallExpression>,
  instanceId: number,
  handlerFns: HandlerFns,
  unitDepth: number,
): MarkerId {
  const callee = exprPath.get('callee') as NodePath<t.MemberExpression>
  const arrayObjPath = callee.get('object') as NodePath<t.Expression>
  const { deps, rendered: arrayRendered } = analyzeExpr(
    ctx,
    arrayObjPath,
    instanceId,
  )

  const arrowPath = exprPath.get(
    'arguments.0',
  ) as NodePath<t.ArrowFunctionExpression>
  const itemParam = (arrowPath.get('params.0') as NodePath<t.Identifier>).node
    .name
  const itemPath = arrowPath.get('body') as NodePath<t.JSXElement>

  const keyAttrPath = itemPath
    .get('openingElement')
    .get('attributes')
    .find(
      (a) =>
        a.isJSXAttribute() &&
        a.node.name.type === 'JSXIdentifier' &&
        a.node.name.name === 'key',
    ) as NodePath<t.JSXAttribute> | undefined
  if (!keyAttrPath) {
    throw new Error(
      'compile: list items require a `key` attribute (scope limit)',
    )
  }
  const keyValueNode = keyAttrPath.node.value
  if (keyValueNode?.type !== 'JSXExpressionContainer') {
    throw new Error(
      'compile: list item `key` must be an expression (scope limit)',
    )
  }
  const keyExprPath = keyAttrPath.get(
    'value.expression',
  ) as NodePath<t.Expression>
  const { deps: keyDeps, rendered: keyRendered } = analyzeExpr(
    ctx,
    keyExprPath,
    instanceId,
  )
  if (keyDeps.size > 0) {
    throw new Error(
      'compile: list item `key` referencing a tracked signal is not supported yet (scope limit)',
    )
  }

  const { body, nestedDeps } = renderStructuralUnitBody(
    ctx,
    itemPath,
    instanceId,
    handlerFns,
    unitDepth,
    'key',
  )
  // M5.5: ネストしたユニットの依存はこのリストマーカーの依存に合流させる。
  // 該当 signal の update_* がリストの keyed diff を再実行し、既存アイテムの
  // handle.update() 経由で内側ユニットまで更新が届く。
  for (const d of nestedDeps) deps.add(d)

  const markerId = nextMarkerId(ctx)
  ctx.markers.push({
    id: markerId,
    kind: 'list',
    itemParam,
    arrayRendered,
    keyRendered,
    body,
  })
  ctx.markerDeps.set(markerId, deps)
  return markerId
}

// `{cond && <Elem/>}` / `{cond ? <A/> : <B/>}` を1つの ConditionalMarker に
// する。`&&` は真ブランチ1つのみ(偽 = 何も描画しない)、三項は
// consequent/alternate それぞれ(`null` は「何も描画しない」ブランチ)。
function renderConditionalUnit(
  ctx: CompilerState,
  exprPath: NodePath<t.Expression>,
  instanceId: number,
  handlerFns: HandlerFns,
  unitDepth: number,
): MarkerId {
  let testPath: NodePath<t.Expression>
  let branchPaths: (NodePath<t.Node> | null)[]
  let isLogical: boolean

  if (exprPath.isLogicalExpression()) {
    testPath = exprPath.get('left') as NodePath<t.Expression>
    branchPaths = [exprPath.get('right')]
    isLogical = true
  } else if (exprPath.isConditionalExpression()) {
    testPath = exprPath.get('test') as NodePath<t.Expression>
    branchPaths = [exprPath.get('consequent'), exprPath.get('alternate')]
    isLogical = false
  } else {
    throw new Error(
      'compile: unsupported conditional expression form (scope limit)',
    )
  }

  const { deps, rendered: condRendered } = analyzeExpr(
    ctx,
    testPath,
    instanceId,
  )

  const branches = branchPaths.map((branchPath) => {
    if (!branchPath?.isJSXElement()) return { body: null }
    const { body, nestedDeps } = renderStructuralUnitBody(
      ctx,
      branchPath,
      instanceId,
      handlerFns,
      unitDepth,
    )
    // M5.5: ネストしたユニットの依存を条件分岐マーカーの依存へ合流させる
    // (選択が変わらなくても handle.update() で内側を更新するため)。
    for (const d of nestedDeps) deps.add(d)
    return { body }
  })

  const markerId = nextMarkerId(ctx)
  ctx.markers.push({
    id: markerId,
    kind: 'conditional',
    condRendered,
    isLogical,
    branches,
  })
  ctx.markerDeps.set(markerId, deps)
  return markerId
}

// 文が render(<JSX>) マーカー呼び出しなら、その JSX 引数 path を返す。
// render() 以外の呼び出し・非 ExpressionStatement は null(判定のみ)。
function renderCallJsx(
  stmt: NodePath<t.Statement>,
): NodePath<t.JSXElement> | null {
  if (!stmt.isExpressionStatement()) return null
  const expr = stmt.get('expression')
  if (!expr.isCallExpression()) return null
  const callee = expr.node.callee
  if (callee.type !== 'Identifier' || callee.name !== 'render') return null
  const args = expr.get('arguments')
  if (args.length !== 1 || !args[0]!.isJSXElement()) {
    throw new Error(
      'compile: render() takes exactly one JSX element (scope limit)',
    )
  }
  return args[0] as NodePath<t.JSXElement>
}

// ADR-0008: コンポーネント本体を「変数ゾーン → render() → 動きゾーン」の3構造で
// 走査する。UI は return ではなく render(<JSX>) マーカーで宣言する。配置違反
// (return / render 欠如・複数 / 変数ゾーンの function 宣言 / 動きゾーンの
// const 宣言)は compile error で拒否する。
export function compileComponent(
  ctx: CompilerState,
  componentPath: NodePath<t.FunctionDeclaration>,
  instanceId: number,
  out: RenderOutput,
): string {
  const stmts = componentPath.get('body.body') as NodePath<t.Statement>[]

  // UIゾーン(render() 文)の位置を特定する。ちょうど1つでなければならない。
  let renderIndex = -1
  let renderJsxPath: NodePath<t.JSXElement> | null = null
  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i]!
    if (stmt.isReturnStatement()) {
      throw new Error(
        'compile: components declare UI with render(<JSX>), not return (scope limit)',
      )
    }
    const jsx = renderCallJsx(stmt)
    if (jsx) {
      if (renderIndex !== -1) {
        throw new Error(
          'compile: a component must contain exactly one render() call (scope limit)',
        )
      }
      renderIndex = i
      renderJsxPath = jsx
    }
  }
  if (renderIndex === -1 || !renderJsxPath) {
    throw new Error(
      'compile: a component must contain a render(<JSX>) call (scope limit)',
    )
  }

  // 変数ゾーン(render前): signal()/derived() の const 宣言のみ。function宣言
  // など他の文は processDeclarationStatement の scope limit が拒否する。
  for (let i = 0; i < renderIndex; i++) {
    processDeclarationStatement(ctx, stmts[i]!, instanceId, out)
  }

  // 動きゾーン(render後): function宣言のみ。ハンドラ識別子参照の解決表に積む。
  const handlerFns: HandlerFns = new Map()
  for (let i = renderIndex + 1; i < stmts.length; i++) {
    const stmt = stmts[i]!
    if (!stmt.isFunctionDeclaration() || !stmt.node.id) {
      throw new Error(
        'compile: only function declarations are allowed after render() (scope limit)',
      )
    }
    handlerFns.set(stmt.node.id.name, stmt as NodePath<t.FunctionDeclaration>)
  }
  // cross-function-handler-writes: 呼び出し追跡(analyze.ts)が callee の
  // binding 同一性を確認できるよう、動きゾーン関数表を ctx へ載せる。
  ctx.movementFns = handlerFns

  return renderElement(ctx, renderJsxPath, instanceId, handlerFns)
}
