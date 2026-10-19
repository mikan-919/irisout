// ADR-0071: 関数値を束縛から一つの本体へ解決する。const別名と、呼出元を列挙できる
// 識別子引数だけを辿り、再代入・動的な値・外部への受渡しは解決しない。
import type { Binding, NodePath } from '@babel/traverse'
import * as t from '@babel/types'

function functionBinding(path: NodePath<t.Function>): Binding | undefined {
  if (path.isFunctionDeclaration() && path.node.id)
    return path.parentPath.scope.getBinding(path.node.id.name)
  const parent = path.parentPath
  if (parent.isVariableDeclarator() && t.isIdentifier(parent.node.id))
    return parent.scope.getBinding(parent.node.id.name)
  return undefined
}

function callsOf(
  binding: Binding,
  visited = new Set<Binding>(),
): NodePath<t.CallExpression>[] | null {
  if (!binding.constant || visited.has(binding)) return null
  visited.add(binding)
  const calls: NodePath<t.CallExpression>[] = []
  for (const ref of binding.referencePaths) {
    const parent = ref.parentPath
    if (parent?.isCallExpression() && parent.node.callee === ref.node) calls.push(parent)
    else if (
      parent?.isVariableDeclarator() &&
      parent.node.init === ref.node &&
      parent.parentPath.isVariableDeclaration({ kind: 'const' }) &&
      t.isIdentifier(parent.node.id)
    ) {
      const alias = parent.scope.getBinding(parent.node.id.name)
      const nested = alias && callsOf(alias, new Set(visited))
      if (!nested) return null
      calls.push(...nested)
    } else return null
  }
  return calls
}

export function resolveFunction(
  path: NodePath<t.Node>,
  visited = new Set<Binding>(),
): NodePath<t.Function> | null {
  if (path.isFunction()) return path
  if (!path.isIdentifier()) return null
  const binding = path.scope.getBinding(path.node.name)
  if (!binding || !binding.constant || visited.has(binding)) return null
  visited.add(binding)
  if (binding.path.isFunctionDeclaration()) return binding.path
  if (binding.path.isVariableDeclarator()) {
    const init = binding.path.get('init')
    if (!init.node || Array.isArray(init)) return null
    if (init.isFunction()) return init
    if (!binding.constant || !binding.path.parentPath.isVariableDeclaration({ kind: 'const' }))
      return null
    return resolveFunction(init, visited)
  }
  if (binding.kind !== 'param' || !binding.constant) return null
  const fn = binding.path.findParent((parent) => parent.isFunction()) as NodePath<t.Function> | null
  if (!fn) return null
  const index = fn.node.params.indexOf(binding.path.node as t.Identifier)
  if (index < 0) return null
  const owner = functionBinding(fn)
  const calls = owner
    ? callsOf(owner)
    : fn.parentPath.isCallExpression() && fn.parentPath.node.callee === fn.node
      ? [fn.parentPath]
      : null
  if (!calls?.length) return null
  let target: NodePath<t.Function> | null = null
  for (const call of calls) {
    if (call.node.arguments.some((arg) => t.isSpreadElement(arg))) return null
    const arg = call.get('arguments')[index]
    if (!arg) return null
    const resolved = resolveFunction(arg, new Set(visited))
    if (!resolved || (target && target.node !== resolved.node)) return null
    target = resolved
  }
  return target
}

// 呼出先の対応する引数が、渡す値と同じ本体へ解決する場合だけ許可する。
export function isResolvedFunctionArgument(path: NodePath<t.Identifier>): boolean {
  const call = path.parentPath
  if (!call?.isCallExpression()) return false
  const index = call.node.arguments.indexOf(path.node)
  if (index < 0) return false
  const callee = resolveFunction(call.get('callee'))
  const param = callee?.get('params')[index]
  const target = resolveFunction(path)
  const resolved = param && resolveFunction(param)
  return !!target && resolved?.node === target.node
}

// 後始末用の引数は呼出元ですでに更新なしの関数へ切り替えてある。
export function isFunctionParameter(
  path: NodePath<t.Identifier>,
  visited = new Set<Binding>(),
): boolean {
  const binding = path.scope.getBinding(path.node.name)
  if (!binding || visited.has(binding)) return false
  visited.add(binding)
  if (binding.kind === 'param') return true
  if (!binding.path.isVariableDeclarator()) return false
  const init = binding.path.get('init')
  return init.isIdentifier() && isFunctionParameter(init, visited)
}
