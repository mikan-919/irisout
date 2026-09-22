// TypeScriptの型だけをmodule linkerのASTから除去する。
// 実行時JavaScriptを生成するenumやnamespaceは扱わず、明示的に拒否する。

import type { NodePath } from '@babel/traverse'
import traverseImport from '@babel/traverse'
import type * as t from '@babel/types'

const traverse =
  (traverseImport as unknown as { default?: typeof traverseImport }).default ?? traverseImport

function scopeLimit(name: string): Error {
  return new Error(`compile: TypeScript ${name} is not supported yet (scope limit)`)
}

/** module linkerが扱う前に、実行時に消えるTypeScript構文をASTから除去する。 */
export function stripTypeScript(ast: t.File): void {
  traverse(ast, {
    ImportDeclaration(path: NodePath<t.ImportDeclaration>) {
      if (path.node.importKind === 'type') {
        path.remove()
        return
      }
      const hadSpecifiers = path.node.specifiers.length > 0
      path.node.specifiers = path.node.specifiers.filter(
        (specifier) => specifier.type !== 'ImportSpecifier' || specifier.importKind !== 'type',
      )
      if (hadSpecifiers && path.node.specifiers.length === 0) path.remove()
    },
    ExportNamedDeclaration(path: NodePath<t.ExportNamedDeclaration>) {
      if (path.node.exportKind === 'type') {
        path.remove()
        return
      }
      path.node.specifiers = path.node.specifiers.filter(
        (specifier) => specifier.type !== 'ExportSpecifier' || specifier.exportKind !== 'type',
      )
      if (!path.node.declaration && path.node.specifiers.length === 0) path.remove()
    },
    TSInterfaceDeclaration(path: NodePath<t.TSInterfaceDeclaration>) {
      path.remove()
    },
    TSTypeAliasDeclaration(path: NodePath<t.TSTypeAliasDeclaration>) {
      path.remove()
    },
    TSDeclareFunction(path: NodePath<t.TSDeclareFunction>) {
      path.remove()
    },
    TSEnumDeclaration() {
      throw scopeLimit('enum')
    },
    TSModuleDeclaration() {
      throw scopeLimit('namespace')
    },
    Identifier(path: NodePath<t.Identifier>) {
      path.node.typeAnnotation = null
      path.node.optional = null
    },
    RestElement(path: NodePath<t.RestElement>) {
      path.node.typeAnnotation = null
    },
    ObjectPattern(path: NodePath<t.ObjectPattern>) {
      path.node.typeAnnotation = null
    },
    ArrayPattern(path: NodePath<t.ArrayPattern>) {
      path.node.typeAnnotation = null
    },
    Function(path: NodePath<t.Function>) {
      path.node.returnType = null
      path.node.typeParameters = null
    },
    CallExpression(path: NodePath<t.CallExpression>) {
      path.node.typeArguments = null
    },
    NewExpression(path: NodePath<t.NewExpression>) {
      path.node.typeArguments = null
    },
    JSXOpeningElement(path: NodePath<t.JSXOpeningElement>) {
      path.node.typeArguments = null
    },
    TSAsExpression(path: NodePath<t.TSAsExpression>) {
      path.replaceWith(path.node.expression)
    },
    TSTypeAssertion(path: NodePath<t.TSTypeAssertion>) {
      path.replaceWith(path.node.expression)
    },
    TSNonNullExpression(path: NodePath<t.TSNonNullExpression>) {
      path.replaceWith(path.node.expression)
    },
    TSSatisfiesExpression(path: NodePath<t.TSSatisfiesExpression>) {
      path.replaceWith(path.node.expression)
    },
    TSInstantiationExpression(path: NodePath<t.TSInstantiationExpression>) {
      path.replaceWith(path.node.expression)
    },
  })
}
