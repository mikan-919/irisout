// 単一sourceの解析とcodegenを担当する本体。Nodeのファイル読込みと
// module linkerはこのファイルへ持ち込まず、ブラウザ入口から再利用できる
// source-onlyの範囲に保つ。
//
// マイルストーン1のコンパイラ:式の依存解析、単一コンポーネント、
// signal/derived/collection から専用 update_* への codegen(docs/adr/0001-first-milestone.md)。
// 出力はプレーン変数を使う(ADR-0006、legacy との最大の差分)。
//
// パイプライン:
//   1. @babel/parser でソースを parse(静的 AST)。
//   2. トップレベルのコンポーネント関数をすべて列挙し、他から JSX タグとして
//      一度も参照されないものをルートとする(スコープ:ルートはちょうど1つ、
//      子コンポーネント参照そのものは M1 では scope-limit error)。
//   3. ルートの render ツリーを深さ優先で辿る(packages/compiler/src/compiler/render.ts)。
//   4. フラット化・計装済みスクリプトを Node 上で1回実行し、(a) タグ付けした
//      呼び出しサイトが本当に signal/derived であることを確認し(ADR-0001 #3)、
//      (b) 実際の初期 HTML をタダで得る。ビルド時実行だけは本物の signal/
//      derived アクセサを使う - 出力コード自体がプレーン変数になるのとは
//      別の関心事(ADR-0006)。
//   5. 依存グラフ(marker -> signal、derived 経由、packages/compiler/src/compiler/decl-graph.ts)
//      を構築し、ルート signal ごとに専用の update_<name> 関数を生成する。

import traverseImport from '@babel/traverse'
import { parse } from '@babel/parser'
import type { NodePath } from '@babel/traverse'
import type * as t from '@babel/types'
import type {
  ActionOutput,
  ConditionalMarkerOutput,
  EffectOutput,
  HandlerOutput,
  ListMarkerOutput,
  LocalEffectOutput,
  MarkerOutput,
  MountOutput,
  StructuralUnitBodyOutput,
  UpdateBatchOutput,
} from '../codegen.ts'
import { generateModule } from '../codegen.ts'
import { analyzeExpr } from './analyze.ts'
import { assertAcyclicDerivedGraph, resolveToSignals } from './decl-graph.ts'
import { collectTopLevelComponents, inlineComponents } from './inline-components.ts'
import { compileComponent } from './render.ts'
import { stripAuthoringImports } from './authoring-import.ts'
import type {
  ConditionalMarker,
  DeclId,
  HandlerDecl,
  ListMarker,
  MarkerId,
  MountDecl,
  StructuralUnitBody,
} from './state.ts'
import { assignOutputName, createCompilerState, toContextId, toDeclId } from './state.ts'
import { withCompileDiagnostic } from '../diagnostics.ts'
import type { DiagnosticOrigin } from '../diagnostics.ts'
import { finalizeSourceMap } from '../source-map.ts'
import type { IrisoutSourceMap } from '../source-map.ts'
import { attrBindingKind } from '../template.ts'
export { CompileDiagnostic } from '../diagnostics.ts'
import { derived, registry, signal } from '../../../runtime/src/index.ts'

const traverse =
  (traverseImport as unknown as { default?: typeof traverseImport }).default ?? traverseImport

export interface CompileResult {
  code: string
  map: IrisoutSourceMap
  initialHtml: string
  /** SSR targetで生成した要求単位のrender module。client targetでは未定義。 */
  ssrCode?: string
  /** 公開結果ではコンパイラ内部のBabel ASTを露出させない。 */
  markers: readonly unknown[]
  signalToMarkers: ReadonlyMap<string, ReadonlySet<string>>
  declName: ReadonlyMap<string, string>
  /** compileProject()が読み込んだ入口と相対moduleの絶対path。 */
  dependencies: readonly string[]
}

// Program 直下はcompile()では関数宣言(export付き含む)だけを受理する。
// compileProject()ではmodule linkerが許可した補助constと共有signalも受理する。
// それ以外のトップレベル処理は出力へ安全に移せないため拒否する。
function assertTopLevelShape(program: t.Program, allowModuleSupport = false): void {
  for (const stmt of program.body) {
    const inner = stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : stmt
    const isSupportConst =
      allowModuleSupport &&
      inner?.type === 'VariableDeclaration' &&
      inner.kind === 'const' &&
      inner.declarations.every(
        (declaration) => declaration.id.type === 'Identifier' && declaration.init != null,
      )
    const isContextConst =
      inner?.type === 'VariableDeclaration' &&
      inner.kind === 'const' &&
      inner.declarations.every((declaration) => {
        const init = declaration.init
        return (
          declaration.id.type === 'Identifier' &&
          init?.type === 'CallExpression' &&
          init.callee.type === 'Identifier' &&
          (init.callee.name === 'createContext' || init.callee.name === 'createAsyncContext') &&
          init.arguments.length === 1 &&
          init.arguments[0]?.type !== 'SpreadElement'
        )
      })
    const hasContextCall =
      inner?.type === 'VariableDeclaration' &&
      inner.declarations.some(
        (declaration) =>
          declaration.init?.type === 'CallExpression' &&
          declaration.init.callee.type === 'Identifier' &&
          (declaration.init.callee.name === 'createContext' ||
            declaration.init.callee.name === 'createAsyncContext'),
      )
    if (hasContextCall && !isContextConst) {
      throw new Error(
        'compile: context declarations require one default value and simple names (scope limit)',
      )
    }
    if (inner?.type !== 'FunctionDeclaration' && !isSupportConst && !isContextConst) {
      throw new Error('compile: only top-level function declarations are supported (scope limit)')
    }
  }
}

function collectContextDeclarations(
  ast: ReturnType<typeof parse>,
  source: string,
  ctx: ReturnType<typeof createCompilerState>,
): void {
  for (const statement of ast.program.body) {
    const declaration =
      statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
    if (declaration?.type !== 'VariableDeclaration' || declaration.kind !== 'const') continue
    for (const declarator of declaration.declarations) {
      if (
        declarator.id.type !== 'Identifier' ||
        declarator.init?.type !== 'CallExpression' ||
        declarator.init.callee.type !== 'Identifier' ||
        (declarator.init.callee.name !== 'createContext' &&
          declarator.init.callee.name !== 'createAsyncContext') ||
        declarator.init.arguments.length !== 1 ||
        declarator.init.arguments[0]?.type === 'SpreadElement'
      ) {
        continue
      }
      const start = declarator.start
      const arg = declarator.init.arguments[0]
      if (start == null || !arg || arg.start == null || arg.end == null) continue
      const id = toContextId(`context_${start}_${declarator.id.name}`)
      const defaultSourceRendered = source.slice(arg.start, arg.end)
      ctx.contexts.set(id, {
        id,
        async: declarator.init.callee.name === 'createAsyncContext',
        defaultRendered: defaultSourceRendered,
        defaultSourceRendered,
      })
      ctx.contextIdByKey.set(`${start}:${declarator.id.name}`, id)
    }
  }
}

function collectSharedDeclarations(
  ast: ReturnType<typeof parse>,
  source: string,
  ctx: ReturnType<typeof createCompilerState>,
): void {
  const pending: {
    path: NodePath<t.VariableDeclarator>
    id: DeclId
    kind: 'signal' | 'derived'
    outputName: string
  }[] = []

  // 先に全shared bindingを登録する。これにより、derivedが後ろにある別の
  // shared signal/derivedを参照しても、本文解析時にbindingを解決できる。
  traverse(ast, {
    VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
      const declarationPath = path.parentPath
      const containerPath = declarationPath?.parentPath
      const isTopLevel =
        declarationPath?.isVariableDeclaration() === true &&
        (containerPath?.isProgram() === true ||
          (containerPath?.isExportNamedDeclaration() === true &&
            containerPath.parentPath?.isProgram() === true))
      if (!isTopLevel || !declarationPath.isVariableDeclaration()) return
      if (path.node.id.type !== 'Identifier' || declarationPath.node.kind !== 'const') return

      const init = path.node.init
      if (init?.type !== 'CallExpression' || init.callee.type !== 'Identifier') return
      const kind =
        init.callee.name === 'signal' ? 'signal' : init.callee.name === 'derived' ? 'derived' : null
      if (!kind) return

      if (kind === 'signal') {
        if (init.arguments.length !== 1 || init.arguments[0]?.type === 'SpreadElement') {
          throw new Error('compile: module-scope signal() takes exactly one argument')
        }
      } else if (
        kind === 'derived' &&
        (init.arguments.length !== 1 ||
          init.arguments[0]?.type !== 'ArrowFunctionExpression' ||
          init.arguments[0].params.length !== 0 ||
          init.arguments[0].body.type === 'BlockStatement')
      ) {
        throw new Error(
          'compile: module-scope derived() must be called with a zero-arg concise arrow function `() => expr` (scope limit)',
        )
      }

      const start = path.node.start
      if (start == null) return
      const id = toDeclId(`shared_${start}_${path.node.id.name}`)
      const outputName = assignOutputName(ctx, path.node.id.name, id)
      ctx.declKind.set(id, kind)
      ctx.sharedDeclIds.add(id)
      ctx.sharedDeclIdByBindingKey.set(`${start}:${path.node.id.name}`, id)
      pending.push({ path, id, kind, outputName })
    },
  })

  for (const declaration of pending) {
    const initPath = declaration.path.get('init') as NodePath<t.CallExpression>
    const args = initPath.get('arguments') as NodePath<t.Expression>[]
    const argPath = args[0]!
    if (declaration.kind === 'signal') {
      const start = argPath.node.start
      const end = argPath.node.end
      if (start == null || end == null) continue
      const sourceRendered = source.slice(start, end)
      ctx.sharedDecls.push({
        id: declaration.id,
        kind: declaration.kind,
        outputName: declaration.outputName,
        rendered: sourceRendered,
        sourceRendered,
      })
      continue
    }

    const arrowPath = argPath as NodePath<t.ArrowFunctionExpression>
    const bodyPath = arrowPath.get('body') as NodePath<t.Expression>
    const arrowStart = arrowPath.node.start
    const bodyStart = bodyPath.node.start
    if (arrowStart == null || bodyStart == null) continue
    const arrowPrefix = source.slice(arrowStart, bodyStart)
    const analyzed = analyzeExpr(ctx, bodyPath, 0)
    ctx.derivedDeps.set(declaration.id, analyzed.deps)
    ctx.derivedRecompute.set(declaration.id, analyzed.rendered)
    ctx.sharedDecls.push({
      id: declaration.id,
      kind: declaration.kind,
      outputName: declaration.outputName,
      rendered: `${arrowPrefix}${analyzed.rendered}`,
      sourceRendered: `${arrowPrefix}${analyzed.sourceRendered}`,
    })
  }
  // derived本文の解析は依存グラフを作るためにshared bindingを訪問するが、
  // その時点ではrootから参照されたか決まっていない。出力対象の判定は
  // component解析後に、使用されたderivedから依存先を辿って行う。
  ctx.usedSharedDeclIds.clear()
}

function markUsedSharedDependencies(ctx: ReturnType<typeof createCompilerState>): void {
  const visited = new Set<DeclId>()
  const visit = (id: DeclId): void => {
    if (visited.has(id)) return
    visited.add(id)
    if (ctx.sharedDeclIds.has(id)) ctx.usedSharedDeclIds.add(id)
    for (const dependency of ctx.derivedDeps.get(id) ?? []) visit(dependency)
  }
  for (const id of ctx.usedSharedDeclIds) visit(id)
}

// トップレベルのコンポーネントをすべて列挙し、誰からも参照されない唯一の
// ルートを特定する(パイプライン手順2)。same-file-component-composition:
// この時点ではinlineComponentsが既に子コンポーネントの参照を展開・元宣言を
// 除去済みなので、この関数はコンポーネント合成という概念を知らないまま
// 単一コンポーネント想定で動く(ADR-0014コンテキスト参照)。
function findRootComponent(
  ast: ReturnType<typeof parse>,
  renderOnly = false,
): NodePath<t.FunctionDeclaration> {
  const componentsByName = collectTopLevelComponents(ast, renderOnly)
  if (componentsByName.size === 0) throw new Error('compile: no component function found')

  const referenced = new Set<string>()
  for (const path of componentsByName.values()) {
    path.traverse({
      JSXOpeningElement(jsxPath: NodePath<t.JSXOpeningElement>) {
        const name = jsxPath.node.name
        if (
          name.type === 'JSXIdentifier' &&
          /^[A-Z]/.test(name.name) &&
          componentsByName.has(name.name)
        ) {
          referenced.add(name.name)
        }
      },
    })
  }
  const rootNames = [...componentsByName.keys()].filter((name) => !referenced.has(name))
  if (rootNames.length !== 1) {
    throw new Error(
      `compile: expected exactly one root component, found [${rootNames.join(', ')}] (scope limit)`,
    )
  }
  return componentsByName.get(rootNames[0]!)!
}

// 推移閉包:derived の declId をルート signal まで展開し、
// signal -> それに(間接)依存するマーカー集合の逆引きを作る(パイプライン手順5)。
function buildSignalToMarkers(
  ctx: ReturnType<typeof createCompilerState>,
): Map<DeclId, Set<MarkerId>> {
  const signalToMarkers = new Map<DeclId, Set<MarkerId>>()
  for (const [markerId, deps] of ctx.markerDeps) {
    for (const dep of deps) {
      for (const sig of resolveToSignals(ctx, dep, new Set())) {
        if (!signalToMarkers.has(sig)) signalToMarkers.set(sig, new Set())
        signalToMarkers.get(sig)!.add(markerId)
      }
    }
  }
  // effectのみが読むsignalにも専用update_*()を生成する。空のmarker集合を
  // 保持することで、handler/actionの書き込みからDOM以外のeffectへ同じ
  // 依存経路を接続し、未使用effectの生成物は増やさない。
  for (const effect of ctx.effects) {
    for (const dep of effect.readDeclIds) {
      for (const sig of resolveToSignals(ctx, dep, new Set())) {
        if (!signalToMarkers.has(sig)) signalToMarkers.set(sig, new Set())
      }
    }
  }
  return signalToMarkers
}

export interface CompileOptions {
  target?: 'client' | 'ssr'
  /** 単一sourceのブラウザ境界を検査する。Nodeの入口では使わない。 */
  browser?: boolean
  allowModuleSupport?: boolean
  hasRelativeModule?: boolean
  supportStatements?: string[]
  supportNames?: Set<string>
  externalImports?: string[]
  dependencies?: string[]
  sourceMapFilePath?: string
  sourceMapOrigins?: DiagnosticOrigin[]
}

const SSR_RESERVED_NAMES = new Set([
  '__rawInput__',
  '__input__',
  '__input_or_state__',
  '__state__',
  '__signal_state__',
  '__irisout_clone_json__',
  '__irisout_input__',
  '__irisout_require_state__',
  '__irisout_state__',
  '__irisout_signal__',
  '__irisout_restore_signal__',
  '__esc__',
  '__escAttr__',
  '__INITIAL_HTML__',
  '__MARKER_IDS__',
  '__RANGE_IDS__',
  '__markers__',
  '__ranges__',
  '__container__',
  '__mounted__',
  '__unmounted__',
  '__doc__',
  'html',
  'signal',
  'derived',
])

function assertBrowserSourceBoundary(ast: ReturnType<typeof parse>): void {
  const resourceImport =
    /\.(?:css|scss|sass|less|svg|png|jpe?g|gif|webp|avif|woff2?|ttf|otf)(?:[?#].*)?$/i
  traverse(ast, {
    ImportDeclaration(path: NodePath<t.ImportDeclaration>) {
      const specifier = path.node.source.value
      if (resourceImport.test(specifier)) {
        throw new Error(
          `compile: browser source does not support external resource import "${specifier}" (scope limit)`,
        )
      }
      throw new Error(
        `compile: browser source does not support static import "${specifier}" (scope limit)`,
      )
    },
    ExportAllDeclaration(path: NodePath<t.ExportAllDeclaration>) {
      throw new Error(
        `compile: browser source does not support external module export "${path.node.source.value}" (scope limit)`,
      )
    },
    ExportNamedDeclaration(path: NodePath<t.ExportNamedDeclaration>) {
      if (!path.node.source) return
      throw new Error(
        `compile: browser source does not support external module export "${path.node.source.value}" (scope limit)`,
      )
    },
    CallExpression(path: NodePath<t.CallExpression>) {
      if ((path.node.callee as t.Node).type !== 'Import') return
      throw new Error('compile: browser source does not support dynamic import (scope limit)')
    },
    ImportExpression() {
      throw new Error('compile: browser source does not support dynamic import (scope limit)')
    },
  })
}

function assertSsrInputBinding(name: string): void {
  if (SSR_RESERVED_NAMES.has(name)) {
    throw new Error(
      `compile: SSR root input binding "${name}" conflicts with generated internal name (scope limit)`,
    )
  }
}

// SSRとclient hydrateで同じ入力を使うため、ルート部品の仮引数だけを
// 生成moduleへ移す。任意のJavaScriptを入力境界へ持ち込まないよう、初期版は
// 識別子一つ、または単純なobject destructuringだけを受理する。
function rootInputPattern(
  componentPath: NodePath<t.FunctionDeclaration>,
  source: string,
): string | null {
  const params = componentPath.node.params
  if (params.length === 0) return null
  if (params.length !== 1) {
    throw new Error('compile: SSR root component accepts at most one input parameter (scope limit)')
  }
  const parameter = params[0]!
  if (parameter.type === 'Identifier') {
    assertSsrInputBinding(parameter.name)
    return parameter.name
  }
  if (parameter.type === 'ObjectPattern') {
    const start = parameter.start
    const end = parameter.end
    if (start == null || end == null) {
      throw new Error('compile: SSR root input parameter must have a source range (scope limit)')
    }
    for (const property of parameter.properties) {
      if (property.type === 'RestElement') {
        throw new Error('compile: SSR root input rest properties are not supported (scope limit)')
      }
      if (property.type !== 'ObjectProperty' || property.computed) {
        throw new Error(
          'compile: SSR root input must use simple object destructuring (scope limit)',
        )
      }
      if (property.key.type !== 'Identifier' && property.key.type !== 'StringLiteral') {
        throw new Error(
          'compile: SSR root input must use identifier or string property names (scope limit)',
        )
      }
      if (property.value.type !== 'Identifier') {
        throw new Error(
          'compile: SSR root input only supports shorthand destructuring (scope limit)',
        )
      }
      assertSsrInputBinding(property.value.name)
    }
    const pattern = source.slice(start, end)
    if (pattern.includes(':')) {
      throw new Error('compile: SSR root input only supports shorthand destructuring (scope limit)')
    }
    return pattern
  }
  throw new Error('compile: SSR root input must be an identifier or object pattern (scope limit)')
}

const SSR_JSON_HELPER = `function __irisout_clone_json__(value) {
  const seen = new Set();
  const fail = (message) => { throw new TypeError(message); };
  const visitObject = (current) => {
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) fail('SSR input must contain plain JSON objects');
    for (const key of Reflect.ownKeys(current)) {
      if (typeof key !== 'string') fail('SSR input must not contain symbol properties');
      if (key === 'toJSON') fail('SSR input must not contain toJSON properties');
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor || !descriptor.enumerable || descriptor.get || descriptor.set) fail('SSR input must contain data properties only');
      visit(current[key]);
    }
  };
  const visitArray = (current) => {
    if (Object.getPrototypeOf(current) !== Array.prototype) fail('SSR input must contain ordinary arrays');
    for (const key of Reflect.ownKeys(current)) {
      if (key === 'length') continue;
      if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= current.length) fail('SSR input arrays must contain indexed values only');
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor || !descriptor.enumerable || descriptor.get || descriptor.set) fail('SSR input must contain data properties only');
      visit(current[Number(key)]);
    }
  };
  const visit = (current) => {
    if (current === null || typeof current === 'string' || typeof current === 'boolean') return;
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) fail('SSR input must contain finite JSON numbers');
      return;
    }
    if (typeof current !== 'object') fail('SSR input must contain JSON-serializable values');
    if (seen.has(current)) fail('SSR input must not contain cycles');
    seen.add(current);
    if (Array.isArray(current)) visitArray(current);
    else visitObject(current);
    seen.delete(current);
  };
  visit(value);
  const encoded = JSON.stringify(value);
  if (encoded === undefined) fail('SSR input must be JSON-serializable');
  return JSON.parse(encoded);
}`

interface SsrModuleInput {
  externalImports: string[]
  supportStatements: string[]
  inputPattern: string | null
  instrumentedDeclStatements: string[]
  rootHtmlSource: string
}

function generateSsrModule({
  externalImports,
  supportStatements,
  inputPattern,
  instrumentedDeclStatements,
  rootHtmlSource,
}: SsrModuleInput): string {
  const lines: string[] = []
  const instrumentedSsrDeclStatements = instrumentedDeclStatements.map((statement) =>
    /^const ([A-Za-z_$][A-Za-z0-9_$]*) = signal\(/.test(statement)
      ? statement.replace(
          /^const ([A-Za-z_$][A-Za-z0-9_$]*) = signal\(/,
          'const $1 = __irisout_signal__(',
        )
      : statement,
  )
  const hasSignalState = instrumentedDeclStatements.some((statement) =>
    /^const [A-Za-z_$][A-Za-z0-9_$]* = signal\(/.test(statement),
  )
  if (externalImports.length > 0) lines.push(...externalImports, '')
  lines.push("import { signal, derived } from 'irisout/runtime';", '', SSR_JSON_HELPER, '')
  if (supportStatements.length > 0) lines.push(...supportStatements, '')
  lines.push(
    'export function render(__rawInput__) {',
    '  const __input__ = __irisout_clone_json__(arguments.length === 0 ? {} : __rawInput__);',
  )
  if (inputPattern) lines.push(`  const ${inputPattern} = __input__;`)
  if (hasSignalState) {
    lines.push(
      '  const __signal_state__ = Object.create(null);',
      '  const __irisout_signal__ = (initial, id) => { const accessor = signal(initial, id); __signal_state__[id] = accessor(); return accessor; };',
    )
  }
  lines.push(
    ...instrumentedSsrDeclStatements.map((statement) => `  ${statement}`),
    "  const __esc__ = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;');",
    "  const __escAttr__ = (value) => String(value).replace(/&/g, '&amp;').replace(/\"/g, '&quot;');",
    `  const html = \`${rootHtmlSource}\`;`,
    hasSignalState
      ? '  return { html, state: { __irisout_state__: true, input: __input__, signals: __irisout_clone_json__(__signal_state__) } };'
      : '  return { html, state: { __irisout_state__: true, input: __input__, signals: {} } };',
    '}',
    '',
  )
  return lines.join('\n')
}

export function compileSource(source: string, options: CompileOptions = {}): CompileResult {
  registry.clear()

  const ast = parse(source, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  })
  stripAuthoringImports(ast)
  if (options.browser) assertBrowserSourceBoundary(ast)
  assertTopLevelShape(ast.program, options.allowModuleSupport)
  // same-file-component-composition (ADR-0014, design.md D1): 同一ファイル内
  // の<Component/>参照をfindRootComponentより前にASTインライン化する。以後の
  // パイプラインはコンポーネント合成という概念を一切知らないまま動く。
  const transformedNodes = new Set<t.Node>()
  inlineComponents(ast, transformedNodes)
  const ctx = createCompilerState(source, transformedNodes, options.supportNames)
  collectContextDeclarations(ast, source, ctx)
  for (const supportName of options.supportNames ?? []) ctx.usedOutputNames.add(supportName)
  if (options.target === 'ssr') {
    for (const reservedName of SSR_RESERVED_NAMES) ctx.usedOutputNames.add(reservedName)
  }
  if (options.allowModuleSupport) collectSharedDeclarations(ast, source, ctx)
  const rootPath = findRootComponent(ast, options.allowModuleSupport === true)
  const inputPattern = options.target === 'ssr' ? rootInputPattern(rootPath, source) : null
  if (options.target === 'ssr' && ctx.sharedDeclIds.size > 0) {
    throw new Error('compile: module shared state is not supported in SSR (scope limit)')
  }
  if (options.target === 'ssr' && options.hasRelativeModule) {
    throw new Error('compile: relative modules are not supported in SSR (scope limit)')
  }
  if (options.target === 'ssr' && (options.externalImports?.length ?? 0) > 0) {
    throw new Error('compile: external modules are not supported in SSR (scope limit)')
  }

  const out = {
    declStatements: [] as string[],
    instrumentedDeclStatements: [] as string[],
  }
  const rootHtmlSource = compileComponent(ctx, rootPath, ctx.instanceCounter++, out)
  if (options.target === 'ssr' && ctx.localDeclIds.size > 0) {
    throw new Error(
      'compile: signal() and derived() inside structural units are not supported in SSR (scope limit)',
    )
  }

  assertAcyclicDerivedGraph(ctx)
  markUsedSharedDependencies(ctx)
  const signalToMarkers = buildSignalToMarkers(ctx)

  // 同じ同期スコープで複数 root signal が書き込まれる場合でも、依存 marker
  // は一度だけ更新する。marker 集合が重ならない組み合わせは従来の個別
  // update_*() の方が小さいため、batch を生成しない(ADR-0004)。
  const updateBatches: UpdateBatchOutput[] = []
  const batchByRootSet = new Map<string, UpdateBatchOutput>()
  let batchCounter = 0
  const batchNames = new Set<string>()

  const nextBatchName = (): string => {
    let name = `__update_batch_${batchCounter++}__`
    while (ctx.usedOutputNames.has(name) || batchNames.has(name)) {
      name = `__update_batch_${batchCounter++}__`
    }
    batchNames.add(name)
    return name
  }

  const resolveUpdatePlan = (
    ids: Set<DeclId>,
    directCollectionWriteDeclIds: Set<DeclId> = new Set(),
  ): {
    updateNames: string[]
    updateBatchName: string | null
    needsCollectionBatch: boolean
  } => {
    const rootIds = [...new Set([...ids, ...directCollectionWriteDeclIds])]
      .filter((id) => signalToMarkers.has(id) && !ctx.sharedDeclIds.has(id))
      .sort()
    // collection.update() は専用の直接通知をすでに行うため、batch になら
    // ないスコープの末尾へ通常の update_<collection>() を足さない。ただし
    // 同じスコープに通常の keyed signal(next) setter もある場合は ids に
    // 残るので、最終状態の reconcile が必要になる。
    const updateNames = rootIds
      .filter(
        (id) =>
          ctx.declKind.get(id) !== 'collection' ||
          !directCollectionWriteDeclIds.has(id) ||
          ids.has(id),
      )
      .map((id) => ctx.declOutputName.get(id)!)
      .sort()
    if (rootIds.length < 2) {
      return { updateNames, updateBatchName: null, needsCollectionBatch: false }
    }

    const markerIds = new Set<MarkerId>()
    let hasSharedMarker = false
    for (const rootId of rootIds) {
      for (const markerId of signalToMarkers.get(rootId) ?? []) {
        if (markerIds.has(markerId)) hasSharedMarker = true
        markerIds.add(markerId)
      }
    }
    if (!hasSharedMarker) return { updateNames, updateBatchName: null, needsCollectionBatch: false }

    const key = rootIds.join('\u0000')
    let batch = batchByRootSet.get(key)
    if (!batch) {
      batch = {
        name: nextBatchName(),
        signalIds: rootIds,
        markerIds: [...markerIds],
        containsCollection: rootIds.some((id) => directCollectionWriteDeclIds.has(id)),
      }
      batchByRootSet.set(key, batch)
      updateBatches.push(batch)
    } else if (
      !batch.containsCollection &&
      rootIds.some((id) => directCollectionWriteDeclIds.has(id))
    ) {
      // 同じ root set の batch を通常の collection setter が先に登録して
      // いても、後から collection.update() 経路が合流した時点で direct
      // 通知の遅延が必要になる。batch は全スコープで共有するため、ここで
      // property を昇格させ、codegen 側の item updater guard も有効にする。
      batch.containsCollection = true
    }
    return {
      updateNames: [],
      updateBatchName: batch.name,
      needsCollectionBatch: batch.containsCollection,
    }
  }

  const resolveUpdateCall = (ids: Set<DeclId>, directCollectionWriteDeclIds?: Set<DeclId>) => {
    const plan = resolveUpdatePlan(ids, directCollectionWriteDeclIds)
    return {
      code: plan.updateBatchName
        ? `${plan.updateBatchName}();`
        : plan.updateNames.map((name) => `update_${name}();`).join(' '),
      needsCollectionBatch: plan.needsCollectionBatch,
    }
  }

  // --- M2/ADR-0020: ハンドラの writeDeclIds をマーカーを持つ signal だけに
  // 絞り込み、個別updateまたは共有marker用batch呼び出しへ変換する。
  // M5: リスト/条件分岐のローカルハンドラ(StructuralUnitBody.localHandlers)
  // も同じ変換が要るので、ctx.handlers 直下・構造ユニット内の両方に使う
  // 共通ヘルパーにする。
  // same-file-component-composition: ローカルハンドラが書き込む局所signalの
  // 所有bodyを、現在bodyから数えた字句スコープ位置で記録する。生成側は
  // 同じfactoryまたは祖先factoryのupdateへ直接つなぐため、ローカルsignalが
  // module scopeのsignalToMarkersへ混ざらない。
  const convertHandler = (h: HandlerDecl, localScopes: Set<DeclId>[] = []): HandlerOutput => {
    const resolveHandlerUpdateCall = (
      ids: Set<DeclId>,
      directCollectionWriteDeclIds: Set<DeclId> = new Set(),
    ) => {
      const plan = resolveUpdateCall(ids, directCollectionWriteDeclIds)
      const localUpdateLevels = localScopes.flatMap((scope, level) =>
        [...ids].some((id) => scope.has(id)) ? [level] : [],
      )
      const localUpdateCalls = [
        ...new Set(
          localUpdateLevels.map((level) =>
            level === 0 ? '__LOCAL_SELF_UPDATE__' : `__LOCAL_ANCESTOR_${level}__`,
          ),
        ),
      ]
        .map((name) => `${name}();`)
        .join(' ')
      return {
        code: [plan.code, localUpdateCalls].filter(Boolean).join(' '),
        needsCollectionBatch: plan.needsCollectionBatch,
      }
    }
    const rendered = h.finalize ? h.finalize(resolveHandlerUpdateCall) : h.rendered
    const plan = resolveUpdatePlan(h.writeDeclIds, h.directCollectionWriteDeclIds)
    const localUpdateLevels = localScopes.flatMap((scope, level) =>
      [...h.writeDeclIds].some((id) => scope.has(id)) ? [level] : [],
    )
    return {
      markerId: h.markerId,
      eventName: h.eventName,
      rendered,
      async: h.async,
      updatesInRendered:
        h.finalize != null && (h.writeDeclIds.size > 0 || h.directCollectionWriteDeclIds.size > 0),
      param: h.param,
      updateNames: plan.updateNames,
      updateBatchName: plan.updateBatchName,
      updateBatchNeedsCollection: plan.needsCollectionBatch,
      localUpdateLevels,
      sourceStart: h.sourceStart,
    }
  }

  const convertAction = (
    a: (typeof ctx.actions)[number],
    localScopes: Set<DeclId>[] = [],
  ): ActionOutput => {
    const resolveActionUpdateCall = (
      ids: Set<DeclId>,
      directCollectionWriteDeclIds: Set<DeclId> = new Set(),
    ) => {
      const plan = resolveUpdateCall(ids, directCollectionWriteDeclIds)
      const localUpdateLevels = localScopes.flatMap((scope, level) =>
        [...ids].some((id) => scope.has(id)) ? [level] : [],
      )
      const localUpdateCalls = [
        ...new Set(
          localUpdateLevels.map((level) =>
            level === 0 ? '__LOCAL_SELF_UPDATE__' : `__LOCAL_ANCESTOR_${level}__`,
          ),
        ),
      ]
        .map((name) => `${name}();`)
        .join(' ')
      return {
        code: [plan.code, localUpdateCalls].filter(Boolean).join(' '),
        needsCollectionBatch: plan.needsCollectionBatch,
      }
    }
    return {
      markerId: a.markerId,
      elParam: a.elParam,
      bodyRendered: a.finalizeBody(resolveActionUpdateCall),
      resultRendered: a.finalizeResult ? a.finalizeResult(resolveActionUpdateCall) : null,
      bodySourceStart: a.bodySourceStart,
      resultSourceStart: a.resultSourceStart,
    }
  }
  const convertMount = (m: MountDecl, localScopes: Set<DeclId>[] = []): MountOutput => {
    const resolveMountUpdateCall = (
      ids: Set<DeclId>,
      directCollectionWriteDeclIds: Set<DeclId> = new Set(),
    ) => {
      const plan = resolveUpdateCall(ids, directCollectionWriteDeclIds)
      const localUpdateLevels = localScopes.flatMap((scope, level) =>
        [...ids].some((id) => scope.has(id)) ? [level] : [],
      )
      const localUpdateCalls = [
        ...new Set(
          localUpdateLevels.map((level) =>
            level === 0 ? '__LOCAL_SELF_UPDATE__' : `__LOCAL_ANCESTOR_${level}__`,
          ),
        ),
      ]
        .map((name) => `${name}();`)
        .join(' ')
      return {
        code: [plan.code, localUpdateCalls].filter(Boolean).join(' '),
        needsCollectionBatch: plan.needsCollectionBatch,
      }
    }
    return {
      bodyRendered: m.finalizeBody(resolveMountUpdateCall),
      cleanupRendered: m.finalizeCleanup ? m.finalizeCleanup() : null,
      bodySourceStart: m.bodySourceStart,
      cleanupSourceStart: m.cleanupSourceStart,
    }
  }
  const convertLocalEffect = (effect: (typeof ctx.effects)[number]): LocalEffectOutput => ({
    bodyRendered: effect.finalizeBody(() => ({ code: '', needsCollectionBatch: false })),
    cleanupRendered: effect.finalizeCleanup ? effect.finalizeCleanup() : null,
    bodySourceStart: effect.bodySourceStart,
    cleanupSourceStart: effect.cleanupSourceStart,
    signalNames: [
      ...new Set(
        [...effect.readDeclIds]
          .flatMap((dep) => [...resolveToSignals(ctx, dep, new Set())])
          .map((id) => ctx.declOutputName.get(id))
          .filter((name): name is string => name != null),
      ),
    ],
  })
  const handlerOutputs = ctx.handlers.map((h) => convertHandler(h))

  // M5.5: ネストした構造ユニット(body.localMarkers 内の list/conditional)の
  // ローカルハンドラにも同じ変換が要るため、body と marker で相互再帰する。
  const convertUnitMarker = (
    m: ListMarker | ConditionalMarker,
    ancestorLocalScopes: Set<DeclId>[] = [],
  ): ListMarkerOutput | ConditionalMarkerOutput =>
    m.kind === 'list'
      ? {
          ...m,
          collectionOutputName: m.collectionDeclId
            ? ctx.declOutputName.get(m.collectionDeclId)!
            : null,
          collectionShared: m.collectionDeclId ? ctx.sharedDeclIds.has(m.collectionDeclId) : false,
          body: convertBody(m.body, ancestorLocalScopes),
        }
      : {
          ...m,
          branches: m.branches.map((b) => ({
            body: b.body ? convertBody(b.body, ancestorLocalScopes) : null,
          })),
        }
  const convertBody = (
    body: StructuralUnitBody,
    ancestorLocalScopes: Set<DeclId>[] = [],
  ): StructuralUnitBodyOutput => {
    const localDeclIds = new Set(body.localDecls.map((d) => d.id))
    const localScopes = [localDeclIds, ...ancestorLocalScopes]
    return {
      template: body.template,
      localMarkers: body.localMarkers.map((m) =>
        m.kind === 'text' ? m : convertUnitMarker(m, localScopes),
      ),
      localHandlers: body.localHandlers.map((h) => convertHandler(h, localScopes)),
      localActions: body.localActions.map((a) => convertAction(a, localScopes)),
      localMounts: body.localMounts.map((m) => convertMount(m, localScopes)),
      localEffects: body.localEffects.map(convertLocalEffect),
      localAttrBindings: body.localAttrBindings,
      localDecls: body.localDecls,
      rootDeps: body.rootDeps,
    }
  }
  const markerOutputs: MarkerOutput[] = ctx.markers.map((m) => {
    if (m.kind === 'text' || m.kind === 'action') return m
    return convertUnitMarker(m)
  })

  // 構造unitはclient buildではコメント範囲へ遅延生成するが、SSRでは要求入力
  // に応じた実要素を初期HTMLへ含める。既存のmarker/templateを再利用し、SSR
  // 専用の汎用DOM runtimeやbuild時の投稿コード実行は追加しない。
  const structuralAnchor = (id: string): string =>
    `<!--irisout:start:${id}--><!--irisout:end:${id}-->`

  const renderSsrLocalDecls = (decls: StructuralUnitBodyOutput['localDecls']): string[] =>
    decls.map((decl) =>
      decl.kind === 'signal'
        ? `const ${decl.outputName} = signal(${decl.sourceRendered}, ${JSON.stringify(decl.id)});`
        : `const ${decl.outputName} = derived(() => ${decl.sourceRendered}, ${JSON.stringify(decl.id)});`,
    )

  const renderSsrBody = (body: StructuralUnitBodyOutput): string => {
    let template = body.template
    for (const binding of body.localAttrBindings) {
      const marker = `data-iris-id="${binding.markerId}"`
      const markerStart = template.indexOf(marker)
      if (markerStart < 0) {
        throw new Error(
          `compile: SSR could not locate dynamic attribute marker ${binding.markerId} (scope limit)`,
        )
      }
      const tagEnd = template.indexOf('>', markerStart)
      if (tagEnd < 0) {
        throw new Error(
          `compile: SSR could not locate dynamic attribute host for ${binding.markerId} (scope limit)`,
        )
      }
      const expression =
        attrBindingKind(binding.name) === 'boolProp'
          ? `\${(${binding.sourceRendered}) ? " ${binding.name}" : ""}`
          : ` ${binding.name}="\${__escAttr__(${binding.sourceRendered})}"`
      template = `${template.slice(0, tagEnd)}${expression}${template.slice(tagEnd)}`
    }

    for (const marker of body.localMarkers) {
      if (marker.kind === 'text') continue
      const anchor = structuralAnchor(marker.id)
      if (!template.includes(anchor)) continue
      template = template.replace(anchor, renderSsrUnitExpression(marker))
    }
    return template
  }

  const renderSsrUnitExpression = (marker: ListMarkerOutput | ConditionalMarkerOutput): string => {
    if (marker.kind === 'list') {
      const body = renderSsrBody(marker.body)
      const declarations = renderSsrLocalDecls(marker.body.localDecls)
      const start = `<!--irisout:start:${marker.id}-->`
      const end = `<!--irisout:end:${marker.id}-->`
      return `\${(() => { const __items__ = (${marker.arraySourceRendered}).map((${marker.itemParam}) => { ${declarations.join(' ')} return \`${body}\`; }).join(''); return \`${start}\${__items__}${end}\`; })()}`
    }

    const branch = (index: number): { body: string; declarations: string[] } | null => {
      const branchBody = marker.branches[index]?.body
      if (!branchBody) return null
      return {
        body: renderSsrBody(branchBody),
        declarations: renderSsrLocalDecls(branchBody.localDecls),
      }
    }
    const yes = branch(0)
    const no = marker.isLogical ? null : branch(1)
    const start = `<!--irisout:start:${marker.id}-->`
    const end = `<!--irisout:end:${marker.id}-->`
    const yesCode = yes
      ? `{ ${yes.declarations.join(' ')} return \`${start}\${(() => \`${yes.body}\`)()}${end}\`; }`
      : `{ return \`${start}${end}\`; }`
    const noCode = no
      ? `{ ${no.declarations.join(' ')} return \`${start}\${(() => \`${no.body}\`)()}${end}\`; }`
      : `{ return \`${start}${end}\`; }`
    return `\${(() => { if (${marker.condSourceRendered}) ${yesCode} else ${noCode} })()}`
  }

  // TypeScriptのconst初期化順に依存せず再帰参照できるよう、unit expressionの
  // 関数宣言を先に定義してからroot templateを置換する。
  const ssrHtmlSource = (() => {
    let template = rootHtmlSource
    for (const marker of markerOutputs) {
      if (marker.kind !== 'list' && marker.kind !== 'conditional') continue
      template = template.replace(structuralAnchor(marker.id), renderSsrUnitExpression(marker))
    }
    return template
  })()

  // ADR-0011/ADR-0020: writeDeclIds は analyze.ts 側で既に root signal へ
  // 推移解決済み(analyzeActionIdentifier)なので、ここでは共有markerの有無に
  // 応じて個別updateまたはbatch文へ変換するだけでよい。action本体・返り値
  // クロージャの最終テキストは signalToMarkers 確定後にしか組み立てられない。
  const actionOutputs: ActionOutput[] = ctx.actions.map((a) => convertAction(a))

  // ADR-0025: onMount callback本体だけはcomponent mount直後の更新を許し、
  // cleanup本体へは更新呼び出しを挿入しない。root component専用なので
  // structural unitのlocal scope変換は不要である。
  const mountOutputs: MountOutput[] = ctx.mounts.map((m: MountDecl) => convertMount(m))
  const effectOutputs: EffectOutput[] = ctx.effects.map((effect) => ({
    bodyRendered: effect.finalizeBody(resolveUpdateCall),
    cleanupRendered: effect.finalizeCleanup ? effect.finalizeCleanup() : null,
    bodySourceStart: effect.bodySourceStart,
    cleanupSourceStart: effect.cleanupSourceStart,
    signalIds: [
      ...new Set(
        [...effect.readDeclIds].flatMap((dep) => [...resolveToSignals(ctx, dep, new Set())]),
      ),
    ],
  }))

  // --- client用ビルド時実行: discoveryの確認 + 実際の初期HTMLの取得 ---
  // SSRは要求入力なしの実行を行わない。必須入力を空objectで実行すると、
  // `title.toUpperCase()`等がコンパイル時に失敗するため、SSRの初期HTMLは
  // 要求時のssrCodeだけから生成する。
  let initialHtml = ''
  if (options.target !== 'ssr') {
    const inputPrelude = inputPattern ? `const ${inputPattern} = __input__;` : ''
    const instrumentedBody = [
      inputPrelude,
      ...(options.supportStatements ?? []),
      ...ctx.sharedDecls.map((decl) => {
        if (decl.kind === 'signal') {
          return `const ${decl.outputName} = signal(${decl.sourceRendered}, ${JSON.stringify(decl.id)});`
        }
        if (decl.kind === 'derived') {
          return `const ${decl.outputName} = derived(${decl.sourceRendered}, ${JSON.stringify(decl.id)});`
        }
        throw new Error(`compile: unsupported shared declaration kind ${decl.kind}`)
      }),
      ...out.instrumentedDeclStatements,
      `return \`${rootHtmlSource}\`;`,
    ].join('\n')
    // __esc__: テキストマーカー式値のテキストノード文脈エスケープ
    // (escape-initial-html design D2)。テキストノードなので `&` と `<` で十分。
    // __escAttr__: 動的属性の初期値焼き込み用の属性文脈エスケープ(ADR-0012
    // 決定3 — 二重引用符で囲むため `&` と `"`)。
    const runComponent = new Function(
      'signal',
      'derived',
      '__esc__',
      '__escAttr__',
      '__input__',
      instrumentedBody,
    ) as (
      signalFn: typeof signal,
      derivedFn: typeof derived,
      escFn: (v: unknown) => string,
      escAttrFn: (v: unknown) => string,
      input: unknown,
    ) => string
    const escapeTextValue = (v: unknown): string =>
      String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    const escapeAttrTextValue = (v: unknown): string =>
      String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    // 構文検査(assertTopLevelShape / render.ts の scope limit 群)をすり抜けた
    // 未知の経路が残っても、生の実行時エラーではなく「コンパイルの失敗」として
    // 報告する安全網(scope-limit-coverage design D3)。元エラーは cause に保持。
    try {
      initialHtml = runComponent(signal, derived, escapeTextValue, escapeAttrTextValue, {})
    } catch (e) {
      throw new Error(
        `compile: build-time execution failed: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e },
      )
    }

    // same-file-component-composition: ローカルsignal(構造ユニットへ
    // インライン化されたコンポーネントの変数ゾーン宣言)は、コンテナが
    // 初期HTMLで空のまま焼かれる(design.md D5)ためビルド時実行の対象に
    // ならず、registry には現れない。discovery check の対象外にする。
    for (const [id, kind] of ctx.declKind) {
      if (ctx.localDeclIds.has(id)) continue
      const entry = registry.get(id)
      if (!entry || entry.kind !== kind) {
        throw new Error(
          `compile: expected "${ctx.declOutputName.get(id)}" to be a ${kind}() call (ADR-0001 #3 discovery check)`,
        )
      }
    }
  }

  // cross-function-handler-writes: 追跡された動きゾーン関数を emit 用の素の
  // 文字列へ落とす(Map の挿入順 = 追跡順で1回ずつ)。
  const emittedFns = [...ctx.trackedFns.values()].map((f) => ({
    name: f.name,
    params: f.paramSource,
    body: f.rendered,
    async: f.async,
  }))
  const signalState =
    options.target === 'ssr'
      ? [...ctx.declKind]
          .filter(([id, kind]) => kind === 'signal' && !ctx.localDeclIds.has(id))
          .map(([id]) => ({ id, outputName: ctx.declOutputName.get(id)! }))
      : []

  const markedCode = generateModule({
    supportStatements: options.supportStatements ?? [],
    externalImports: options.externalImports ?? [],
    sharedStatements: ctx.sharedDecls
      .filter((decl) => decl.kind === 'signal' && ctx.usedSharedDeclIds.has(decl.id))
      .map((decl) => `const ${decl.outputName} = __sharedSignal__(${decl.rendered});`),
    sharedDerivedStatements: ctx.sharedDecls
      .filter((decl) => decl.kind === 'derived' && ctx.usedSharedDeclIds.has(decl.id))
      .map((decl) => `const ${decl.outputName} = ${decl.rendered};`),
    sharedCollectionStatements: [],
    sharedSignalNames: [...signalToMarkers.keys()]
      .filter((id) => ctx.sharedDeclIds.has(id) && ctx.declKind.get(id) === 'signal')
      .map((id) => ctx.declOutputName.get(id)!)
      .filter((name): name is string => name != null),
    sharedCollectionNames: [],
    sharedDerivedIds: new Set(
      [...ctx.sharedDeclIds].filter((id) => ctx.declKind.get(id) === 'derived'),
    ),
    declStatements: out.declStatements,
    markers: markerOutputs,
    signalToMarkers,
    updateBatches,
    declOutputName: ctx.declOutputName,
    derivedDeps: ctx.derivedDeps,
    derivedRecompute: ctx.derivedRecompute,
    collectionKeyRendered: new Map(),
    handlers: handlerOutputs,
    actions: actionOutputs,
    mounts: mountOutputs,
    effects: effectOutputs,
    attrBindings: ctx.attrBindings,
    emittedFns,
    initialHtml,
    inputPattern: options.target === 'ssr' ? inputPattern : null,
    signalState,
    ssrHydration: options.target === 'ssr',
  })
  const { code, map } = finalizeSourceMap(markedCode, {
    filePath: options.sourceMapFilePath ?? '<source>',
    source,
    origins: options.sourceMapOrigins,
  })

  const ssrCode =
    options.target === 'ssr'
      ? generateSsrModule({
          externalImports: options.externalImports ?? [],
          supportStatements: options.supportStatements ?? [],
          inputPattern,
          instrumentedDeclStatements: out.instrumentedDeclStatements,
          rootHtmlSource: ssrHtmlSource,
        })
      : undefined

  return {
    code,
    map,
    initialHtml,
    ssrCode,
    markers: ctx.markers,
    signalToMarkers,
    declName: ctx.declOutputName,
    dependencies: options.dependencies ?? [],
  }
}

export function compile(source: string): CompileResult {
  try {
    return compileSource(source)
  } catch (error) {
    throw withCompileDiagnostic(error, { filePath: '<source>', source })
  }
}

/** 単一sourceをブラウザ内で変換する。Nodeのファイル機能は使わない。 */
export function compileBrowser(source: string): CompileResult {
  try {
    return compileSource(source, { browser: true })
  } catch (error) {
    throw withCompileDiagnostic(error, { filePath: '<source>', source })
  }
}

export function compileSSR(source: string): CompileResult {
  try {
    return compileSource(source, { target: 'ssr' })
  } catch (error) {
    throw withCompileDiagnostic(error, { filePath: '<source>', source })
  }
}
