// ADR-0071: 作者の束縛を一時名で分離し、生成後に内部の束縛だけを移して作者名を戻す。
// 本文の位置編集と関数名・仮引数・宣言前参照を保持し、実行時の機構は追加しない。
import { parse } from '@babel/parser'
import traverseImport from '@babel/traverse'
import type { Binding, NodePath, Scope } from '@babel/traverse'
import * as t from '@babel/types'

const traverse =
  (traverseImport as unknown as { default?: typeof traverseImport }).default ?? traverseImport

const PRIVATE_NAMES = new Set(['mount', 'unmount', 'hydrateComponentInstance', 'html'])
function isGeneratedName(name: string): boolean {
  return /^(?:__|update_)/.test(name) || PRIVATE_NAMES.has(name)
}

export function separateAuthoredNames(ast: t.File, transformed: Set<t.Node>): Map<string, string> {
  const names = new Map<string, string>()
  const bindings = new Set<Binding>()
  traverse(ast, {
    Scopable(path) {
      if (path.isProgram()) return
      for (const binding of Object.values(path.scope.bindings)) {
        if (isGeneratedName(binding.identifier.name)) bindings.add(binding)
      }
    },
  })
  for (const binding of bindings) {
    const original = binding.identifier.name
    const temporary = binding.scope.generateUidIdentifier('irisout_authored').name
    names.set(temporary, original)
    binding.scope.rename(original, temporary)
  }
  const globals = new Map<string, string>()
  traverse(ast, {
    ReferencedIdentifier(path) {
      if (
        !path.isIdentifier() ||
        !isGeneratedName(path.node.name) ||
        path.scope.getBinding(path.node.name)
      )
        return
      const original = path.node.name
      let temporary = globals.get(original)
      if (!temporary) {
        temporary = path.scope.generateUidIdentifier('irisout_authored').name
        globals.set(original, temporary)
        names.set(temporary, original)
      }
      path.node.name = temporary
    },
  })
  if (names.size)
    traverse(ast, {
      Identifier(path) {
        if (names.has(path.node.name)) transformed.add(path.node)
      },
    })
  return names
}

export function restoreAuthoredNames(source: string, names: ReadonlyMap<string, string>): string {
  if (!names.size) return source
  const ast = parse(source, { sourceType: 'module' })
  const scopes = new Set<Scope>()
  traverse(ast, {
    Scopable(path) {
      scopes.add(path.scope)
    },
  })
  const originals = new Set(names.values())
  for (const scope of scopes) {
    for (const binding of Object.values(scope.bindings)) {
      if (!originals.has(binding.identifier.name)) continue
      scope.rename(binding.identifier.name, scope.generateUidIdentifier('irisout_generated').name)
    }
  }
  for (const scope of scopes) {
    for (const binding of Object.values(scope.bindings)) {
      const original = names.get(binding.identifier.name)
      if (original) scope.rename(binding.identifier.name, original)
    }
  }
  traverse(ast, {
    ReferencedIdentifier(path) {
      if (!path.isIdentifier() || path.scope.getBinding(path.node.name)) return
      const original = names.get(path.node.name)
      if (original) path.node.name = original
    },
  })
  const edits = new Map<number, { end: number; text: string }>()
  traverse(ast, {
    ObjectProperty(path: NodePath<t.ObjectProperty>) {
      const { key, value } = path.node
      // renameが省略形を展開した場合、同じ文字範囲の値だけを替えるとキーまで変わる。
      if (
        t.isIdentifier(key) &&
        t.isIdentifier(value) &&
        key.start === value.start &&
        key.name !== value.name
      ) {
        edits.set(key.start!, { end: key.end!, text: `${key.name}: ${value.name}` })
        path.skip()
      }
    },
    Identifier(path) {
      const { start, end, name } = path.node
      if (start != null && end != null && source.slice(start, end) !== name)
        edits.set(start, { end, text: name })
    },
  })
  let out = ''
  let cursor = 0
  for (const [start, edit] of [...edits].sort(([a], [b]) => a - b)) {
    out += source.slice(cursor, start) + edit.text
    cursor = edit.end
  }
  return out + source.slice(cursor)
}
