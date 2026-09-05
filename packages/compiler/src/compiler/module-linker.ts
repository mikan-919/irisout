// compileProject()が使う静的module linker。入口から相対importを辿り、ASTの
// bindingをmodule固有名へ変更してから一つのprogramへ連結する。対象は小規模な
// .js/.jsx moduleに限り、node_modules・dynamic import・循環依存は拒否する。

import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import generateImport from '@babel/generator'
import { parse } from '@babel/parser'
import type { NodePath } from '@babel/traverse'
import traverseImport from '@babel/traverse'
import * as t from '@babel/types'

const traverse =
  (traverseImport as unknown as { default?: typeof traverseImport }).default ?? traverseImport
const generate =
  (generateImport as unknown as { default?: typeof generateImport }).default ?? generateImport

interface ImportSpec {
  source: string
  defaultLocal: string | null
  named: { imported: string; local: string }[]
}

interface ModuleRecord {
  filePath: string
  ast: t.File
  imports: ImportSpec[]
  exports: Map<string, string>
  ownNames: string[]
  importNames: Set<string>
  state: 'unvisited' | 'visiting' | 'done'
  moduleIndex: number
}

export interface LinkedProject {
  source: string
  supportStatements: string[]
  supportNames: Set<string>
}

function compileError(message: string): Error {
  return new Error(`compile: ${message} (scope limit)`)
}

function parseModule(filePath: string, source: string): ModuleRecord {
  let ast: t.File
  try {
    ast = parse(source, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    })
  } catch (error) {
    throw new Error(
      `compile: failed to parse module "${filePath}": ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }

  const imports: ImportSpec[] = []
  const exports = new Map<string, string>()
  const ownNames: string[] = []
  const ownNameSet = new Set<string>()
  const importNames = new Set<string>()

  const addOwnName = (name: string): void => {
    if (ownNameSet.has(name) || importNames.has(name)) {
      throw compileError(`duplicate top-level binding "${name}" in module "${filePath}"`)
    }
    ownNameSet.add(name)
    ownNames.push(name)
  }

  const addImportName = (name: string): void => {
    if (ownNameSet.has(name) || importNames.has(name)) {
      throw compileError(`duplicate top-level binding "${name}" in module "${filePath}"`)
    }
    importNames.add(name)
  }

  const addExport = (exportName: string, localName: string): void => {
    if (exports.has(exportName)) {
      throw compileError(`duplicate export "${exportName}" in module "${filePath}"`)
    }
    exports.set(exportName, localName)
  }

  const checkConstDeclaration = (declaration: t.VariableDeclaration): void => {
    if (declaration.kind !== 'const') {
      throw compileError(
        `module "${filePath}" only supports top-level function declarations and const declarations`,
      )
    }
    for (const declarator of declaration.declarations) {
      if (declarator.id.type !== 'Identifier' || !declarator.init) {
        throw compileError(
          `module "${filePath}" only supports initialized const declarations with simple names`,
        )
      }
      const stateCall = findModuleStateCall(declarator.init)
      if (stateCall) {
        throw compileError(`module "${filePath}" cannot declare module-scope ${stateCall}() state`)
      }
      addOwnName(declarator.id.name)
    }
  }

  const localNameFromNode = (node: t.Identifier | t.StringLiteral): string =>
    node.type === 'Identifier' ? node.name : node.value

  for (const statement of ast.program.body) {
    if (statement.type === 'ImportDeclaration') {
      if (statement.importKind === 'type') {
        throw compileError(`type-only imports are not supported in module "${filePath}"`)
      }
      if (statement.specifiers.length === 0) {
        throw compileError(`side-effect imports are not supported in module "${filePath}"`)
      }
      const spec: ImportSpec = {
        source: statement.source.value,
        defaultLocal: null,
        named: [],
      }
      for (const specifier of statement.specifiers) {
        if (specifier.type === 'ImportNamespaceSpecifier') {
          throw compileError(`namespace imports are not supported in module "${filePath}"`)
        }
        if (specifier.type === 'ImportDefaultSpecifier') {
          if (spec.defaultLocal) {
            throw compileError(`duplicate default import in module "${filePath}"`)
          }
          spec.defaultLocal = specifier.local.name
          addImportName(specifier.local.name)
          continue
        }
        if (specifier.importKind === 'type') {
          throw compileError(`type-only imports are not supported in module "${filePath}"`)
        }
        const imported = localNameFromNode(specifier.imported)
        spec.named.push({ imported, local: specifier.local.name })
        addImportName(specifier.local.name)
      }
      imports.push(spec)
      continue
    }

    if (statement.type === 'ExportNamedDeclaration') {
      if (statement.exportKind === 'type' || statement.source) {
        throw compileError(`re-exports and type exports are not supported in module "${filePath}"`)
      }
      if (statement.declaration?.type === 'FunctionDeclaration') {
        if (!statement.declaration.id) {
          throw compileError(
            `anonymous exported functions are not supported in module "${filePath}"`,
          )
        }
        addOwnName(statement.declaration.id.name)
        addExport(statement.declaration.id.name, statement.declaration.id.name)
      } else if (statement.declaration?.type === 'VariableDeclaration') {
        checkConstDeclaration(statement.declaration)
        for (const declarator of statement.declaration.declarations) {
          const name = (declarator.id as t.Identifier).name
          addExport(name, name)
        }
      } else if (statement.declaration) {
        throw compileError(`only function and const exports are supported in module "${filePath}"`)
      } else {
        for (const specifier of statement.specifiers) {
          if (specifier.type !== 'ExportSpecifier') {
            throw compileError(`export namespace is not supported in module "${filePath}"`)
          }
          const local = localNameFromNode(specifier.local)
          const exported = localNameFromNode(specifier.exported)
          if (importNames.has(local)) {
            throw compileError(`re-exports are not supported in module "${filePath}"`)
          }
          addExport(exported, local)
        }
      }
      continue
    }

    if (statement.type === 'ExportDefaultDeclaration') {
      if (statement.declaration.type === 'FunctionDeclaration') {
        if (!statement.declaration.id) {
          throw compileError(
            `anonymous default functions are not supported in module "${filePath}"`,
          )
        }
        addOwnName(statement.declaration.id.name)
        addExport('default', statement.declaration.id.name)
      } else if (statement.declaration.type === 'Identifier') {
        addExport('default', statement.declaration.name)
      } else {
        throw compileError(`default export expressions are not supported in module "${filePath}"`)
      }
      continue
    }

    if (statement.type === 'FunctionDeclaration') {
      if (!statement.id)
        throw compileError(`anonymous functions are not supported in module "${filePath}"`)
      if (!hasRenderCall(statement)) {
        const stateCall = findModuleStateCall(statement)
        if (stateCall) {
          throw compileError(
            `module helper "${statement.id.name}" cannot call ${stateCall}() state`,
          )
        }
      }
      addOwnName(statement.id.name)
      continue
    }

    if (statement.type === 'VariableDeclaration') {
      checkConstDeclaration(statement)
      continue
    }

    throw compileError(
      `top-level statement "${statement.type}" is not supported in module "${filePath}"`,
    )
  }

  for (const name of importNames) {
    if (ownNameSet.has(name)) {
      throw compileError(`duplicate top-level binding "${name}" in module "${filePath}"`)
    }
  }

  for (const [exportName, localName] of exports) {
    if (!ownNameSet.has(localName)) {
      throw compileError(
        `export "${exportName}" in module "${filePath}" must refer to a local declaration`,
      )
    }
  }

  // import()はImportノードをcalleeに持つCallExpressionとして現れる。静的な
  // ImportDeclaration以外を残すと、リンク後のnew Function()で扱えないため、
  // module本体全体を走査して先に拒否する。
  traverse(ast, {
    CallExpression(path: NodePath<t.CallExpression>) {
      if (path.node.callee.type === 'Import') {
        throw compileError(`dynamic import is not supported in module "${filePath}"`)
      }
    },
    ImportExpression() {
      throw compileError(`dynamic import is not supported in module "${filePath}"`)
    },
  })

  return {
    filePath,
    ast,
    imports,
    exports,
    ownNames,
    importNames,
    state: 'unvisited',
    moduleIndex: -1,
  }
}

function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile()
  } catch {
    return false
  }
}

function findModuleStateCall(node: t.Node): string | null {
  let stateCall: string | null = null
  const clone = t.cloneNode(node, true)
  const statement: t.Statement =
    node.type === 'FunctionDeclaration'
      ? (clone as t.FunctionDeclaration)
      : t.expressionStatement(clone as t.Expression)
  const wrapper = t.file(t.program([statement]))
  traverse(wrapper, {
    CallExpression(path: NodePath<t.CallExpression>) {
      const callee = path.node.callee
      if (
        callee.type === 'Identifier' &&
        (callee.name === 'signal' || callee.name === 'derived' || callee.name === 'collection')
      ) {
        stateCall = callee.name
        path.stop()
      }
    },
  })
  return stateCall
}

function resolveModule(fromFile: string, specifier: string): string {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    throw compileError(`non-relative import "${specifier}" is not supported yet`)
  }
  const base = path.resolve(path.dirname(fromFile), specifier)
  const candidates = [base, `${base}.jsx`, `${base}.js`]
  for (const candidate of candidates) {
    if (!isFile(candidate)) continue
    if (!candidate.endsWith('.js') && !candidate.endsWith('.jsx')) {
      throw compileError(`module "${candidate}" must use .js or .jsx`)
    }
    return candidate
  }
  throw compileError(`cannot resolve relative import "${specifier}" from "${fromFile}"`)
}

function loadModule(filePath: string, records: Map<string, ModuleRecord>): ModuleRecord {
  const existing = records.get(filePath)
  if (existing) return existing
  let source: string
  try {
    source = readFileSync(filePath, 'utf8')
  } catch (error) {
    throw new Error(
      `compile: failed to read module "${filePath}": ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
  const record = parseModule(filePath, source)
  records.set(filePath, record)
  return record
}

function hasRenderCall(fn: t.FunctionDeclaration): boolean {
  return fn.body.body.some(
    (statement) =>
      statement.type === 'ExpressionStatement' &&
      statement.expression.type === 'CallExpression' &&
      statement.expression.callee.type === 'Identifier' &&
      statement.expression.callee.name === 'render',
  )
}

function generatedName(record: ModuleRecord, sourceName: string): string {
  return `IrisM${record.moduleIndex}_${sourceName}`
}

function renameModuleBindings(record: ModuleRecord, dependencies: Map<string, ModuleRecord>): void {
  const ownRenames = new Map(record.ownNames.map((name) => [name, generatedName(record, name)]))
  const importRenames = new Map<string, string>()

  for (const spec of record.imports) {
    const dependencyPath = resolveModule(record.filePath, spec.source)
    const dependency = dependencies.get(dependencyPath)
    if (!dependency) {
      throw compileError(`internal module graph entry is missing for "${dependencyPath}"`)
    }
    if (spec.defaultLocal) {
      const target = dependency.exports.get('default')
      if (!target) {
        throw compileError(
          `module "${dependency.filePath}" has no default export for import in "${record.filePath}"`,
        )
      }
      importRenames.set(spec.defaultLocal, generatedName(dependency, target))
    }
    for (const item of spec.named) {
      const target = dependency.exports.get(item.imported)
      if (!target) {
        throw compileError(
          `module "${dependency.filePath}" has no export "${item.imported}" for import in "${record.filePath}"`,
        )
      }
      importRenames.set(item.local, generatedName(dependency, target))
    }
  }

  let foundProgramPath: NodePath<t.Program> | null = null
  traverse(record.ast, {
    Program(path: NodePath<t.Program>) {
      foundProgramPath = path
      path.stop()
    },
  })
  if (!foundProgramPath) {
    throw compileError(`failed to inspect module scope for "${record.filePath}"`)
  }
  const programPath = foundProgramPath as NodePath<t.Program>
  programPath.scope.crawl()

  for (const [sourceName, outputName] of ownRenames) {
    programPath.scope.rename(sourceName, outputName)
  }
  for (const [sourceName, outputName] of importRenames) {
    programPath.scope.crawl()
    if (!programPath.scope.getOwnBinding(sourceName)) {
      throw compileError(`import binding "${sourceName}" was not found in "${record.filePath}"`)
    }
    programPath.scope.rename(sourceName, outputName)
  }

  // Babelのscope.renameは通常のIdentifier参照を変更するが、JSX tagはparser版や
  // binding形状によってreferencePathsに入らないことがある。component名だけは
  // JSXのopening/closing両方をbinding表で補正し、未解決tagがhost要素へ化けるのを
  // 防ぐ。
  const jsxRenames = new Map<string, string>([...ownRenames, ...importRenames])
  traverse(record.ast, {
    JSXOpeningElement(path: NodePath<t.JSXOpeningElement>) {
      const name = path.get('name')
      if (!name.isJSXIdentifier()) return
      const next = jsxRenames.get(name.node.name)
      if (next && /^[A-Z]/.test(name.node.name)) name.node.name = next
    },
    JSXClosingElement(path: NodePath<t.JSXClosingElement>) {
      const name = path.get('name')
      if (!name.isJSXIdentifier()) return
      const next = jsxRenames.get(name.node.name)
      if (next && /^[A-Z]/.test(name.node.name)) name.node.name = next
    },
  })

  const body: t.Statement[] = []
  for (const statement of record.ast.program.body) {
    if (statement.type === 'ImportDeclaration') continue
    if (statement.type === 'ExportNamedDeclaration') {
      if (statement.declaration) body.push(statement.declaration as t.Statement)
      continue
    }
    if (statement.type === 'ExportDefaultDeclaration') {
      if (statement.declaration.type === 'FunctionDeclaration') {
        body.push(statement.declaration)
      }
      continue
    }
    body.push(statement)
  }
  record.ast.program.body = body
}

function linkGraph(entryPath: string): { entry: ModuleRecord; order: ModuleRecord[] } {
  const records = new Map<string, ModuleRecord>()
  const order: ModuleRecord[] = []
  const visit = (filePath: string, stack: string[]): ModuleRecord => {
    const record = loadModule(filePath, records)
    if (record.state === 'visiting') {
      const cycle = [...stack, filePath].join(' -> ')
      throw compileError(`circular module dependency is not supported: ${cycle}`)
    }
    if (record.state === 'done') return record
    record.state = 'visiting'
    for (const spec of record.imports) {
      visit(resolveModule(record.filePath, spec.source), [...stack, record.filePath])
    }
    record.state = 'done'
    record.moduleIndex = order.length
    order.push(record)
    return record
  }
  const entry = visit(entryPath, [])
  const dependencies = new Map(order.map((record) => [record.filePath, record]))
  for (const record of order) renameModuleBindings(record, dependencies)
  return { entry, order }
}

export function linkProject(entryPath: string): LinkedProject {
  const absoluteEntry = path.resolve(entryPath)
  if (!isFile(absoluteEntry)) {
    throw compileError(`entry module "${absoluteEntry}" does not exist`)
  }
  if (!absoluteEntry.endsWith('.js') && !absoluteEntry.endsWith('.jsx')) {
    throw compileError(`entry module "${absoluteEntry}" must use .js or .jsx`)
  }

  const { order } = linkGraph(absoluteEntry)
  const sourceParts: string[] = []
  const supportStatements: string[] = []
  const supportNames = new Set<string>()

  for (const record of order) {
    sourceParts.push(generate(record.ast, { comments: false }).code)
    for (const statement of record.ast.program.body) {
      if (statement.type === 'FunctionDeclaration' && !hasRenderCall(statement)) {
        supportStatements.push(generate(statement, { comments: false }).code)
        if (statement.id) supportNames.add(statement.id.name)
      } else if (statement.type === 'VariableDeclaration') {
        supportStatements.push(generate(statement, { comments: false }).code)
        for (const declarator of statement.declarations) {
          if (declarator.id.type === 'Identifier') supportNames.add(declarator.id.name)
        }
      }
    }
  }

  return {
    source: sourceParts.join('\n'),
    supportStatements,
    supportNames,
  }
}
