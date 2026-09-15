// authored JSXの`irisout` importをコンパイル前に取り除く。
// authoring APIは生成物の実行時依存ではないため、通常の外部module importとして
// linkerへ渡すと、ビルド時実行と生成moduleの両方で誤った束縛になる。

import type { NodePath } from '@babel/traverse'
import traverseImport from '@babel/traverse'
import type * as t from '@babel/types'

const traverse =
  (traverseImport as unknown as { default?: typeof traverseImport }).default ?? traverseImport

const AUTHORING_NAMES = new Set([
  'signal',
  'derived',
  'render',
  'onMount',
  'effect',
  'createContext',
  'createAsyncContext',
  'provideContext',
  'useContext',
])

function importedName(node: t.Identifier | t.StringLiteral): string {
  return node.type === 'Identifier' ? node.name : node.value
}

function programPathOf(ast: t.File): NodePath<t.Program> {
  let result: NodePath<t.Program> | null = null
  traverse(ast, {
    Program(path: NodePath<t.Program>) {
      result = path
      path.stop()
    },
  })
  if (!result) throw new Error('compile: failed to inspect authoring imports (scope limit)')
  return result
}

/**
 * `irisout`からのauthoring API importだけを消し、別名は既存解析が認識する名前へ戻す。
 * ルート入口以外のimportはmodule linkerまたはbrowser境界の責務なので触らない。
 */
export function stripAuthoringImports(ast: t.File): void {
  const statements = ast.program.body.filter(
    (statement): statement is t.ImportDeclaration =>
      statement.type === 'ImportDeclaration' && statement.source.value === 'irisout',
  )
  if (statements.length === 0) return

  const programPath = programPathOf(ast)
  programPath.scope.crawl()
  const renames: { local: string; imported: string }[] = []

  for (const statement of statements) {
    if (statement.importKind === 'type' || statement.specifiers.length === 0) {
      throw new Error(
        'compile: `irisout` authoring imports must use named value bindings (scope limit)',
      )
    }
    for (const specifier of statement.specifiers) {
      if (specifier.type !== 'ImportSpecifier' || specifier.importKind === 'type') {
        throw new Error(
          'compile: `irisout` authoring imports do not support default or namespace bindings (scope limit)',
        )
      }
      const name = importedName(specifier.imported)
      if (!AUTHORING_NAMES.has(name)) {
        throw new Error('compile: `' + name + '` is not an irisout authoring API (scope limit)')
      }
      const local = specifier.local.name
      const binding = programPath.scope.getBinding(local)
      if (!binding || binding.path.node !== specifier) {
        throw new Error('compile: failed to resolve irisout authoring import `' + local + '`')
      }
      if (local !== name) {
        const collision = programPath.scope.getOwnBinding(name)
        if (collision && collision !== binding) {
          throw new Error(
            'compile: irisout authoring import `' +
              local +
              '` conflicts with top-level binding `' +
              name +
              '` (scope limit)',
          )
        }
        renames.push({ local, imported: name })
      }
    }
  }

  for (const { local, imported } of renames) {
    programPath.scope.crawl()
    programPath.scope.rename(local, imported)
  }

  ast.program.body = ast.program.body.filter(
    (statement) =>
      !(statement.type === 'ImportDeclaration' && statement.source.value === 'irisout'),
  )
}
