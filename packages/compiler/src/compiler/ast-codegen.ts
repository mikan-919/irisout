// AST変換を受けた式・文を、元ソースの位置範囲ではなくASTから出力するための
// 小さな境界。通常の式は従来どおり位置編集を使い、コンポーネントのprops
// 置換や識別子変換を含む部分だけがここを通る。

import generateImport from '@babel/generator'
import * as t from '@babel/types'

const generate =
  (generateImport as unknown as { default?: typeof generateImport }).default ?? generateImport

export type AstNodeGetter = <T extends t.Node>(original: T) => T

interface Replacement {
  target: t.Node
  parent: t.Node | null
  depth: number
  build: (get: AstNodeGetter) => t.Node
}

export interface AstRewriteSession {
  rename(original: t.Identifier, name: string): void
  replace(
    target: t.Node,
    parent: t.Node | null,
    depth: number,
    build: (get: AstNodeGetter) => t.Node,
  ): void
  insertAfter(target: t.Node, parent: t.Node | null, build: () => t.Node): void
  generate(): string
}

function isNode(value: unknown): value is t.Node {
  return (
    !!value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string'
  )
}

// cloneNode後の対応するノードを記録する。AST変換前のNodePathを使って
// bindingを解決し、変換後のクローンでは同じノードを直接書き換えるために使う。
function mapNodePairs(original: unknown, clone: unknown, nodes: Map<t.Node, t.Node>): void {
  if (isNode(original) && isNode(clone)) nodes.set(original, clone)

  if (Array.isArray(original) && Array.isArray(clone)) {
    for (let i = 0; i < original.length; i++) mapNodePairs(original[i], clone[i], nodes)
    return
  }
  if (!original || !clone || typeof original !== 'object' || typeof clone !== 'object') return

  const originalObject = original as Record<string, unknown>
  const cloneObject = clone as Record<string, unknown>
  for (const key of Object.keys(originalObject)) {
    // 位置・コメント情報はASTの子ではない。コメント内のオブジェクトを
    // 対応付ける必要もないため、循環や共有参照を避けてここで止める。
    if (
      key === 'start' ||
      key === 'end' ||
      key === 'loc' ||
      key === 'extra' ||
      key === 'leadingComments' ||
      key === 'innerComments' ||
      key === 'trailingComments'
    ) {
      continue
    }
    mapNodePairs(originalObject[key], cloneObject[key], nodes)
  }
}

function replaceChild(parent: t.Node, child: t.Node, replacement: t.Node): void {
  const parentObject = parent as unknown as Record<string, unknown>
  for (const key of Object.keys(parentObject)) {
    const value = parentObject[key]
    if (value === child) {
      parentObject[key] = replacement
      return
    }
    if (Array.isArray(value)) {
      const index = value.indexOf(child)
      if (index !== -1) {
        value[index] = replacement
        return
      }
    }
  }
  throw new Error('compile: internal AST replacement target was not found')
}

export function createAstRewrite(root: t.Node): AstRewriteSession {
  const renames = new Map<t.Identifier, string>()
  const replacements = new Map<t.Node, Replacement>()
  const insertions: { target: t.Node; parent: t.Node | null; build: () => t.Node }[] = []

  return {
    rename(original, name) {
      renames.set(original, name)
    },

    replace(target, parent, depth, build) {
      replacements.set(target, { target, parent, depth, build })
    },
    insertAfter(target, parent, build) {
      insertions.push({ target, parent, build })
    },

    generate() {
      // 依存確定前後の再生成で、前回置換済みの木や同じ置換を重ねて使わない。
      const clone = t.cloneNode(root, true) as t.Node
      const current = new Map<t.Node, t.Node>()
      mapNodePairs(root, clone, current)
      for (const [original, name] of renames) {
        const cloned = current.get(original)
        if (cloned?.type === 'Identifier') cloned.name = name
      }

      let outputRoot = current.get(root) ?? clone
      const get: AstNodeGetter = <T extends t.Node>(original: T): T =>
        (current.get(original) ?? t.cloneNode(original, true)) as T

      // 内側の読み取りを先に置換する。例えば `count(count())` では、先に
      // 内側のcount()を読み取りへ変換してから外側を代入式へ変換する。
      for (const replacement of [...replacements.values()].sort((a, b) => b.depth - a.depth)) {
        const target = current.get(replacement.target)
        if (!target) continue
        const next = replacement.build(get)
        const parent = replacement.parent ? current.get(replacement.parent) : null
        if (!parent || parent === target) {
          outputRoot = next
        } else {
          replaceChild(parent, target, next)
        }
        current.set(replacement.target, next)
      }
      for (const insertion of insertions) {
        const target = current.get(insertion.target)
        const parent = insertion.parent ? (current.get(insertion.parent) ?? outputRoot) : outputRoot
        const list =
          (parent as unknown as { body?: t.Node[]; declarations?: t.Node[] }).body ??
          (parent as unknown as { declarations?: t.Node[] }).declarations
        const index = target && list ? list.indexOf(target) : -1
        if (!list || index < 0)
          throw new Error('compile: internal AST insertion target was not found')
        const node = insertion.build()
        const name = 'id' in node && node.id?.type === 'Identifier' ? node.id.name : null
        const existing = name
          ? list.findIndex(
              (item) => 'id' in item && item.id?.type === 'Identifier' && item.id.name === name,
            )
          : -1
        if (existing >= 0) list[existing] = node
        else list.splice(index + 1, 0, node)
      }

      // 再解析した関数本体の位置マーカーだけを残し、元のコメントは出力しない。
      return generate(outputRoot, {
        comments: true,
        shouldPrintComment: (value) => value.includes('__IRISOUT_MAP_'),
      }).code
    },
  }
}
