// JSX ツリーを深さ優先で辿り、宣言・マーカーを ctx に積みながらフラットな
// HTML テンプレートソース(ビルド時実行用)を組み立てる。
//
// M1 スコープ: 単一コンポーネント(子コンポーネント参照は scope-limit error)、
// signal()/derived() 宣言、テキストマーカーのみ。属性・ハンドラ・条件分岐・
// リストは M2/M4/M5 で追加する。

import type { NodePath } from '@babel/traverse'
import type * as t from '@babel/types'
import {
  cleanJSXText,
  escapeTemplateText,
  innerTemplateSource,
} from '../template.js'
import { analyzeExpr, analyzeHandlerExpr } from './analyze.js'
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
  if (stmt.isVariableDeclaration() && stmt.node.declarations.length === 1) {
    const declarator = stmt.node.declarations[0]!
    const init = declarator.init
    if (
      init &&
      init.type === 'CallExpression' &&
      init.callee.type === 'Identifier'
    ) {
      const kind = init.callee.name
      if (kind === 'signal' || kind === 'derived') {
        const argPath = stmt.get(
          'declarations.0.init.arguments.0',
        ) as NodePath<t.Expression>
        const naturalName = (declarator.id as t.Identifier).name
        if (kind === 'signal') {
          const { rendered, sourceRendered } = analyzeExpr(
            ctx,
            argPath,
            instanceId,
          )
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
          emitDerived(
            ctx,
            instanceId,
            declarator.start!,
            naturalName,
            argPath,
            out,
          )
        }
        return
      }
    }
  }
  throw new Error(
    'compile: only top-level `signal()`/`derived()` declarations are supported in this milestone (scope limit)',
  )
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

function renderElement(
  ctx: CompilerState,
  elementPath: NodePath<t.JSXElement>,
  instanceId: number,
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
  // on[A-Z]... 属性(onClick など)だけをハンドラとして収集する。それ以外の
  // 属性(class/id 等の静的ホスト属性)はまだ未対応 -- plan 007 のスコープ。
  const handlerAttrs: {
    eventName: string
    rendered: string
    writeDeclIds: Set<DeclId>
  }[] = []
  for (const attr of elementPath.get('openingElement').get('attributes')) {
    if (!attr.isJSXAttribute()) {
      throw new Error(
        'compile: host element attributes are not supported yet (scope limit)',
      )
    }
    const attrName = attr.node.name
    if (attrName.type !== 'JSXIdentifier' || !/^on[A-Z]/.test(attrName.name)) {
      throw new Error(
        'compile: host element attributes are not supported yet (scope limit)',
      )
    }
    const valueNode = attr.node.value
    if (valueNode?.type !== 'JSXExpressionContainer') {
      throw new Error(
        `compile: handler "${attrName.name}" must be an expression (scope limit)`,
      )
    }
    const exprPath = attr.get('value.expression') as NodePath<t.Expression>
    if (!exprPath.isArrowFunctionExpression()) {
      throw new Error(
        `compile: handler "${attrName.name}" must be an arrow function (scope limit)`,
      )
    }
    if (exprPath.node.params.length > 0) {
      // M2 スコープ: ハンドラ引数(event 等)の受け渡しはまだ未対応。
      // 黙って引数を落とすとバグの温床になるので、ここで確実に落とす。
      throw new Error(
        `compile: handler "${attrName.name}" parameters are not supported yet (scope limit)`,
      )
    }
    const bodyPath = exprPath.get('body')
    if (bodyPath.isBlockStatement()) {
      throw new Error(
        `compile: handler "${attrName.name}" body must be a single expression, not a block (scope limit)`,
      )
    }
    const eventName = attrName.name.slice(2).toLowerCase()
    const { rendered, writeDeclIds } = analyzeHandlerExpr(
      ctx,
      bodyPath as NodePath<t.Expression>,
      instanceId,
    )
    handlerAttrs.push({ eventName, rendered, writeDeclIds })
  }

  const children = elementPath.get('children') as NodePath<JSXChild>[]
  const hasDirectExpr = children.some((c) => c.isJSXExpressionContainer())

  if (!hasDirectExpr) {
    let inner = ''
    for (const child of children) {
      if (child.isJSXText())
        inner += escapeTemplateText(cleanJSXText(child.node.value))
      else if (child.isJSXElement())
        inner += renderElement(ctx, child, instanceId)
      else throw new Error('compile: unsupported JSX child (scope limit)')
    }
    if (handlerAttrs.length === 0) {
      return `<${tagName}>${inner}</${tagName}>`
    }
    // reactive text を持たない要素にハンドラだけが付く場合、mount() が
    // 拾えるようこの要素専用のマーカーを新規に発行する。
    const markerId = nextMarkerId(ctx)
    for (const h of handlerAttrs) {
      ctx.handlers.push({ markerId, ...h })
    }
    return `<${tagName} data-iris-id="${markerId}">${inner}</${tagName}>`
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
  return `<${tagName} data-iris-id="${markerId}">${sourceInner}</${tagName}>`
}

export function compileComponent(
  ctx: CompilerState,
  componentPath: NodePath<t.FunctionDeclaration>,
  instanceId: number,
  out: RenderOutput,
): string {
  let returnArgPath: NodePath<t.Expression | null> | null = null
  for (const stmt of componentPath.get(
    'body.body',
  ) as NodePath<t.Statement>[]) {
    if (stmt.isReturnStatement()) {
      returnArgPath = stmt.get('argument') as NodePath<t.Expression | null>
      continue
    }
    processDeclarationStatement(ctx, stmt, instanceId, out)
  }
  if (!returnArgPath?.isJSXElement()) {
    throw new Error(
      'compile: component must return a single JSX element (scope limit)',
    )
  }
  return renderElement(ctx, returnArgPath, instanceId)
}
