// Motion JSXを標準irisout記法へ下げるVite用変換器。
// ブラウザ実行時処理は`irisout/motion`へ分離し、変換依存を配信しない。

import generateImport from '@babel/generator'
import { parse } from '@babel/parser'
import traverseImport from '@babel/traverse'
import * as t from '@babel/types'
import { irisout } from '../../vite-plugin/src/index.ts'

export interface IrisoutMotionPluginOptions {
  entry: string
  container?: string
  htmlMarker?: string
  virtualModuleId?: string
}

const traverse =
  (traverseImport as unknown as { default?: typeof traverseImport }).default ?? traverseImport
const generate =
  (generateImport as unknown as { default?: typeof generateImport }).default ?? generateImport

const UNSUPPORTED_MOTION_PROPS = new Set([
  'drag',
  'dragConstraints',
  'variants',
  'whileDrag',
  'whileFocus',
  'whileHover',
  'whileInView',
  'whileTap',
])

function attrName(attribute: t.JSXAttribute): string {
  if (attribute.name.type !== 'JSXIdentifier') {
    throw new Error('motion: namespace attributes are not supported')
  }
  return attribute.name.name
}

function attrExpression(attribute: t.JSXAttribute): t.Expression {
  if (!attribute.value) return t.booleanLiteral(true)
  if (attribute.value.type === 'StringLiteral') return attribute.value
  if (
    attribute.value.type !== 'JSXExpressionContainer' ||
    attribute.value.expression.type === 'JSXEmptyExpression'
  ) {
    throw new Error(`motion: ${attrName(attribute)} must have a value`)
  }
  return attribute.value.expression
}

function motionAction(
  initial: t.Expression | undefined,
  animateTarget: t.Expression | undefined,
  exitTarget: t.Expression | undefined,
  presence: boolean,
  transition: t.Expression | undefined,
  layout: t.Expression | undefined,
  layoutId: t.Expression | undefined,
  layoutScroll: t.Expression | undefined,
  layoutRoot: t.Expression | undefined,
  layoutCrossfade: t.Expression | undefined,
): t.JSXAttribute {
  const element = t.identifier('__motion_element__')
  const controller = t.identifier('__motion_controller__')
  const optionProperties: t.ObjectProperty[] = []
  if (layout) optionProperties.push(t.objectProperty(t.identifier('layout'), layout))
  if (layoutId) optionProperties.push(t.objectProperty(t.identifier('layoutId'), layoutId))
  if (layoutScroll)
    optionProperties.push(t.objectProperty(t.identifier('layoutScroll'), layoutScroll))
  if (layoutRoot) optionProperties.push(t.objectProperty(t.identifier('layoutRoot'), layoutRoot))
  if (layoutCrossfade)
    optionProperties.push(t.objectProperty(t.identifier('layoutCrossfade'), layoutCrossfade))
  if (initial) optionProperties.push(t.objectProperty(t.identifier('initial'), initial))
  if (exitTarget) optionProperties.push(t.objectProperty(t.identifier('exit'), exitTarget))
  if (presence)
    optionProperties.push(t.objectProperty(t.identifier('presence'), t.booleanLiteral(true)))
  if (transition) optionProperties.push(t.objectProperty(t.identifier('transition'), transition))
  const options = t.objectExpression(optionProperties)
  const statements: t.Statement[] = [
    t.variableDeclaration('const', [
      t.variableDeclarator(
        controller,
        t.callExpression(t.identifier('__irisout_mount_motion__'), [element, options]),
      ),
    ]),
  ]
  const resultProperties: t.ObjectMethod[] = []
  if (animateTarget) {
    resultProperties.push(
      t.objectMethod(
        'method',
        t.identifier('update'),
        [],
        t.blockStatement([
          t.expressionStatement(
            t.callExpression(t.memberExpression(controller, t.identifier('update')), [
              animateTarget,
              transition ?? t.identifier('undefined'),
            ]),
          ),
        ]),
      ),
    )
  }
  resultProperties.push(
    t.objectMethod(
      'method',
      t.identifier('destroy'),
      [],
      t.blockStatement([
        t.expressionStatement(
          t.callExpression(t.memberExpression(controller, t.identifier('destroy')), []),
        ),
      ]),
    ),
  )
  statements.push(t.returnStatement(t.objectExpression(resultProperties)))
  return t.jsxAttribute(
    t.jsxIdentifier('use'),
    t.jsxExpressionContainer(t.arrowFunctionExpression([element], t.blockStatement(statements))),
  )
}

export function transformMotionSource(source: string, filePath = 'source.jsx'): string {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
  let bindingName: string | null = null
  let presenceBinding: string | null = null
  let used = false
  let presenceUsed = false
  const presentElements = new WeakSet<t.JSXElement>()

  for (const statement of ast.program.body) {
    if (statement.type !== 'ImportDeclaration' || statement.source.value !== 'irisout/motion') {
      continue
    }
    for (const specifier of statement.specifiers) {
      if (
        specifier.type === 'ImportSpecifier' &&
        (specifier.imported.type === 'Identifier'
          ? specifier.imported.name
          : specifier.imported.value) === 'motion'
      ) {
        bindingName = specifier.local.name
      }
      if (
        specifier.type === 'ImportSpecifier' &&
        (specifier.imported.type === 'Identifier'
          ? specifier.imported.name
          : specifier.imported.value) === 'AnimatePresence'
      ) {
        presenceBinding = specifier.local.name
      }
    }
  }
  if (!bindingName && !presenceBinding) return source

  if (presenceBinding) {
    traverse(ast, {
      JSXElement(path) {
        const name = path.node.openingElement.name
        if (name.type !== 'JSXIdentifier' || name.name !== presenceBinding) return
        if (!path.parentPath.isJSXElement()) {
          throw new Error('motion: AnimatePresence must be inside an HTML element (scope limit)')
        }
        for (const attribute of path.node.openingElement.attributes) {
          if (attribute.type !== 'JSXAttribute' || attrName(attribute) !== 'mode') {
            throw new Error('motion: only AnimatePresence mode="sync" is supported')
          }
          const modeValue = attrExpression(attribute)
          if (modeValue.type !== 'StringLiteral' || modeValue.value !== 'sync') {
            throw new Error('motion: only AnimatePresence mode="sync" is supported')
          }
        }
        path.traverse({
          JSXElement(child) {
            const childName = child.node.openingElement.name
            if (
              childName.type === 'JSXMemberExpression' &&
              childName.object.type === 'JSXIdentifier' &&
              childName.object.name === bindingName &&
              child.findParent((parent) => parent.isJSXElement()) === path
            ) {
              presentElements.add(child.node)
            }
          },
        })
        presenceUsed = true
        path.replaceWithMultiple(path.node.children)
      },
    })
  }

  traverse(ast, {
    JSXElement(path) {
      const opening = path.node.openingElement
      const name = opening.name
      if (
        name.type !== 'JSXMemberExpression' ||
        name.object.type !== 'JSXIdentifier' ||
        name.object.name !== bindingName ||
        name.property.type !== 'JSXIdentifier'
      ) {
        return
      }
      const tagName = name.property.name
      if (!/^[a-z][A-Za-z0-9-]*$/.test(tagName)) {
        throw new Error(`motion: unknown element <${bindingName}.${tagName}> in ${filePath}`)
      }
      let initial: t.Expression | undefined
      let animateTarget: t.Expression | undefined
      let exitTarget: t.Expression | undefined
      let transition: t.Expression | undefined
      let layout: t.Expression | undefined
      let layoutId: t.Expression | undefined
      let layoutScroll: t.Expression | undefined
      let layoutRoot: t.Expression | undefined
      let layoutCrossfade: t.Expression | undefined
      const hostAttributes: (t.JSXAttribute | t.JSXSpreadAttribute)[] = []
      for (const attribute of opening.attributes) {
        if (attribute.type === 'JSXSpreadAttribute') {
          throw new Error('motion: spread attributes are not supported')
        }
        const name = attrName(attribute)
        if (UNSUPPORTED_MOTION_PROPS.has(name)) {
          throw new Error(`motion: property ${name} is not supported`)
        }
        if (name === 'initial') initial = attrExpression(attribute)
        else if (name === 'animate') animateTarget = attrExpression(attribute)
        else if (name === 'exit') exitTarget = attrExpression(attribute)
        else if (name === 'transition') transition = attrExpression(attribute)
        else if (name === 'layout') layout = attrExpression(attribute)
        else if (name === 'layoutId') layoutId = attrExpression(attribute)
        else if (name === 'layoutScroll') layoutScroll = attrExpression(attribute)
        else if (name === 'layoutRoot') layoutRoot = attrExpression(attribute)
        else if (name === 'layoutCrossfade') layoutCrossfade = attrExpression(attribute)
        else if (name === 'use') throw new Error('motion: motion elements cannot also use use=')
        else hostAttributes.push(attribute)
      }
      if (exitTarget && !presentElements.has(path.node)) {
        throw new Error('motion: exit requires AnimatePresence')
      }
      hostAttributes.push(
        motionAction(
          initial,
          animateTarget,
          exitTarget,
          presentElements.has(path.node),
          transition,
          layout,
          layoutId,
          layoutScroll,
          layoutRoot,
          layoutCrossfade,
        ),
      )
      opening.name = t.jsxIdentifier(tagName)
      opening.attributes = hostAttributes
      if (path.node.closingElement) path.node.closingElement.name = t.jsxIdentifier(tagName)
      used = true
    },
  })

  if (!used && !presenceUsed) return source
  for (const statement of ast.program.body) {
    if (statement.type !== 'ImportDeclaration' || statement.source.value !== 'irisout/motion') {
      continue
    }
    statement.specifiers = statement.specifiers.filter(
      (specifier) =>
        specifier.type !== 'ImportSpecifier' ||
        (specifier.local.name !== bindingName && specifier.local.name !== presenceBinding),
    )
  }
  ast.program.body = ast.program.body.filter(
    (statement) =>
      statement.type !== 'ImportDeclaration' ||
      statement.source.value !== 'irisout/motion' ||
      statement.specifiers.length > 0,
  )
  if (used) {
    ast.program.body.unshift(
      t.importDeclaration(
        [
          t.importSpecifier(
            t.identifier('__irisout_mount_motion__'),
            t.identifier('mountMotionElement'),
          ),
        ],
        t.stringLiteral('irisout/motion'),
      ),
    )
  }
  return generate(ast, { comments: true, retainLines: true }, source).code
}

export function irisoutMotion(options: IrisoutMotionPluginOptions) {
  return irisout({ ...options, transformSource: transformMotionSource })
}
