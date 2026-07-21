// same-file-component-composition(ADR-0014): 同一ファイル内の`<Component/>`
// JSXタグ参照を、コンパイル時ASTインライン化する前処理パス。
// `compile()`から`assertTopLevelShape`の直後・`findRootComponent`の前に
// 呼ぶ(design.md D1)。この段階が終われば、以後の`findRootComponent`/
// `compileComponent`/`renderElement`はコンポーネントという概念を一切
// 知らないまま、単一コンポーネントとして書かれたAST同様に動く。

import type { NodePath } from '@babel/traverse'
import traverseImport from '@babel/traverse'
import * as t from '@babel/types'
import type { HandlerFns } from './render.js'
import { renderCallJsx, splitComponentZones } from './render.js'

const traverse =
  (traverseImport as unknown as { default?: typeof traverseImport }).default ??
  traverseImport

// `t.cloneNode`はASTノード構造は正しく複製するが、`.loc`は保持する一方
// `.start`/`.end`(数値オフセット)は複製しない(@babel/types実装の既定
// 挙動)。このコンパイラはanalyze.tsの`render()`が`ctx.source.slice(start,
// end)`で本番/ビルド時実行向けのソース断片を組み立てる方式のため、
// `start`/`end`を欠いたクローンをそのまま使うと`slice(undefined,
// undefined)`(=ソース全文)が埋め込まれる不具合になる(実装前調査で
// 確認済み)。クローン後にオリジナルと同じ形の木を並行に辿り、`start`/
// `end`/`loc`を明示的にコピーする。
function copyPositionsDeep(clone: unknown, original: unknown): void {
  if (
    !clone ||
    !original ||
    typeof clone !== 'object' ||
    typeof original !== 'object'
  )
    return
  if (Array.isArray(clone) && Array.isArray(original)) {
    for (let i = 0; i < clone.length; i++)
      copyPositionsDeep(clone[i], original[i])
    return
  }
  const c = clone as Record<string, unknown>
  const o = original as Record<string, unknown>
  if (typeof o.type === 'string') {
    c.start = o.start
    c.end = o.end
    c.loc = o.loc
  }
  for (const key of Object.keys(o)) {
    if (key === 'start' || key === 'end' || key === 'loc') continue
    const ov = o[key]
    if (ov && typeof ov === 'object') copyPositionsDeep(c[key], ov)
  }
}

function cloneWithPositions<T extends t.Node>(node: T): T {
  const cloned = t.cloneNode(node, true) as T
  copyPositionsDeep(cloned, node)
  return cloned
}

// Program直下のコンポーネント(関数宣言)を名前で集める。findRootComponentの
// ルート探索とインライン化パスの両方が使う共有ロジック(task 1.1)。
export function collectTopLevelComponents(
  ast: t.File,
): Map<string, NodePath<t.FunctionDeclaration>> {
  const componentsByName = new Map<string, NodePath<t.FunctionDeclaration>>()
  traverse(ast, {
    FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
      if (
        (path.parentPath.isProgram() ||
          path.parentPath.isExportNamedDeclaration()) &&
        path.node.id
      ) {
        componentsByName.set(path.node.id.name, path)
      }
    },
  })
  return componentsByName
}

// componentsByNameの各本体をJSXタグ参照で走査し、他から参照されている
// 名前の集合を返す(findRootComponentの「誰からも参照されない=root」判定と
// 同じスキャン)。
function findReferencedComponentNames(
  componentsByName: Map<string, NodePath<t.FunctionDeclaration>>,
): Set<string> {
  const referenced = new Set<string>()
  for (const path of componentsByName.values()) {
    path.traverse({
      JSXOpeningElement(jsxPath: NodePath<t.JSXOpeningElement>) {
        const name = jsxPath.node.name
        if (name.type === 'JSXIdentifier' && componentsByName.has(name.name)) {
          referenced.add(name.name)
        }
      },
    })
  }
  return referenced
}

function hasMeaningfulChildren(node: t.JSXElement): boolean {
  return node.children.some((child) =>
    child.type === 'JSXText' ? child.value.trim() !== '' : true,
  )
}

// same-file-component-composition design D3: 呼び出し先のObjectPattern
// 仮引数(shorthandのみ)から、プロパティ名→呼び出し箇所の実引数式の対応を
// 作り、クローン済み本体(まだ実木に挿入されておりBabel scopeが有効)の
// パラメータ参照だけを実引数式のクローンで置換する。シャドーイングされた
// 同名ローカル変数は(Babelのbinding解決により)対象に含まれない。
function substituteProps(
  clonedFnPath: NodePath<t.FunctionDeclaration>,
  jsxPath: NodePath<t.JSXElement>,
  tagName: string,
): void {
  const params = clonedFnPath.get('params')
  if (params.length === 0) return
  const propParam = params[0]!
  if (params.length > 1 || !propParam.isObjectPattern()) {
    throw new Error(
      `compile: component "${tagName}" props must be a single destructured parameter (scope limit)`,
    )
  }

  const propNames: string[] = []
  for (const propPath of propParam.get('properties')) {
    if (!propPath.isObjectProperty() || propPath.node.computed) {
      throw new Error(
        `compile: component "${tagName}" only supports shorthand destructured props (scope limit)`,
      )
    }
    const keyNode = propPath.node.key
    const valueNode = propPath.node.value
    if (
      keyNode.type !== 'Identifier' ||
      valueNode.type !== 'Identifier' ||
      keyNode.name !== valueNode.name
    ) {
      throw new Error(
        `compile: component "${tagName}" only supports shorthand destructured props like \`{ todo }\` (scope limit)`,
      )
    }
    propNames.push(keyNode.name)
  }

  const argExprByProp = new Map<string, t.Expression>()
  for (const attrPath of jsxPath.get('openingElement').get('attributes')) {
    if (!attrPath.isJSXAttribute()) {
      throw new Error(
        `compile: spread props on "${tagName}" are not supported yet (scope limit)`,
      )
    }
    const nameNode = attrPath.node.name
    if (nameNode.type !== 'JSXIdentifier') continue
    const valueNode = attrPath.node.value
    if (valueNode == null) {
      argExprByProp.set(nameNode.name, t.booleanLiteral(true))
    } else if (valueNode.type === 'StringLiteral') {
      argExprByProp.set(nameNode.name, valueNode)
    } else if (valueNode.type === 'JSXExpressionContainer') {
      if (valueNode.expression.type === 'JSXEmptyExpression') continue
      argExprByProp.set(nameNode.name, valueNode.expression as t.Expression)
    } else {
      throw new Error(
        `compile: unsupported prop value form on "${tagName}" (scope limit)`,
      )
    }
  }

  for (const propName of propNames) {
    if (!argExprByProp.has(propName)) {
      throw new Error(
        `compile: missing prop "${propName}" for component reference "${tagName}" (scope limit)`,
      )
    }
  }

  // 1つ前のprop置換によるreplaceWithがscope情報を古くする(実装前調査で
  // 確認した既知のパターン ― 別のバインディングのreferencePathsが古い
  // ままになり、置換漏れになる)ため、propごとに再クロールしてから
  // 参照を引く。
  for (const propName of propNames) {
    clonedFnPath.scope.crawl()
    const argNode = argExprByProp.get(propName)!
    const binding = clonedFnPath.scope.getOwnBinding(propName)
    if (!binding) continue
    for (const refPath of [...binding.referencePaths]) {
      refPath.replaceWith(cloneWithPositions(argNode))
    }
  }
}

// ADR-0014決定5: ルートスコープへインライン化するsignal/derived宣言のうち、
// 呼び出し元(componentPath)の既存の識別子と実際に衝突するものだけを
// コンポーネント名で接頭辞化してリネームする(衝突しなければ素の名前の
// まま)。実装前調査で判明: 2つの別コンポーネントが同名のsignalを持つ場合、
// リネーム無しで両方をそのまま挿入すると同一scope内の`const`重複宣言に
// なり、Babelのscope crawlが正当に構文エラー相当として拒否する
// (`assignOutputName`の出力名dedupは"出力変数名"のレベルの話であり、
// この"AST自体が二重constで無効になる"問題は解決しない)。
function renameCollidingRootDecls(
  clonedFnPath: NodePath<t.FunctionDeclaration>,
  varZoneStmts: NodePath<t.Statement>[],
  componentPath: NodePath<t.FunctionDeclaration>,
  tagName: string,
): void {
  componentPath.scope.crawl()
  // clonedFnPathの scope は substituteProps 以降の生ノード置換で古くなって
  // いる可能性がある(実装前調査で確認した既知のパターン)。rename()は
  // 対象bindingの参照一覧をscope crawl時点の情報から引くため、リネーム
  // 漏れ(JSX式コンテナ内の参照など)を防ぐにはここで明示的に再クロールする。
  clonedFnPath.scope.crawl()
  for (const stmt of varZoneStmts) {
    if (!stmt.isVariableDeclaration()) continue
    for (const declaratorPath of stmt.get('declarations')) {
      const idNode = declaratorPath.node.id
      if (idNode.type !== 'Identifier') continue
      const name = idNode.name
      if (!componentPath.scope.getOwnBinding(name)) continue
      let candidate = `${tagName}_${name}`
      let n = 1
      while (componentPath.scope.getOwnBinding(candidate)) {
        candidate = `${tagName}_${name}$${n++}`
      }
      clonedFnPath.scope.rename(name, candidate)
      componentPath.scope.crawl()
    }
  }
}

// ADR-0014決定5: 動きゾーンのfunction宣言名も同じ規則(検出時のみ
// コンポーネント名で接頭辞化してリネーム)を適用する。動きゾーン関数の
// バインディングもclonedFnPath自身のスコープにあるため、
// renameCollidingRootDeclsと同じくclonedFnPath.scope.rename()で本体内の
// 参照(ハンドラ識別子参照含む)も追随させる。
function renameCollidingMovementFns(
  clonedFnPath: NodePath<t.FunctionDeclaration>,
  movementZoneFns: HandlerFns,
  componentPath: NodePath<t.FunctionDeclaration>,
  tagName: string,
): void {
  componentPath.scope.crawl()
  clonedFnPath.scope.crawl()
  for (const name of [...movementZoneFns.keys()]) {
    if (!componentPath.scope.getOwnBinding(name)) continue
    let candidate = `${tagName}_${name}`
    let n = 1
    while (componentPath.scope.getOwnBinding(candidate)) {
      candidate = `${tagName}_${name}$${n++}`
    }
    clonedFnPath.scope.rename(name, candidate)
    componentPath.scope.crawl()
  }
}

// componentPathの現在のvar zone文の中からrender()文を探す(呼び出し箇所は
// root scopeにある限り必ずrender()のJSX引数木の中にあるので、そこがvar
// zone宣言の挿入位置になる)。
function findRenderStmt(
  componentPath: NodePath<t.FunctionDeclaration>,
): NodePath<t.Statement> {
  const stmts = componentPath.get('body.body') as NodePath<t.Statement>[]
  for (const stmt of stmts) {
    if (renderCallJsx(stmt)) return stmt
  }
  throw new Error(
    'compile: a component must contain a render(<JSX>) call (scope limit)',
  )
}

// jsxPathの祖先を遡り、`.map((item) => ...)`のarrow関数(構造ユニット)に
// 包まれているかを判定する。他の関数境界(ハンドラのinline arrow・
// コンポーネント自身の関数宣言)に先に当たれば null(root scope 扱い)。
// same-file-component-compositionのローカルsignalはlist itemでのみ
// サポートするため(render.ts参照)、conditional branchは対象外のまま。
function findEnclosingListItemArrow(
  jsxPath: NodePath<t.JSXElement>,
): NodePath<t.ArrowFunctionExpression> | null {
  let current: NodePath<t.Node> | null = jsxPath.parentPath
  while (current) {
    if (current.isArrowFunctionExpression()) {
      const parent = current.parentPath
      if (
        parent?.isCallExpression() &&
        parent.node.arguments[0] === current.node
      ) {
        const callee = parent.get('callee')
        if (
          callee.isMemberExpression() &&
          !callee.node.computed &&
          callee.get('property').isIdentifier({ name: 'map' })
        ) {
          return current
        }
      }
      return null
    }
    if (current.isFunctionDeclaration() || current.isFunctionExpression()) {
      return null
    }
    current = current.parentPath
  }
  return null
}

// jsxPathの祖先を、関数境界に当たる前まで遡り、三項/`&&`の条件分岐ブランチ
// (ConditionalExpressionのconsequent/alternate、LogicalExpressionの右辺)
// に包まれているかを判定する。findEnclosingListItemArrowがnullを返した後
// (=list itemではない)にだけ呼ぶ ― 変数ゾーン宣言を持つコンポーネントを
// 条件分岐ブランチへインライン化すると、ローカルsignalにすべき宣言が
// ルートスコープへ静かに昇格してしまう(実装前調査で確認した不具合:
// 三項/`&&`の式位置はブロック文を構文的に置けずローカルsignal化できない
// ため、render.tsのresolveUnitBodySourceによる受理もできない ―
// list item同様に安全な受け皿がないので明示的に拒否する必要がある)。
function isInsideConditionalBranch(jsxPath: NodePath<t.JSXElement>): boolean {
  let current: NodePath<t.Node> | null = jsxPath.parentPath
  while (current) {
    if (
      current.isConditionalExpression() ||
      (current.isLogicalExpression() && current.node.operator === '&&')
    ) {
      return true
    }
    if (
      current.isArrowFunctionExpression() ||
      current.isFunctionDeclaration() ||
      current.isFunctionExpression()
    ) {
      return false
    }
    current = current.parentPath
  }
  return false
}

// list item arrowの現在の本体(bare JSXまたは既存のblock)をblockに変換
// (未変換なら)し、そのblockのNodePathを返す。render.tsの
// resolveUnitBodySource が受理する形(signal/derived宣言 + 最終return)を
// 維持する。
function ensureUnitArrowBlockBody(
  arrowPath: NodePath<t.ArrowFunctionExpression>,
): NodePath<t.BlockStatement> {
  const bodyPath = arrowPath.get('body')
  if (bodyPath.isBlockStatement()) return bodyPath
  bodyPath.replaceWith(t.blockStatement([t.returnStatement(bodyPath.node)]))
  return arrowPath.get('body') as NodePath<t.BlockStatement>
}

function expandComponentRef(
  jsxPath: NodePath<t.JSXElement>,
  componentsByName: Map<string, NodePath<t.FunctionDeclaration>>,
  visited: Set<string>,
  componentPath: NodePath<t.FunctionDeclaration>,
): void {
  const opening = jsxPath.node.openingElement
  if (opening.name.type !== 'JSXIdentifier') return
  const tagName = opening.name.name
  if (!/^[A-Z]/.test(tagName)) return
  const targetPath = componentsByName.get(tagName)
  if (!targetPath) return // 未解決の参照 ― render.tsの既存scope limitに委ねる

  if (hasMeaningfulChildren(jsxPath.node)) {
    throw new Error(
      `compile: component children (<${tagName}>...</${tagName}>) are not supported yet (scope limit)`,
    )
  }
  if (visited.has(tagName)) {
    throw new Error(
      `compile: recursive component reference "${tagName}" is not supported yet (scope limit)`,
    )
  }

  // props置換にBabel scopeのbinding解決を使うため、対象本体をProgram直下へ
  // 実際に(一時的に)挿入してから操作する(scopeはNodePathが実木に
  // 属していないと正しく引けない)。
  const [clonedFnPath] = targetPath.insertAfter(
    cloneWithPositions(targetPath.node),
  ) as [NodePath<t.FunctionDeclaration>]
  substituteProps(clonedFnPath, jsxPath, tagName)
  const zones = splitComponentZones(clonedFnPath)

  const enclosingArrow = findEnclosingListItemArrow(jsxPath)
  // 呼び出し箇所そのものがarrow本体全体(concise body)である場合、
  // ensureUnitArrowBlockBodyのreplaceWithがjsxPathの指すノードを直接
  // 書き換える(jsxPathとarrow本体pathは同一ノードを指すため)。その場合
  // jsxPathは古いノード参照のまま残り、最終的なreplaceWithが「今しがた
  // 包んだblock全体」を上書きしてしまい、挿入したローカル宣言ごと消える
  // (実装前調査で確認したバグ)。ブロック変換後にJSXの新しい位置
  // (returnの引数)を明示的に取り直し、以降はそちらを使う。
  const jsxIsWholeArrowBody =
    enclosingArrow != null && enclosingArrow.get('body').node === jsxPath.node

  let finalJsxPath: NodePath<t.JSXElement>
  if (enclosingArrow) {
    // 構造ユニット(list item)へのインライン化: 変数ゾーン宣言は
    // ローカルsignalになる(design.md D5、render.tsのresolveUnitBodySource
    // が処理する形)。動きゾーン関数を持つコンポーネントをここへインライン
    // 化することは今回のスコープ外(検証対象では発生しない組み合わせ)。
    if (zones.movementZoneFns.size > 0) {
      clonedFnPath.remove()
      throw new Error(
        `compile: inlining component "${tagName}" with its own handler functions into a list item is not supported yet (scope limit)`,
      )
    }
    const varZoneNodes = zones.varZoneStmts.map((s) => s.node)
    const renderJsxNode = zones.renderJsxPath.node
    clonedFnPath.remove()

    const blockPath = ensureUnitArrowBlockBody(enclosingArrow)
    if (varZoneNodes.length > 0) {
      blockPath.unshiftContainer('body', varZoneNodes)
    }
    if (jsxIsWholeArrowBody) {
      const stmts = blockPath.get('body') as NodePath<t.Statement>[]
      const returnStmt = stmts[stmts.length - 1] as NodePath<t.ReturnStatement>
      finalJsxPath = returnStmt.get('argument') as NodePath<t.JSXElement>
    } else {
      finalJsxPath = jsxPath
    }
    finalJsxPath.replaceWith(renderJsxNode)
  } else {
    // ルートスコープへのインライン化。呼び出し箇所が条件分岐ブランチの中
    // (list itemではない)にあり、かつ対象コンポーネントが変数ゾーン宣言を
    // 持つ場合、それはローカルsignalになるべきだが受け皿がない(三項/`&&`
    // の式位置はブロック文を構文的に置けない)。黙ってルートスコープへ
    // 昇格させると壊れた挙動(本来インスタンスごとのはずの状態がモジュール
    // スコープで共有される)になるため、明示的に拒否する。
    if (zones.varZoneStmts.length > 0 && isInsideConditionalBranch(jsxPath)) {
      clonedFnPath.remove()
      throw new Error(
        `compile: inlining component "${tagName}" with its own variable-zone declarations into a conditional branch is not supported yet (scope limit)`,
      )
    }

    // signal/derived宣言名・動きゾーン関数名の衝突は、検出時のみ
    // コンポーネント名で接頭辞化してリネームする(ADR-0014決定5)。
    renameCollidingRootDecls(
      clonedFnPath,
      zones.varZoneStmts,
      componentPath,
      tagName,
    )
    renameCollidingMovementFns(
      clonedFnPath,
      zones.movementZoneFns,
      componentPath,
      tagName,
    )
    const varZoneNodes = zones.varZoneStmts.map((s) => s.node)
    const movementFnNodes = [...zones.movementZoneFns.values()].map(
      (p) => p.node,
    )
    const renderJsxNode = zones.renderJsxPath.node
    clonedFnPath.remove()

    if (varZoneNodes.length > 0) {
      findRenderStmt(componentPath).insertBefore(varZoneNodes)
    }
    if (movementFnNodes.length > 0) {
      componentPath.get('body').pushContainer('body', movementFnNodes)
    }
    finalJsxPath = jsxPath
    finalJsxPath.replaceWith(renderJsxNode)
  }

  // 展開後の内容にさらにコンポーネント参照が残っていれば再帰的に展開する
  // (呼び出し先が別のコンポーネントを参照するケース)。`.traverse()`は
  // descendantsだけを訪問し、path自身のnodeは対象にしない ―
  // renderJsxNodeがそれ自体1つの`<OtherComponent/>`である場合(例:
  // `render(<B/>)`だけの本体)、descendantsは無く.traverse()は何も
  // 見つけないため、finalJsxPath自身に対しても明示的にexpandComponentRef
  // を呼ぶ必要がある(実装前調査で相互再帰の検出漏れとして確認)。
  // expandComponentRefは非コンポーネントタグに対しては早期returnで
  // 安全にno-opする。`.skip()`は「以後このpathへの.traverse()は何も
  // visitしない」フラグなので、自分自身の再帰呼び出しより後に呼ぶ
  // (先に呼ぶと再帰も無効化してしまう)。
  const newVisited = new Set(visited)
  newVisited.add(tagName)
  expandComponentRef(finalJsxPath, componentsByName, newVisited, componentPath)
  finalJsxPath.traverse({
    JSXElement(p) {
      expandComponentRef(p, componentsByName, newVisited, componentPath)
    },
  })
  finalJsxPath.skip()
}

export function inlineComponents(ast: t.File): void {
  const componentsByName = collectTopLevelComponents(ast)
  const referencedNames = findReferencedComponentNames(componentsByName)

  for (const [name, path] of componentsByName) {
    path.traverse({
      JSXElement(p) {
        expandComponentRef(p, componentsByName, new Set([name]), path)
      },
    })
  }

  // インライン化済みの子コンポーネントの元宣言は、findRootComponentの
  // 再走査時に「誰からも参照されない」ものとして誤ってroot候補に混ざらない
  // よう取り除く(ADR-0014コンテキスト: 子コンポーネントは自動的にroot
  // 候補から除外される、という前提を維持する)。
  for (const name of referencedNames) {
    componentsByName.get(name)!.remove()
  }

  // Babelのscope情報はノードごとに遅延キャッシュされ、unshiftContainer/
  // insertBefore/replaceWithによる生ノード挿入では自動的に無効化されない
  // (実装前調査で確認: ローカルsignalの宣言を挿入した後もresolveDeclId
  // (analyze.ts)がidPath.scope.getBinding()で見つけられず、追跡対象読み書き
  // が素通りしてしまう不具合があった)。以後のcompileComponent/analyze.tsが
  // 正しくbindingを解決できるよう、ここでファイル全体のscopeを強制的に
  // 再クロールする。
  traverse(ast, {
    Program(path: NodePath<t.Program>) {
      path.scope.crawl()
    },
  })
}
