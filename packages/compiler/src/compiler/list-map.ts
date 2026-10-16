// ADR-0067: 配列と行が外へ漏れず、行の値がプリミティブだけの場合に、
// 純粋なmapの変更行を記録する。証明できない式は通常のキー照合へ戻す。
import type { Binding, NodePath } from '@babel/traverse'
import * as t from '@babel/types'

function property(node: t.Node): string | null {
  if (t.isIdentifier(node)) return node.name
  if (t.isStringLiteral(node)) return node.value
  return null
}

interface RowProof {
  shapes?: Set<string>[]
  fields?: Set<string>
}

function scalar(node: t.Node, item?: string, index?: string, proof?: RowProof): boolean {
  if (
    t.isStringLiteral(node) ||
    t.isNumericLiteral(node) ||
    t.isBooleanLiteral(node) ||
    t.isNullLiteral(node) ||
    t.isBigIntLiteral(node)
  )
    return true
  if (t.isIdentifier(node)) return node.name === index
  if (t.isMemberExpression(node))
    return (
      !node.computed &&
      t.isIdentifier(node.object) &&
      node.object.name === item &&
      (!proof?.fields || proof.fields.has(property(node.property)!))
    )
  if (t.isBinaryExpression(node) || t.isLogicalExpression(node))
    return scalar(node.left, item, index, proof) && scalar(node.right, item, index, proof)
  if (t.isUnaryExpression(node))
    return node.operator !== 'delete' && scalar(node.argument, item, index, proof)
  if (t.isConditionalExpression(node))
    return (
      scalar(node.test, item, index, proof) &&
      scalar(node.consequent, item, index, proof) &&
      scalar(node.alternate, item, index, proof)
    )
  if (t.isTemplateLiteral(node))
    return node.expressions.every((part) => scalar(part, item, index, proof))
  return false
}

// 新規行の値は必ずプリミティブになる式に限る。関数の返り値や外部objectは許さない。
function primitive(node: t.Node): boolean {
  return (
    (t.isLiteral(node) && !t.isRegExpLiteral(node)) ||
    t.isBinaryExpression(node) ||
    t.isUpdateExpression(node) ||
    t.isTemplateLiteral(node) ||
    (t.isUnaryExpression(node) && node.operator !== 'delete') ||
    (t.isConditionalExpression(node) && primitive(node.consequent) && primitive(node.alternate))
  )
}

function rowObject(node: t.Node, item?: string, indexParam?: string, proof?: RowProof): boolean {
  if (!t.isObjectExpression(node)) return false
  const valid = node.properties.every((entry, index) => {
    if (t.isSpreadElement(entry))
      return index === 0 && !!item && t.isIdentifier(entry.argument, { name: item })
    return (
      t.isObjectProperty(entry) &&
      !entry.computed &&
      property(entry.key) !== '__proto__' &&
      (item ? scalar(entry.value, item, indexParam, proof) : primitive(entry.value))
    )
  })
  if (valid && !node.properties.some((entry) => t.isSpreadElement(entry)))
    proof?.shapes?.push(
      new Set(node.properties.map((entry) => property((entry as t.ObjectProperty).key)!)),
    )
  return valid
}

function pureCallback(path: NodePath, mapping: boolean, proof?: RowProof): boolean {
  if (!path.isArrowFunctionExpression() || path.node.async || path.node.params.length > 2)
    return false
  const [item, index] = path.node.params
  if (!t.isIdentifier(item) || (index && !t.isIdentifier(index))) return false
  const result = (node: t.Node): boolean =>
    t.isIdentifier(node, { name: item.name }) ||
    rowObject(node, item.name, index?.name, proof) ||
    (t.isConditionalExpression(node) &&
      scalar(node.test, item.name, index?.name, proof) &&
      result(node.consequent) &&
      result(node.alternate))
  return mapping ? result(path.node.body) : readonlyItem(path.scope.getBinding(item.name))
}

function writeTarget(path: NodePath): boolean {
  let target = path
  while (
    target.parentPath &&
    (target.parentPath.isArrayPattern() ||
      target.parentPath.isObjectPattern() ||
      target.parentPath.isObjectProperty() ||
      target.parentPath.isRestElement() ||
      (target.parentPath.isAssignmentPattern() && target.parentPath.node.left === target.node))
  )
    target = target.parentPath
  const parent = target.parentPath
  return !!(
    (parent?.isAssignmentExpression() && parent.node.left === target.node) ||
    parent?.isUpdateExpression() ||
    parent?.isUnaryExpression({ operator: 'delete' }) ||
    ((parent?.isForOfStatement() || parent?.isForInStatement()) && parent.node.left === target.node)
  )
}

function readonlyItem(binding: Binding | undefined): boolean {
  if (!binding?.constant) return false
  return binding.referencePaths.every((ref) => {
    const member = ref.parentPath
    if (!member?.isMemberExpression() || member.node.object !== ref.node || member.node.computed)
      return false
    const parent = member.parentPath
    return !(
      writeTarget(member) ||
      (parent?.isCallExpression() && parent.node.callee === member.node)
    )
  })
}

function setter(path: NodePath | null, state: Binding): boolean {
  if (!path?.isCallExpression() || !t.isIdentifier(path.node.callee)) return false
  return path.scope.getBinding(path.node.callee.name) === state && path.node.arguments.length === 1
}

function ignoredWriteResult(call: NodePath): boolean {
  if (call.parentPath?.isExpressionStatement()) return true
  const arrow = call.parentPath
  const container = arrow?.parentPath
  const attribute = container?.parentPath
  return !!(
    arrow?.isArrowFunctionExpression() &&
    container?.isJSXExpressionContainer() &&
    attribute?.isJSXAttribute() &&
    t.isJSXIdentifier(attribute.node.name) &&
    /^on[A-Z]/.test(attribute.node.name.name)
  )
}

function freshBuilder(path: NodePath, proof: RowProof): boolean {
  if (!path.isCallExpression() || !t.isIdentifier(path.node.callee)) return false
  const binding = path.scope.getBinding(path.node.callee.name)
  if (!binding?.constant || !binding.path.isFunctionDeclaration()) return false
  const fn = binding.path
  if (fn.node.async || fn.node.generator) return false
  let array: Binding | undefined
  let valid = true
  fn.traverse({
    CallExpression(call) {
      if (t.isIdentifier(call.node.callee, { name: 'eval' })) valid = false
    },
    ReturnStatement(ret) {
      if (!t.isIdentifier(ret.node.argument)) {
        valid = false
        return
      }
      const candidate = ret.scope.getBinding(ret.node.argument.name)
      if (array && candidate !== array) valid = false
      array = candidate
    },
    Function(inner) {
      valid = false
      inner.skip()
    },
  })
  if (
    !valid ||
    !array?.constant ||
    !array.path.isVariableDeclarator() ||
    array.path.getFunctionParent()?.node !== fn.node
  )
    return false
  const initial = array.path.node.init
  if (!t.isArrayExpression(initial) || initial.elements.length !== 0) return false
  return array.referencePaths.every((ref) => {
    if (ref.getFunctionParent()?.node !== fn.node) return false
    if (ref.parentPath?.isReturnStatement()) return true
    const member = ref.parentPath
    const call = member?.parentPath
    return !!(
      member?.isMemberExpression() &&
      member.node.object === ref.node &&
      !member.node.computed &&
      t.isIdentifier(member.node.property, { name: 'push' }) &&
      call?.isCallExpression() &&
      call.node.callee === member.node &&
      call.node.arguments.length === 1 &&
      rowObject(call.node.arguments[0]!, undefined, undefined, proof)
    )
  })
}

function permutation(binding: Binding, state: Binding): boolean {
  if (!binding.constant) return false
  const indexRead = (node: t.Node): boolean =>
    t.isMemberExpression(node) &&
    node.computed &&
    t.isIdentifier(node.object, { name: binding.identifier.name }) &&
    t.isNumericLiteral(node.property)
  return binding.referencePaths.every((ref) => {
    if (ref.getFunctionParent()?.node !== binding.path.getFunctionParent()?.node) return false
    const parent = ref.parentPath
    if (setter(parent, state)) return true
    if (!parent?.isMemberExpression() || parent.node.object !== ref.node) return false
    if (!parent.node.computed) return t.isIdentifier(parent.node.property, { name: 'length' })
    if (!indexRead(parent.node)) return false
    const usage = parent.parentPath
    if (usage?.isAssignmentExpression()) {
      if (usage.node.operator !== '=' || !usage.parentPath?.isExpressionStatement()) return false
      if (usage.node.right === parent.node) return indexRead(usage.node.left)
      const rhs = usage.get('right')
      if (indexRead(rhs.node)) return true
      if (!rhs.isIdentifier()) return false
      const temp = rhs.scope.getBinding(rhs.node.name)
      return !!(
        temp?.constant &&
        temp.path.isVariableDeclarator() &&
        temp.path.node.init &&
        indexRead(temp.path.node.init) &&
        temp.referencePaths.every(
          (use) =>
            use.parentPath?.isAssignmentExpression({ operator: '=' }) &&
            use.parentPath.parentPath?.isExpressionStatement() &&
            use.scope.getBinding(binding.identifier.name) === binding &&
            use.parentPath.node.right === use.node &&
            indexRead(use.parentPath.node.left),
        )
      )
    }
    if (usage?.isVariableDeclarator() && t.isIdentifier(usage.node.id)) {
      const temp = usage.scope.getBinding(usage.node.id.name)
      return !!temp?.referencePaths.every(
        (use) =>
          use.parentPath?.isAssignmentExpression({ operator: '=' }) &&
          use.parentPath.parentPath?.isExpressionStatement() &&
          use.scope.getBinding(binding.identifier.name) === binding &&
          use.parentPath.node.right === use.node &&
          indexRead(use.parentPath.node.left),
      )
    }
    return false
  })
}

function ownedRowFields(state: Binding): Set<string> | false {
  if (!state.constant || !state.path.isVariableDeclarator()) return false
  let hasEval = false
  state.path.getFunctionParent()?.traverse({
    CallExpression(path) {
      if (t.isIdentifier(path.node.callee, { name: 'eval' })) hasEval = true
    },
  })
  if (hasEval) return false
  const init = state.path.get('init')
  if (!init.isCallExpression()) return false
  const initial = init.get('arguments.0')
  const proof: RowProof = { shapes: [] }
  const maps = new Set<NodePath>()
  const items = new Set<Binding>()
  if (
    !initial?.isArrayExpression() ||
    !initial.node.elements.every((row) => row && rowObject(row, undefined, undefined, proof))
  )
    return false
  const read = (path: NodePath): boolean =>
    path.isCallExpression() &&
    path.node.arguments.length === 0 &&
    t.isIdentifier(path.node.callee) &&
    path.scope.getBinding(path.node.callee.name) === state
  const arrayValue = (path: NodePath): boolean => {
    if (path.isArrayExpression())
      return (path.get('elements') as NodePath[]).every((entry) =>
        entry.isSpreadElement()
          ? arrayValue(entry.get('argument'))
          : rowObject(entry.node, undefined, undefined, proof),
      )
    if (read(path)) return true
    if (path.isCallExpression()) {
      const callee = path.get('callee')
      if (callee.isMemberExpression() && !callee.node.computed && read(callee.get('object'))) {
        const name = property(callee.node.property)
        if (name === 'map') maps.add(path.get('arguments.0') as NodePath)
        return (
          (name === 'map' || name === 'filter') &&
          path.node.arguments.length === 1 &&
          pureCallback(path.get('arguments.0') as NodePath, name === 'map', proof)
        )
      }
      return freshBuilder(path, proof)
    }
    if (path.isIdentifier()) {
      const copy = path.scope.getBinding(path.node.name)
      if (!copy?.path.isVariableDeclarator()) return false
      const value = copy.path.get('init')
      return (
        value.isCallExpression() &&
        value.node.arguments.length === 0 &&
        value.get('callee').isMemberExpression() &&
        t.isIdentifier((value.node.callee as t.MemberExpression).property, { name: 'slice' }) &&
        read(value.get('callee.object') as NodePath) &&
        permutation(copy, state)
      )
    }
    return false
  }
  const owned = state.referencePaths.every((ref) => {
    const call = ref.parentPath
    if (!call?.isCallExpression() || call.node.callee !== ref.node) return false
    if (call.node.arguments.length === 1)
      return ignoredWriteResult(call) && arrayValue(call.get('arguments.0') as NodePath)
    if (call.node.arguments.length !== 0) return false
    const parent = call.parentPath
    if (parent?.isSpreadElement()) {
      const array = parent.parentPath
      return !!array?.isArrayExpression() && setter(array.parentPath, state) && arrayValue(array)
    }
    const member = parent
    const operation = member?.parentPath
    if (
      member?.isMemberExpression() &&
      member.node.object === call.node &&
      !member.node.computed &&
      t.isIdentifier(member.node.property, { name: 'length' })
    )
      return !writeTarget(member)
    if (
      !member?.isMemberExpression() ||
      member.node.object !== call.node ||
      member.node.computed ||
      !operation?.isCallExpression() ||
      operation.node.callee !== member.node
    )
      return false
    const name = property(member.node.property)
    if (name === 'slice' && operation.node.arguments.length === 0) {
      const decl = operation.parentPath
      if (!decl?.isVariableDeclarator() || !t.isIdentifier(decl.node.id)) return false
      const copy = decl.scope.getBinding(decl.node.id.name)
      return !!copy && permutation(copy, state)
    }
    if (name !== 'map' && name !== 'filter') return false
    const callback = operation.get('arguments.0') as NodePath
    if (setter(operation.parentPath, state)) return arrayValue(operation)
    if (
      name !== 'map' ||
      !callback?.isArrowFunctionExpression() ||
      callback.node.params.length !== 1 ||
      !t.isJSXElement(callback.node.body) ||
      !t.isIdentifier(callback.node.params[0])
    )
      return false
    const item = callback.scope.getBinding(callback.node.params[0].name)
    if (item) items.add(item)
    return readonlyItem(item)
  })
  if (!owned) return false
  // 継承されたobject/functionを新しい行へ持ち込まない。全作成経路に共通する
  // 自身のプロパティだけを、mapと表示の直接読取りに認める。
  const fields = new Set(proof.shapes![0] ?? [])
  for (const shape of proof.shapes!)
    for (const field of fields) if (!shape.has(field)) fields.delete(field)
  const valid =
    [...maps].every((map) => pureCallback(map, true, { fields })) &&
    [...items].every((item) =>
      item.referencePaths.every(
        (ref) =>
          ref.parentPath?.isMemberExpression() &&
          fields.has(property(ref.parentPath.node.property)!),
      ),
    )
  return valid ? fields : false
}

export function isOwnedRowArray(state: Binding): boolean {
  return ownedRowFields(state) !== false
}

// 配列の別名は、複製後の並べ替えを最後に設定して寿命を終えるものだけに限る。
// 行オブジェクトの別名は残り得るため、この判定で行のその場書換えは許可しない。
export function canMutateRowArray(state: Binding): boolean {
  if (!isOwnedRowArray(state)) return false
  for (const ref of state.referencePaths) {
    const read = ref.parentPath
    const member = read?.parentPath
    const call = member?.parentPath
    if (member?.isMemberExpression() && call?.isCallExpression()) {
      if (t.isIdentifier(member.node.property, { name: 'filter' }) && !isPureRowFilter(call, state))
        return false
      if (t.isIdentifier(member.node.property, { name: 'map' })) {
        const callback = call.get('arguments.0') as NodePath
        if (callback?.isArrowFunctionExpression() && t.isJSXElement(callback.node.body)) {
          let safe = true
          callback.get('body').traverse({
            Function(path) {
              path.skip()
            },
            CallExpression(path) {
              if (!t.isIdentifier(path.node.callee) || path.node.arguments.length !== 0) {
                safe = false
                return
              }
              const binding = path.scope.getBinding(path.node.callee.name)
              const init = binding?.path.isVariableDeclarator() ? binding.path.node.init : null
              if (
                !t.isCallExpression(init) ||
                !t.isIdentifier(init.callee) ||
                !['signal', 'derived'].includes(init.callee.name)
              )
                safe = false
            },
            JSXOpeningElement(path) {
              if (!t.isJSXIdentifier(path.node.name) || path.node.name.name.includes('-'))
                safe = false
            },
            JSXAttribute(path) {
              if (t.isJSXIdentifier(path.node.name) && ['use', 'is'].includes(path.node.name.name))
                safe = false
            },
          })
          if (!safe) return false
        }
      }
    }
    if (
      !member?.isMemberExpression() ||
      !t.isIdentifier(member.node.property, { name: 'slice' }) ||
      !call?.isCallExpression()
    )
      continue
    const decl = call.parentPath
    if (!decl?.isVariableDeclarator() || !t.isIdentifier(decl.node.id)) return false
    const copy = decl.scope.getBinding(decl.node.id.name)
    if (!copy) return false
    const writes = copy.referencePaths.filter((use) => setter(use.parentPath, state))
    if (writes.length !== 1) return false
    const write = writes[0]!.parentPath!
    if (copy.referencePaths.some((use) => use.node.start! > write.node.end!)) return false
    let tail: NodePath | null = write.parentPath
    if (!tail?.isExpressionStatement()) return false
    while (tail.parentPath && !tail.parentPath.isFunction()) {
      const parent: NodePath = tail.parentPath
      if (parent.isBlockStatement()) {
        if (parent.node.body.at(-1) !== tail.node) return false
      } else if (!parent.isIfStatement()) return false
      tail = parent
    }
  }
  return true
}

export function rowMapFields(map: t.CallExpression): string[] | null {
  const callback = map.arguments[0]
  if (!t.isArrowFunctionExpression(callback) || !t.isIdentifier(callback.params[0])) return null
  const item = callback.params[0].name
  const fields = new Set<string>()
  const visit = (node: t.Node): boolean => {
    if (t.isIdentifier(node, { name: item })) return true
    if (t.isConditionalExpression(node)) return visit(node.consequent) && visit(node.alternate)
    if (
      !t.isObjectExpression(node) ||
      !t.isSpreadElement(node.properties[0]) ||
      !t.isIdentifier(node.properties[0].argument, { name: item })
    )
      return false
    return node.properties.slice(1).every((entry) => {
      if (!t.isObjectProperty(entry) || entry.computed) return false
      const name = property(entry.key)
      if (name === null) return false
      fields.add(name)
      return true
    })
  }
  return visit(callback.body) ? [...fields] : null
}

export function isPureRowMap(path: NodePath, state: Binding): path is NodePath<t.CallExpression> {
  if (!path.isCallExpression() || path.node.arguments.length !== 1) return false
  const callee = path.get('callee')
  if (
    !callee.isMemberExpression() ||
    callee.node.computed ||
    !t.isIdentifier(callee.node.property, { name: 'map' })
  )
    return false
  const object = callee.get('object')
  return (
    object.isCallExpression() &&
    object.node.arguments.length === 0 &&
    t.isIdentifier(object.node.callee) &&
    object.scope.getBinding(object.node.callee.name) === state &&
    pureCallback(path.get('arguments.0') as NodePath, true)
  )
}

// ADR-0068: 書込み位置が二つだけの複製を記録する。実際に交換したかは反映時に確認する。
export function rowPermutationIndexes(copy: Binding, state: Binding): [number, number] | null {
  if (!permutation(copy, state)) return null
  const indexes = new Set<number>()
  for (const ref of copy.referencePaths) {
    const member = ref.parentPath
    if (
      member?.isMemberExpression() &&
      member.node.computed &&
      t.isNumericLiteral(member.node.property) &&
      member.parentPath?.isAssignmentExpression() &&
      member.parentPath.node.left === member.node
    ) {
      indexes.add(member.node.property.value)
    }
  }
  if (indexes.size !== 2 || [...indexes].some((index) => !Number.isSafeInteger(index) || index < 0))
    return null
  return [...indexes].sort((a, b) => a - b) as [number, number]
}

// 複製から設定までが配列参照の読書きだけなら、途中を観測する呼出しや例外がない。
export function isAtomicRowPermutation(copy: Binding, state: Binding): boolean {
  const declaration = copy.path.parentPath
  const block = declaration?.parentPath
  if (
    !declaration?.isVariableDeclaration() ||
    declaration.node.declarations.length !== 1 ||
    !block?.isBlockStatement()
  )
    return false
  const statements = block.get('body') as NodePath<t.Statement>[]
  const start = statements.findIndex((statement) => statement.node === declaration.node)
  const temporaries = new Set<string>()
  const isIndex = (node: t.Node): boolean =>
    t.isMemberExpression(node) &&
    node.computed &&
    t.isIdentifier(node.object, { name: copy.identifier.name }) &&
    t.isNumericLiteral(node.property)
  return statements.slice(start + 1).every((statement, index, rest) => {
    if (statement.isVariableDeclaration())
      return statement.node.declarations.every((decl) => {
        if (!t.isIdentifier(decl.id) || !decl.init || !isIndex(decl.init)) return false
        temporaries.add(decl.id.name)
        return true
      })
    if (!statement.isExpressionStatement()) return false
    const expression = statement.get('expression')
    if (setter(expression, state))
      return (
        index === rest.length - 1 &&
        t.isCallExpression(expression.node) &&
        t.isIdentifier(expression.node.arguments[0], { name: copy.identifier.name })
      )
    return (
      expression.isAssignmentExpression({ operator: '=' }) &&
      isIndex(expression.node.left) &&
      (isIndex(expression.node.right) ||
        (t.isIdentifier(expression.node.right) && temporaries.has(expression.node.right.name)))
    )
  })
}

export function isRowAppend(path: NodePath, state: Binding): path is NodePath<t.ArrayExpression> {
  if (!path.isArrayExpression() || path.node.elements.length !== 2) return false
  const [first, second] = path.get('elements') as NodePath[]
  if (!first?.isSpreadElement() || !second?.isSpreadElement()) return false
  const read = first.get('argument')
  return (
    read.isCallExpression() &&
    read.node.arguments.length === 0 &&
    t.isIdentifier(read.node.callee) &&
    read.scope.getBinding(read.node.callee.name) === state &&
    freshBuilder(second.get('argument'), {})
  )
}

// フィルターは呼出し・代入を許可しない。捕捉した行は同じ所有配列の表示引数だけに限る。
export function isPureRowFilter(
  path: NodePath,
  state: Binding,
): path is NodePath<t.CallExpression> {
  if (!path.isCallExpression() || path.node.arguments.length !== 1) return false
  const callee = path.get('callee')
  if (
    !callee.isMemberExpression() ||
    callee.node.computed ||
    !t.isIdentifier(callee.node.property, { name: 'filter' })
  )
    return false
  const object = callee.get('object')
  if (
    !object.isCallExpression() ||
    object.node.arguments.length !== 0 ||
    !t.isIdentifier(object.node.callee) ||
    object.scope.getBinding(object.node.callee.name) !== state
  )
    return false
  const callback = path.get('arguments.0') as NodePath
  if (
    !callback.isArrowFunctionExpression() ||
    callback.node.async ||
    callback.node.params.length > 2 ||
    !t.isIdentifier(callback.node.params[0])
  )
    return false
  const fields = ownedRowFields(state)
  if (!fields) return false
  const item = callback.scope.getBinding(callback.node.params[0].name)
  const index = t.isIdentifier(callback.node.params[1])
    ? callback.scope.getBinding(callback.node.params[1].name)
    : null
  const safe = (part: NodePath): boolean => {
    if (part.isLiteral() && !part.isRegExpLiteral()) return true
    if (part.isIdentifier()) {
      const binding = part.scope.getBinding(part.node.name)
      if (binding === index && binding) return true
      return (
        !!binding?.constant &&
        binding.path.isVariableDeclarator() &&
        t.isLiteral(binding.path.node.init) &&
        !t.isRegExpLiteral(binding.path.node.init)
      )
    }
    if (part.isMemberExpression() && !part.node.computed && t.isIdentifier(part.node.object)) {
      const binding = part.scope.getBinding(part.node.object.name)
      if (!fields.has(property(part.node.property)!)) return false
      if (binding === item) return true
      const fn = binding?.path.getFunctionParent()
      if (
        !fn?.isArrowFunctionExpression() ||
        !t.isJSXElement(fn.node.body) ||
        fn.node.params[0] !== binding?.identifier
      )
        return false
      const map = fn.parentPath
      if (
        !map?.isCallExpression() ||
        !t.isMemberExpression(map.node.callee) ||
        !t.isIdentifier(map.node.callee.property, { name: 'map' })
      )
        return false
      const source = map.node.callee.object
      return (
        t.isCallExpression(source) &&
        source.arguments.length === 0 &&
        t.isIdentifier(source.callee) &&
        map.scope.getBinding(source.callee.name) === state
      )
    }
    if (part.isBinaryExpression() || part.isLogicalExpression())
      return safe(part.get('left') as NodePath) && safe(part.get('right') as NodePath)
    if (part.isUnaryExpression() && part.node.operator !== 'delete')
      return safe(part.get('argument'))
    if (part.isConditionalExpression())
      return safe(part.get('test')) && safe(part.get('consequent')) && safe(part.get('alternate'))
    return false
  }
  return safe(callback.get('body'))
}

// 添字だけで決まる等間隔・単一位置の更新は、その位置だけcallbackを実行する。
export function rowMapRange(map: t.CallExpression): [number, number] | null {
  const callback = map.arguments[0]
  if (
    !t.isArrowFunctionExpression(callback) ||
    !t.isIdentifier(callback.params[0]) ||
    !t.isIdentifier(callback.params[1]) ||
    !t.isConditionalExpression(callback.body) ||
    !t.isIdentifier(callback.body.alternate, { name: callback.params[0].name })
  )
    return null
  const test = callback.body.test
  if (
    !t.isBinaryExpression(test, { operator: '===' }) ||
    !t.isNumericLiteral(test.right) ||
    !Number.isSafeInteger(test.right.value) ||
    test.right.value < 0
  )
    return null
  const index = callback.params[1].name
  if (t.isIdentifier(test.left, { name: index })) return [0, test.right.value]
  if (
    t.isBinaryExpression(test.left, { operator: '%' }) &&
    t.isIdentifier(test.left.left, { name: index }) &&
    t.isNumericLiteral(test.left.right) &&
    Number.isSafeInteger(test.left.right.value) &&
    test.left.right.value > test.right.value
  )
    return [test.left.right.value, test.right.value]
  return null
}
