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
} from '../template.ts'
import {
  analyzeActionBody,
  analyzeExpr,
  analyzeHandlerBody,
  analyzeHandlerExpr,
  analyzeEffectBody,
  analyzeMountBody,
} from './analyze.ts'
import type {
  CompilerState,
  ConditionalMarker,
  ContentPart,
  DeclId,
  ActionDecl,
  EffectDecl,
  ListMarker,
  LocalDecl,
  MarkerId,
  MountDecl,
  StructuralUnitBody,
  TextMarker,
} from './state.ts'
import { assignOutputName, declKey, nextMarkerId, toDeclId } from './state.ts'

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
export type HandlerFns = Map<string, NodePath<t.FunctionDeclaration>>

// `onMount`はルートcomponentの動きゾーンに置くcallbackだけを受理する。
// 構造unitへインライン化されるcomponentではinline-components.tsが明示的に
// 拒否するため、ここでNodePathを保持して後段で1回だけ解析する。
export type MountHooks = NodePath<t.ArrowFunctionExpression>[]
export type EffectHooks = NodePath<t.ArrowFunctionExpression>[]

function emitSignal(
  ctx: CompilerState,
  instanceId: number,
  declaratorStart: number,
  naturalName: string,
  rendered: string,
  sourceRendered: string,
  out: RenderOutput,
): DeclId {
  const id = toDeclId(`decl_${instanceId}_${declaratorStart}_${naturalName}`)
  ctx.declIdByKey.set(declKey(instanceId, declaratorStart, naturalName), id)
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

function emitCollection(
  ctx: CompilerState,
  instanceId: number,
  declaratorStart: number,
  naturalName: string,
  rendered: string,
  sourceRendered: string,
  keyRendered: string,
  keySourceRendered: string,
  out: RenderOutput,
): DeclId {
  const id = toDeclId(`decl_${instanceId}_${declaratorStart}_${naturalName}`)
  ctx.declIdByKey.set(declKey(instanceId, declaratorStart, naturalName), id)
  ctx.declKind.set(id, 'collection')
  const outputName = assignOutputName(ctx, naturalName, id)
  ctx.collectionKeyRendered.set(id, keyRendered)
  out.declStatements.push(
    `const __collection_${outputName}__ = __createCollectionState__(${rendered}, ${keyRendered});`,
    `let ${outputName} = __collection_${outputName}__.values;`,
  )
  out.instrumentedDeclStatements.push(
    `const ${outputName} = collection(${sourceRendered}, ${keySourceRendered}, ${JSON.stringify(id)});`,
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
  if (!argPath.isArrowFunctionExpression() || argPath.node.params.length !== 0) {
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

  const id = toDeclId(`decl_${instanceId}_${declaratorStart}_${naturalName}`)
  ctx.declIdByKey.set(declKey(instanceId, declaratorStart, naturalName), id)
  ctx.declKind.set(id, 'derived')
  const outputName = assignOutputName(ctx, naturalName, id)

  const { deps, rendered, sourceRendered } = analyzeExpr(
    ctx,
    bodyPath as NodePath<t.Expression>,
    instanceId,
  )
  for (const dep of deps) {
    if (ctx.declKind.get(dep) === 'derived') {
      throw new Error('compile: derived-of-derived is not supported yet (scope limit)')
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

interface ParsedSignalDecl {
  kind: 'signal' | 'derived' | 'collection'
  naturalName: string
  declaratorStart: number
  argPath: NodePath<t.Expression>
  keyPath: NodePath<t.Expression> | null
}

// `const x = signal(...)` / `const x = derived(...)` の形を検証し、
// emitSignal/emitDerived(ルート・ローカル共通)が要る材料を取り出す純関数。
// ctx を触らない ― root/local どちらの宣言ゾーンからも共有する
// (same-file-component-composition: 構造ユニットのローカル宣言も同じ形)。
function parseSignalDeclStatement(stmt: NodePath<t.Statement>): ParsedSignalDecl {
  const scopeLimit = new Error(
    'compile: only top-level `signal()`/`derived()`/`collection()` declarations are supported in this milestone (scope limit)',
  )
  if (!stmt.isVariableDeclaration() || stmt.node.declarations.length !== 1) {
    throw scopeLimit
  }
  const declarator = stmt.node.declarations[0]!
  const init = declarator.init
  if (
    init?.type !== 'CallExpression' ||
    init.callee.type !== 'Identifier' ||
    (init.callee.name !== 'signal' &&
      init.callee.name !== 'derived' &&
      init.callee.name !== 'collection')
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

  const args = stmt.get('declarations.0.init.arguments') as NodePath<t.Expression>[]
  if (init.callee.name === 'collection' && args.length !== 2) {
    throw new Error('compile: collection() takes exactly an initial array and a key selector')
  }
  if (init.callee.name !== 'collection' && args.length !== 1) {
    throw new Error(`compile: ${init.callee.name}() takes exactly one argument`)
  }
  return {
    kind: init.callee.name as 'signal' | 'derived' | 'collection',
    naturalName: declarator.id.name,
    declaratorStart: declarator.start!,
    argPath: args[0]!,
    keyPath: args[1] ?? null,
  }
}

function processDeclarationStatement(
  ctx: CompilerState,
  stmt: NodePath<t.Statement>,
  instanceId: number,
  out: RenderOutput,
): void {
  const { kind, naturalName, declaratorStart, argPath, keyPath } = parseSignalDeclStatement(stmt)
  if (kind === 'signal') {
    const { rendered, sourceRendered } = analyzeExpr(ctx, argPath, instanceId)
    emitSignal(ctx, instanceId, declaratorStart, naturalName, rendered, sourceRendered, out)
  } else if (kind === 'collection') {
    if (
      !keyPath?.isArrowFunctionExpression() ||
      keyPath.node.params.length !== 1 ||
      keyPath.node.params[0]?.type !== 'Identifier' ||
      keyPath.get('body').isBlockStatement()
    ) {
      throw new Error(
        'compile: collection() key selector must be a one-argument concise arrow function `(item) => key` (scope limit)',
      )
    }
    const initial = analyzeExpr(ctx, argPath, instanceId)
    const key = analyzeExpr(ctx, keyPath as NodePath<t.Expression>, instanceId)
    emitCollection(
      ctx,
      instanceId,
      declaratorStart,
      naturalName,
      initial.rendered,
      initial.sourceRendered,
      key.rendered,
      key.sourceRendered,
      out,
    )
  } else {
    emitDerived(ctx, instanceId, declaratorStart, naturalName, argPath, out)
  }
}

// same-file-component-composition: 構造ユニット(list item/conditional
// branch)へインライン化されたコンポーネントの変数ゾーン宣言(CONTEXT.md
// 「ローカルsignal」)。ルートの emitSignal/emitDerived と違い、
// out.declStatements/instrumentedDeclStatements へは一切書かない ―
// 構造ユニットの中身は初期HTMLに焼き込まれない(空のコンテナのまま mount
// 時に populate される、design.md D5)ため、ビルド時実行の対象にもならない。
// generateFactory(codegen.ts)がこの戻り値を factory 内の `let` として出す。
function emitLocalSignal(
  ctx: CompilerState,
  instanceId: number,
  declaratorStart: number,
  naturalName: string,
  rendered: string,
): LocalDecl {
  const id = toDeclId(`decl_${instanceId}_${declaratorStart}_${naturalName}`)
  ctx.declIdByKey.set(declKey(instanceId, declaratorStart, naturalName), id)
  ctx.declKind.set(id, 'signal')
  ctx.localDeclIds.add(id)
  const outputName = assignOutputName(ctx, naturalName, id)
  return { id, kind: 'signal', outputName, rendered }
}

function emitLocalDerived(
  ctx: CompilerState,
  instanceId: number,
  declaratorStart: number,
  naturalName: string,
  argPath: NodePath<t.Expression>,
): LocalDecl {
  if (!argPath.isArrowFunctionExpression() || argPath.node.params.length !== 0) {
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

  const id = toDeclId(`decl_${instanceId}_${declaratorStart}_${naturalName}`)
  ctx.declIdByKey.set(declKey(instanceId, declaratorStart, naturalName), id)
  ctx.declKind.set(id, 'derived')
  ctx.localDeclIds.add(id)
  const outputName = assignOutputName(ctx, naturalName, id)

  const { deps, rendered } = analyzeExpr(ctx, bodyPath as NodePath<t.Expression>, instanceId)
  for (const dep of deps) {
    if (ctx.declKind.get(dep) === 'derived') {
      throw new Error('compile: derived-of-derived is not supported yet (scope limit)')
    }
  }
  ctx.derivedDeps.set(id, deps)
  ctx.derivedRecompute.set(id, rendered)
  return { id, kind: 'derived', outputName, rendered }
}

export function processLocalDeclarationStatement(
  ctx: CompilerState,
  stmt: NodePath<t.Statement>,
  instanceId: number,
): LocalDecl {
  const { kind, naturalName, declaratorStart, argPath } = parseSignalDeclStatement(stmt)
  if (kind === 'signal') {
    const { rendered } = analyzeExpr(ctx, argPath, instanceId)
    return emitLocalSignal(ctx, instanceId, declaratorStart, naturalName, rendered)
  }
  if (kind === 'collection') {
    throw new Error(
      'compile: collection() is only supported in the root variable zone (scope limit)',
    )
  }
  return emitLocalDerived(ctx, instanceId, declaratorStart, naturalName, argPath)
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
  directCollectionWriteDeclIds: Set<DeclId>
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
function resolveHandlerParam(params: NodePath<t.Node>[], attrName: string): string | null {
  if (params.length === 0) return null
  if (params.length > 1) {
    throw new Error(`compile: handler "${attrName}" only supports a single parameter (scope limit)`)
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
  const dynamicAttrPaths: { name: string; exprPath: NodePath<t.Expression> }[] = []
  let actionAttr: HandlerBody | null = null
  for (const attr of elementPath.get('openingElement').get('attributes')) {
    if (!attr.isJSXAttribute()) {
      // JSXSpreadAttribute({...props})は引き続き拒否する。
      throw new Error('compile: host element attributes are not supported yet (scope limit)')
    }
    const attrName = attr.node.name
    // M5: リストアイテムの `key={...}` はkeyed reuseの索引専用で、host
    // 属性としては出力しない(design.md Decision 5)。
    if (skipAttrName && attrName.type === 'JSXIdentifier' && attrName.name === skipAttrName) {
      continue
    }
    const valueNode = attr.node.value
    // ADR-0011: `use={fn}` は第3分類(ハンドラ/静的のどちらでもない)。
    // 識別子参照・inline arrow の配線ルールはハンドラと同一(resolveHandlerBody
    // を流用)なので、resolveHandlerBody で本体を取り出すだけでよい。
    if (attrName.type === 'JSXIdentifier' && attrName.name === 'use') {
      if (actionAttr) {
        throw new Error('compile: an element can only have one `use` attribute (scope limit)')
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
      if (attrName.type === 'JSXIdentifier' && valueNode?.type === 'StringLiteral') {
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
      throw new Error('compile: host element attributes are not supported yet (scope limit)')
    }
    if (valueNode?.type !== 'JSXExpressionContainer') {
      throw new Error(`compile: handler "${attrName.name}" must be an expression (scope limit)`)
    }
    const exprPath = attr.get('value.expression') as NodePath<t.Expression>
    const { param, body } = resolveHandlerBody(exprPath, attrName.name, handlerFns)
    const eventName = attrName.name.slice(2).toLowerCase()
    const { rendered, writeDeclIds, directCollectionWriteDeclIds } = Array.isArray(body)
      ? analyzeHandlerBody(ctx, body, instanceId)
      : analyzeHandlerExpr(ctx, body, instanceId)
    handlerAttrs.push({ eventName, rendered, writeDeclIds, directCollectionWriteDeclIds, param })
  }
  return { handlerAttrs, staticAttrs, actionAttr, dynamicAttrPaths }
}

// design.md Decision 4/5: action本体の解析(ADR-0009の機械+ネストした関数への
// 再帰+返り値(update/destroy object を含む)の分離)を実行し、markerId に対して
// ctx.actions へ登録する。update の依存がある場合のみ、その依存を
// signal/derived の依存解決(ctx.markerDeps/ctx.markers)に相乗りさせる。
// destroy-only action は unmount の逆順 teardown だけを持ち、update 配線を
// 生成しない。
function registerAction(
  ctx: CompilerState,
  markerId: MarkerId,
  action: HandlerBody,
  instanceId: number,
  local = false,
): void {
  const { finalizeBody, result, writeDeclIds, directCollectionWriteDeclIds } = analyzeActionBody(
    ctx,
    action.body,
    instanceId,
  )
  if (!local) {
    // void actionも対象要素をmarker registryから取得する必要がある。
    // 返り値の有無をmarkerの有無と混同しない(ADR-0011)。
    ctx.markers.push({ id: markerId, kind: 'action' })
    const deps = ctx.markerDeps.get(markerId) ?? new Set<DeclId>()
    for (const dep of result?.deps ?? []) deps.add(dep)
    ctx.markerDeps.set(markerId, deps)
  }
  ctx.actions.push({
    markerId,
    elParam: action.param,
    finalizeBody,
    finalizeResult: result?.finalize ?? null,
    resultDeps: result?.deps ?? new Set<DeclId>(),
    writeDeclIds,
    directCollectionWriteDeclIds,
  })
}

interface RenderElementOpts {
  /** M5: この要素直下の `key` 属性を host 属性として出力しない(リストアイテムの root)。 */
  skipAttrName?: string
  /** 構造ユニットのテンプレート内を歩いているか。 */
  insideUnit?: boolean
  /** この位置から参照できる構造ユニットの局所宣言。 */
  localDeclIds?: Set<DeclId>
  /** 構造unit factoryが所有する`onMount` callbackの収集先。 */
  localMountHooks?: MountHooks
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
  const { handlerAttrs, staticAttrs, actionAttr, dynamicAttrPaths } = collectAttrs(
    ctx,
    elementPath,
    instanceId,
    handlerFns,
    opts.skipAttrName,
  )
  const insideUnit = opts.insideUnit ?? false
  const attrs = renderStaticAttrs(staticAttrs)

  // ADR-0012: 動的属性バインディング。トップレベルのみビルド時実行で初期値を
  // 焼き込む(design D3 — ユニット内のテンプレートは innerHTML に生で渡る
  // ため `${...}` を属性位置に置けない。factory 側の設定行が初期値を兼ねる)。
  const dynAttrs = dynamicAttrPaths.map((d) => ({
    name: d.name,
    ...analyzeExpr(ctx, d.exprPath, instanceId),
  }))
  const dynBake = !insideUnit
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
      if (!insideUnit) {
        const set = ctx.markerDeps.get(markerId) ?? new Set<DeclId>()
        for (const d of a.deps) set.add(d)
        ctx.markerDeps.set(markerId, set)
      }
    }
  }

  const children = elementPath.get('children') as NodePath<JSXChild>[]

  // M5: リスト(`.map()`)・条件分岐(三項/`&&`)の構造ユニット検出。
  // 構造ユニットは親要素そのものを更新対象にせず、親の子ノード列に開始・
  // 終了コメントアンカーを置いて自身のDOM範囲だけを所有する。これにより
  // 静的な兄弟要素や複数の構造ユニットを同じ親へ配置できる。
  const structuralChildren = children.filter(
    (c) =>
      c.isJSXExpressionContainer() &&
      classifyStructuralExpr(
        c.get('expression') as NodePath<t.Expression | t.JSXEmptyExpression>,
      ) !== null,
  )

  if (structuralChildren.length > 0) {
    let inner = ''
    for (const child of children) {
      if (child.isJSXText()) {
        inner += escapeTemplateText(cleanJSXText(child.node.value))
        continue
      }
      if (child.isJSXElement()) {
        inner += renderElement(ctx, child, instanceId, handlerFns, {
          insideUnit,
          localDeclIds: opts.localDeclIds,
          localMountHooks: opts.localMountHooks,
        })
        continue
      }
      if (!child.isJSXExpressionContainer()) {
        throw new Error('compile: unsupported JSX child (scope limit)')
      }
      const exprPath = child.get('expression') as NodePath<t.Expression | t.JSXEmptyExpression>
      if (exprPath.isJSXEmptyExpression()) continue
      const mountHook = resolveOnMountExpression(exprPath as NodePath<t.Expression>)
      if (mountHook) {
        if (!opts.localMountHooks) {
          throw new Error(
            'compile: onMount() in JSX must be inside a structural unit (scope limit)',
          )
        }
        opts.localMountHooks.push(mountHook)
        continue
      }
      const kind = classifyStructuralExpr(exprPath)
      if (!kind) {
        throw new Error(
          'compile: mixing structural rendering with a reactive text expression is not supported yet (scope limit)',
        )
      }
      const markerId =
        kind === 'list'
          ? renderListUnit(
              ctx,
              exprPath as NodePath<t.CallExpression>,
              instanceId,
              handlerFns,
              opts.localDeclIds,
            )
          : renderConditionalUnit(ctx, exprPath, instanceId, handlerFns, opts.localDeclIds)
      // Structural units are represented by comments in the initial HTML. The
      // runtime discovers the matching pair during mount and hydrate and all
      // subsequent operations are confined to the nodes between these comments.
      inner += `<!--irisout:start:${markerId}--><!--irisout:end:${markerId}-->`
    }

    if (handlerAttrs.length === 0 && !actionAttr && dynAttrs.length === 0) {
      return `<${tagName}${attrs}${dynBake}>${inner}</${tagName}>`
    }
    // 構造ユニットと同じ親要素にハンドラ/action/動的属性がある場合は、
    // 構造ユニットとは別にホスト要素自身のマーカーを発行する。これで
    // 構造範囲のアンカーIDと要素マーカーIDを混同しない。
    const markerId = nextMarkerId(ctx)
    for (const h of handlerAttrs) {
      ctx.handlers.push({ markerId, ...h })
    }
    if (actionAttr) registerAction(ctx, markerId, actionAttr, instanceId, insideUnit)
    attachAttrBindings(markerId)
    return `<${tagName}${attrs}${dynBake} data-iris-id="${markerId}">${inner}</${tagName}>`
  }

  const hasDirectExpr = children.some((c) => {
    if (!c.isJSXExpressionContainer() || c.get('expression').isJSXEmptyExpression()) return false
    return !resolveOnMountExpression(c.get('expression') as NodePath<t.Expression>)
  })

  if (!hasDirectExpr) {
    let inner = ''
    for (const child of children) {
      if (child.isJSXText()) inner += escapeTemplateText(cleanJSXText(child.node.value))
      else if (child.isJSXElement())
        inner += renderElement(ctx, child, instanceId, handlerFns, {
          insideUnit,
          localDeclIds: opts.localDeclIds,
          localMountHooks: opts.localMountHooks,
        })
      else if (child.isJSXExpressionContainer() && child.get('expression').isJSXEmptyExpression())
        continue
      else if (child.isJSXExpressionContainer()) {
        const mountHook = resolveOnMountExpression(
          child.get('expression') as NodePath<t.Expression>,
        )
        if (mountHook) {
          if (!opts.localMountHooks) {
            throw new Error(
              'compile: onMount() in JSX must be inside a structural unit (scope limit)',
            )
          }
          opts.localMountHooks.push(mountHook)
          continue
        }
        throw new Error('compile: unsupported JSX child (scope limit)')
      } else throw new Error('compile: unsupported JSX child (scope limit)')
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
    if (actionAttr) registerAction(ctx, markerId, actionAttr, instanceId, insideUnit)
    attachAttrBindings(markerId)
    return `<${tagName}${attrs}${dynBake} data-iris-id="${markerId}">${inner}</${tagName}>`
  }

  const runPaths: NodePath<t.JSXText | t.JSXExpressionContainer>[] = []
  for (const child of children) {
    if (child.isJSXText()) runPaths.push(child)
    else if (child.isJSXExpressionContainer()) {
      const mountHook = resolveOnMountExpression(child.get('expression') as NodePath<t.Expression>)
      if (mountHook) {
        if (!opts.localMountHooks) {
          throw new Error(
            'compile: onMount() in JSX must be inside a structural unit (scope limit)',
          )
        }
        opts.localMountHooks.push(mountHook)
        continue
      }
      runPaths.push(child)
    } else
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
  if (actionAttr) registerAction(ctx, markerId, actionAttr, instanceId, insideUnit)
  attachAttrBindings(markerId)
  return `<${tagName}${attrs}${dynBake} data-iris-id="${markerId}">${sourceInner}</${tagName}>`
}

// same-file-component-composition: list item の arrow 本体が bare JSX
// (concise body)か、ローカルsignal宣言+最終return JSXのブロック本体かを
// 緩く判定する(軽量なゲートのみ ― 「returnの前がsignal/derived宣言だけか」
// の厳密な検証は resolveUnitBodySource が実際にlistとして処理する際に行う)。
function looksLikeUnitBodyJsx(bodyPath: NodePath<t.Node>): boolean {
  if (bodyPath.isJSXElement()) return true
  if (!bodyPath.isBlockStatement()) return false
  const stmts = bodyPath.get('body') as NodePath<t.Statement>[]
  const last = stmts[stmts.length - 1]
  return (
    (last?.isReturnStatement() &&
      (last.get('argument') as NodePath<t.Node | null>).isJSXElement()) ??
    false
  )
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
        looksLikeUnitBodyJsx(arg.get('body'))
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
    const isBranchable = (p: NodePath<t.Node>) => p.isJSXElement() || p.isNullLiteral()
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
// same-file-component-composition: list item のarrow本体は、従来の
// bare JSX(concise body)に加えて、ローカルsignal/derived宣言+最終return
// のブロック本体も受理する(インライン化パスがコンポーネントの変数ゾーンを
// ここへ展開するために使う形、design.md D5)。ブロック内で許すのは
// signal()/derived()宣言と最終returnのみ。
function resolveUnitBodySource(bodyPath: NodePath<t.BlockStatement | t.Expression>): {
  jsxPath: NodePath<t.JSXElement>
  localDeclStmts: NodePath<t.VariableDeclaration>[]
  localMovementFns: HandlerFns
  localMountHooks: MountHooks
} {
  if (bodyPath.isJSXElement()) {
    return {
      jsxPath: bodyPath,
      localDeclStmts: [],
      localMovementFns: new Map(),
      localMountHooks: [],
    }
  }
  if (!bodyPath.isBlockStatement()) {
    throw new Error(
      'compile: list item body must be a JSX element or a block of local signal/derived declarations ending in return (scope limit)',
    )
  }
  const stmts = bodyPath.get('body') as NodePath<t.Statement>[]
  const last = stmts[stmts.length - 1]
  if (!last?.isReturnStatement()) {
    throw new Error('compile: list item block body must end with a return statement (scope limit)')
  }
  const returnArg = last.get('argument') as NodePath<t.Expression | null>
  if (!returnArg.isJSXElement()) {
    throw new Error('compile: list item block body must return a JSX element (scope limit)')
  }
  const localDeclStmts: NodePath<t.VariableDeclaration>[] = []
  const localMovementFns: HandlerFns = new Map()
  const localMountHooks: MountHooks = []
  for (const s of stmts.slice(0, -1)) {
    const mountHook = resolveOnMountHook(s)
    if (mountHook) {
      localMountHooks.push(mountHook)
      continue
    }
    if (s.isFunctionDeclaration() && s.node.id) {
      if (localMovementFns.has(s.node.id.name)) {
        throw new Error(
          `compile: duplicate movement-zone function "${s.node.id.name}" in a list item body (scope limit)`,
        )
      }
      localMovementFns.set(s.node.id.name, s as NodePath<t.FunctionDeclaration>)
      continue
    }
    if (!s.isVariableDeclaration()) {
      throw new Error(
        'compile: only signal()/derived() declarations, onMount() calls, and function declarations are allowed before the return in a list item block body (scope limit)',
      )
    }
    localDeclStmts.push(s)
  }
  return {
    jsxPath: returnArg,
    localDeclStmts,
    localMovementFns,
    localMountHooks,
  }
}

function renderStructuralUnitBody(
  ctx: CompilerState,
  elementPath: NodePath<t.JSXElement>,
  instanceId: number,
  handlerFns: HandlerFns,
  skipAttrName?: string,
  localDeclStmts: NodePath<t.VariableDeclaration>[] = [],
  ancestorLocalDeclIds: Set<DeclId> = new Set(),
  localMovementFns: HandlerFns = new Map(),
  localMountHooks: MountHooks = [],
): { body: StructuralUnitBody; nestedDeps: Set<DeclId> } {
  // same-file-component-composition (design.md D5/D6): このユニット直下の
  // ローカルsignal/derived宣言を先に処理する。以後のテキスト/属性の
  // scope limit判定は、このユニット自身と祖先ユニットが宣言した
  // ローカルsignalだけを基準にする。構造単位は生成されたfactoryの
  // クロージャなので、祖先の局所変数は字句的に参照できる。
  const localDecls = localDeclStmts.map((stmt) =>
    processLocalDeclarationStatement(ctx, stmt, instanceId),
  )
  const bodyLocalDeclIds = new Set(localDecls.map((d) => d.id))
  const accessibleLocalDeclIds = new Set([...ancestorLocalDeclIds, ...bodyLocalDeclIds])

  // 子コンポーネントの動きゾーン関数は、インライン化後にlist itemの
  // ブロックへ移されたものをこのunitだけの名前解決表へ加える。解析中だけ
  // ctx.movementFnsにも反映し、既存の推移的書き込み検出を再利用する。
  const unitHandlerFns: HandlerFns = new Map(handlerFns)
  for (const [name, fn] of localMovementFns) unitHandlerFns.set(name, fn)
  const previousMovementFns = ctx.movementFns
  ctx.movementFns = unitHandlerFns

  const collectedMountHooks = [...localMountHooks]

  const markersBefore = ctx.markers.length
  const handlersBefore = ctx.handlers.length
  const attrsBefore = ctx.attrBindings.length
  const actionsBefore = ctx.actions.length
  let template = ''
  try {
    template = renderElement(ctx, elementPath, instanceId, unitHandlerFns, {
      skipAttrName,
      insideUnit: true,
      localDeclIds: accessibleLocalDeclIds,
      localMountHooks: collectedMountHooks,
    })
  } finally {
    ctx.movementFns = previousMovementFns
  }
  const localMarkers = ctx.markers.splice(markersBefore) as (
    | TextMarker
    | ListMarker
    | ConditionalMarker
  )[]
  const localHandlers = ctx.handlers.splice(handlersBefore)
  const localActions = ctx.actions.splice(actionsBefore) as ActionDecl[]
  const localMounts = collectedMountHooks.map((callbackPath) => {
    const analysis = analyzeMountBody(ctx, callbackPath, instanceId)
    return {
      finalizeBody: analysis.finalizeBody,
      finalizeCleanup: analysis.finalizeCleanup,
      writeDeclIds: analysis.writeDeclIds,
      directCollectionWriteDeclIds: analysis.directCollectionWriteDeclIds,
    } satisfies MountDecl
  })
  // ADR-0012 決定5: ユニット内の属性式が追跡signalを参照するのは、依存先が
  // 現在または祖先のローカルsignalである場合に限り許可する。ルートsignalや
  // 別の構造単位のローカルsignalは、字句的な所有範囲の外なので拒否する。
  const localAttrBindings = ctx.attrBindings.splice(attrsBefore)
  for (const b of localAttrBindings) {
    const leaksBeyondThisUnit = [...b.deps].some((d) => !accessibleLocalDeclIds.has(d))
    if (leaksBeyondThisUnit) {
      throw new Error(
        'compile: attribute binding referencing a tracked signal inside a list item or conditional branch is not supported yet (scope limit)',
      )
    }
  }
  const nestedDeps = new Set<DeclId>()
  for (const action of localActions) {
    for (const dep of action.resultDeps) {
      if (ctx.localDeclIds.has(dep) && !accessibleLocalDeclIds.has(dep)) {
        throw new Error(
          'compile: an action result references a local signal outside its lexical scope (scope limit)',
        )
      }
      if (!accessibleLocalDeclIds.has(dep)) nestedDeps.add(dep)
    }
  }
  for (const m of localMarkers) {
    const deps = ctx.markerDeps.get(m.id)
    ctx.markerDeps.delete(m.id)
    if (m.kind === 'text') {
      const leaksBeyondThisUnit = deps
        ? [...deps].some((d) => !accessibleLocalDeclIds.has(d))
        : false
      if (leaksBeyondThisUnit) {
        throw new Error(
          'compile: referencing a tracked signal inside a list item or conditional branch is not supported yet (scope limit)',
        )
      }
    } else {
      // ネストした構造ユニット自身の依存(さらに内側からバブル済みの分を
      // 含む)。祖先を含む局所signalはグローバルなsignalToMarkersへ合流
      // させない。生成された外側factoryの更新が、このunit instanceの
      // handle.update()を通じて内側へ届く。
      for (const d of deps ?? []) {
        if (ctx.localDeclIds.has(d) && !accessibleLocalDeclIds.has(d)) {
          throw new Error(
            'compile: a nested structural unit depends on a local signal outside its lexical scope (scope limit)',
          )
        }
        if (!accessibleLocalDeclIds.has(d)) nestedDeps.add(d)
      }
    }
  }
  return {
    body: {
      template,
      localMarkers,
      localHandlers,
      localActions,
      localMounts,
      localAttrBindings,
      localDecls,
    },
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
  ancestorLocalDeclIds: Set<DeclId> = new Set(),
): MarkerId {
  const callee = exprPath.get('callee') as NodePath<t.MemberExpression>
  const arrayObjPath = callee.get('object') as NodePath<t.Expression>
  const { deps, rendered: arrayRendered } = analyzeExpr(ctx, arrayObjPath, instanceId)
  const directDep = deps.size === 1 ? [...deps][0]! : null
  const collectionDeclId =
    directDep &&
    ctx.declKind.get(directDep) === 'collection' &&
    arrayRendered === ctx.declOutputName.get(directDep)
      ? directDep
      : null

  const arrowPath = exprPath.get('arguments.0') as NodePath<t.ArrowFunctionExpression>
  const itemParam = (arrowPath.get('params.0') as NodePath<t.Identifier>).node.name
  const {
    jsxPath: itemPath,
    localDeclStmts,
    localMovementFns,
    localMountHooks,
  } = resolveUnitBodySource(arrowPath.get('body'))

  const keyAttrPath = itemPath
    .get('openingElement')
    .get('attributes')
    .find(
      (a) =>
        a.isJSXAttribute() && a.node.name.type === 'JSXIdentifier' && a.node.name.name === 'key',
    ) as NodePath<t.JSXAttribute> | undefined
  if (!keyAttrPath) {
    throw new Error('compile: list items require a `key` attribute (scope limit)')
  }
  const keyValueNode = keyAttrPath.node.value
  if (keyValueNode?.type !== 'JSXExpressionContainer') {
    throw new Error('compile: list item `key` must be an expression (scope limit)')
  }
  const keyExprPath = keyAttrPath.get('value.expression') as NodePath<t.Expression>
  const { deps: keyDeps, rendered: keyRendered } = analyzeExpr(ctx, keyExprPath, instanceId)
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
    'key',
    localDeclStmts,
    ancestorLocalDeclIds,
    localMovementFns,
    localMountHooks,
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
    collectionDeclId,
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
  ancestorLocalDeclIds: Set<DeclId> = new Set(),
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
    throw new Error('compile: unsupported conditional expression form (scope limit)')
  }

  const { deps, rendered: condRendered } = analyzeExpr(ctx, testPath, instanceId)

  const branches = branchPaths.map((branchPath) => {
    if (!branchPath?.isJSXElement()) return { body: null }
    const { body, nestedDeps } = renderStructuralUnitBody(
      ctx,
      branchPath,
      instanceId,
      handlerFns,
      undefined,
      [],
      ancestorLocalDeclIds,
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
export function renderCallJsx(stmt: NodePath<t.Statement>): NodePath<t.JSXElement> | null {
  if (!stmt.isExpressionStatement()) return null
  const expr = stmt.get('expression')
  if (!expr.isCallExpression()) return null
  const callee = expr.node.callee
  if (callee.type !== 'Identifier' || callee.name !== 'render') return null
  const args = expr.get('arguments')
  if (args.length !== 1 || !args[0]!.isJSXElement()) {
    throw new Error('compile: render() takes exactly one JSX element (scope limit)')
  }
  return args[0] as NodePath<t.JSXElement>
}

export interface ComponentZones {
  varZoneStmts: NodePath<t.Statement>[]
  renderJsxPath: NodePath<t.JSXElement>
  movementZoneFns: HandlerFns
  mountHooks: MountHooks
  effectHooks: EffectHooks
}

function resolveOnMountExpression(
  expression: NodePath<t.Expression>,
): NodePath<t.ArrowFunctionExpression> | null {
  if (!expression.isCallExpression()) return null
  const callee = expression.node.callee
  if (callee.type !== 'Identifier' || callee.name !== 'onMount') return null
  const args = expression.get('arguments')
  if (args.length !== 1 || !args[0]!.isArrowFunctionExpression()) {
    throw new Error(
      'compile: onMount() takes exactly one zero-argument arrow function (scope limit)',
    )
  }
  const callback = args[0] as NodePath<t.ArrowFunctionExpression>
  if (callback.node.params.length !== 0) {
    throw new Error('compile: onMount() callback must not take parameters (scope limit)')
  }
  return callback
}

export function resolveOnMountHook(
  stmt: NodePath<t.Statement>,
): NodePath<t.ArrowFunctionExpression> | null {
  if (!stmt.isExpressionStatement()) return null
  return resolveOnMountExpression(stmt.get('expression') as NodePath<t.Expression>)
}

function resolveEffectHook(
  stmt: NodePath<t.Statement>,
): NodePath<t.ArrowFunctionExpression> | null {
  if (!stmt.isExpressionStatement()) return null
  const expression = stmt.get('expression')
  if (!expression.isCallExpression()) return null
  const callee = expression.node.callee
  if (callee.type !== 'Identifier' || callee.name !== 'effect') return null
  const args = expression.get('arguments')
  if (args.length !== 1 || !args[0]!.isArrowFunctionExpression()) {
    throw new Error(
      'compile: effect() takes exactly one zero-argument arrow function (scope limit)',
    )
  }
  const callback = args[0] as NodePath<t.ArrowFunctionExpression>
  if (callback.node.params.length !== 0) {
    throw new Error('compile: effect() callback must not take parameters (scope limit)')
  }
  return callback
}

// ADR-0008のゾーン構造(変数ゾーン→render()→動きゾーン)を、ctx を触らず
// 純粋に位置だけで特定する。same-file-component-composition: この特定
// ロジックはインライン化パス(compileComponent が動く前)からも同じ形で
// 要るため、compileComponent 本体から共有ヘルパーへ切り出した。
export function splitComponentZones(
  componentPath: NodePath<t.FunctionDeclaration>,
): ComponentZones {
  const stmts = componentPath.get('body.body') as NodePath<t.Statement>[]

  // UIゾーン(render() 文)の位置を特定する。ちょうど1つでなければならない。
  let renderIndex = -1
  let renderJsxPath: NodePath<t.JSXElement> | null = null
  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i]!
    if (stmt.isReturnStatement()) {
      throw new Error('compile: components declare UI with render(<JSX>), not return (scope limit)')
    }
    const jsx = renderCallJsx(stmt)
    if (jsx) {
      if (renderIndex !== -1) {
        throw new Error('compile: a component must contain exactly one render() call (scope limit)')
      }
      renderIndex = i
      renderJsxPath = jsx
    }
  }
  if (renderIndex === -1 || !renderJsxPath) {
    throw new Error('compile: a component must contain a render(<JSX>) call (scope limit)')
  }

  const varZoneStmts = stmts.slice(0, renderIndex)

  // 動きゾーン(render後): function宣言のみ。ハンドラ識別子参照の解決表に積む。
  const movementZoneFns: HandlerFns = new Map()
  const mountHooks: MountHooks = []
  const effectHooks: EffectHooks = []
  for (let i = renderIndex + 1; i < stmts.length; i++) {
    const stmt = stmts[i]!
    const mountHook = resolveOnMountHook(stmt)
    if (mountHook) {
      mountHooks.push(mountHook)
      continue
    }
    const effectHook = resolveEffectHook(stmt)
    if (effectHook) {
      effectHooks.push(effectHook)
      continue
    }
    if (!stmt.isFunctionDeclaration() || !stmt.node.id) {
      throw new Error(
        'compile: only function declarations are allowed after render(); onMount() and effect() calls are also allowed (scope limit)',
      )
    }
    movementZoneFns.set(stmt.node.id.name, stmt as NodePath<t.FunctionDeclaration>)
  }

  return { varZoneStmts, renderJsxPath, movementZoneFns, mountHooks, effectHooks }
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
  const { varZoneStmts, renderJsxPath, movementZoneFns, mountHooks, effectHooks } =
    splitComponentZones(componentPath)

  // 変数ゾーン(render前): signal()/derived() の const 宣言のみ。function宣言
  // など他の文は processDeclarationStatement の scope limit が拒否する。
  for (const stmt of varZoneStmts) {
    processDeclarationStatement(ctx, stmt, instanceId, out)
  }

  // cross-function-handler-writes: 呼び出し追跡(analyze.ts)が callee の
  // binding 同一性を確認できるよう、動きゾーン関数表を ctx へ載せる。
  ctx.movementFns = movementZoneFns

  for (const callbackPath of mountHooks) {
    const analysis = analyzeMountBody(ctx, callbackPath, instanceId)
    const mount: MountDecl = {
      finalizeBody: analysis.finalizeBody,
      finalizeCleanup: analysis.finalizeCleanup,
      writeDeclIds: analysis.writeDeclIds,
      directCollectionWriteDeclIds: analysis.directCollectionWriteDeclIds,
    }
    ctx.mounts.push(mount)
  }

  for (const callbackPath of effectHooks) {
    const analysis = analyzeEffectBody(ctx, callbackPath, instanceId)
    const effect: EffectDecl = {
      finalizeBody: analysis.finalizeBody,
      finalizeCleanup: analysis.finalizeCleanup,
      readDeclIds: analysis.readDeclIds,
    }
    ctx.effects.push(effect)
  }

  return renderElement(ctx, renderJsxPath, instanceId, movementZoneFns)
}
