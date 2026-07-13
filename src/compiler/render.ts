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
  cleanJSXText,
  escapeTemplateText,
  innerTemplateSource,
  renderStaticAttrs,
  type StaticAttr,
} from '../template.js'
import {
  analyzeExpr,
  analyzeHandlerBody,
  analyzeHandlerExpr,
} from './analyze.js'
import type { CompilerState, ContentPart, DeclId, MarkerId } from './state.js'
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

  const argPath = stmt.get(
    'declarations.0.init.arguments.0',
  ) as NodePath<t.Expression>
  const naturalName = (declarator.id as t.Identifier).name
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
      sourceParts.push({ type: 'expr', code: sourceRendered })
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
): { handlerAttrs: HandlerAttr[]; staticAttrs: StaticAttr[] } {
  const handlerAttrs: HandlerAttr[] = []
  const staticAttrs: StaticAttr[] = []
  for (const attr of elementPath.get('openingElement').get('attributes')) {
    if (!attr.isJSXAttribute()) {
      // JSXSpreadAttribute({...props})は引き続き拒否する。
      throw new Error(
        'compile: host element attributes are not supported yet (scope limit)',
      )
    }
    const attrName = attr.node.name
    const valueNode = attr.node.value
    if (attrName.type !== 'JSXIdentifier' || !/^on[A-Z]/.test(attrName.name)) {
      // ハンドラ以外: 属性名が JSXIdentifier で、値が文字列リテラルまたは
      // 値なしなら静的属性。式コンテナ値・JSXNamespacedName は拒否する
      // (design.md 決定4: 式の中身は評価せず構文だけで判定する)。
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
  return { handlerAttrs, staticAttrs }
}

function renderElement(
  ctx: CompilerState,
  elementPath: NodePath<t.JSXElement>,
  instanceId: number,
  handlerFns: HandlerFns,
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
  const { handlerAttrs, staticAttrs } = collectAttrs(
    ctx,
    elementPath,
    instanceId,
    handlerFns,
  )
  const attrs = renderStaticAttrs(staticAttrs)

  const children = elementPath.get('children') as NodePath<JSXChild>[]
  const hasDirectExpr = children.some((c) => c.isJSXExpressionContainer())

  if (!hasDirectExpr) {
    let inner = ''
    for (const child of children) {
      if (child.isJSXText())
        inner += escapeTemplateText(cleanJSXText(child.node.value))
      else if (child.isJSXElement())
        inner += renderElement(ctx, child, instanceId, handlerFns)
      else throw new Error('compile: unsupported JSX child (scope limit)')
    }
    if (handlerAttrs.length === 0) {
      return `<${tagName}${attrs}>${inner}</${tagName}>`
    }
    // reactive text を持たない要素にハンドラだけが付く場合、mount() が
    // 拾えるようこの要素専用のマーカーを新規に発行する。
    const markerId = nextMarkerId(ctx)
    for (const h of handlerAttrs) {
      ctx.handlers.push({ markerId, ...h })
    }
    return `<${tagName}${attrs} data-iris-id="${markerId}">${inner}</${tagName}>`
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
  // ハンドラを相乗りさせる(新規マーカーは発行しない)。
  for (const h of handlerAttrs) {
    ctx.handlers.push({ markerId, ...h })
  }
  return `<${tagName}${attrs} data-iris-id="${markerId}">${sourceInner}</${tagName}>`
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

  return renderElement(ctx, renderJsxPath, instanceId, handlerFns)
}
