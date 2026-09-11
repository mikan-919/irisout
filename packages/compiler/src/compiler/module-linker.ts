// compileProject()が使う静的module linker。入口から相対importを辿り、ASTの
// bindingをmodule固有名へ変更してから一つのprogramへ連結する。対象は小規模な
// .js/.jsx moduleで、外部moduleとViteの資源importはそのまま生成moduleへ渡す。

import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import generateImport from '@babel/generator'
import { parse } from '@babel/parser'
import type { NodePath } from '@babel/traverse'
import traverseImport from '@babel/traverse'
import * as t from '@babel/types'
import { withCompileDiagnostic, type DiagnosticOrigin } from '../diagnostics.ts'

const traverse =
  (traverseImport as unknown as { default?: typeof traverseImport }).default ?? traverseImport
const generate =
  (generateImport as unknown as { default?: typeof generateImport }).default ?? generateImport

interface ImportSpec {
  source: string
  defaultLocal: string | null
  named: { imported: string; local: string }[]
}

interface ExternalImportSpec {
  statement: t.ImportDeclaration
  resourcePath: string | null
  usedLocals: Set<string>
}

interface ModuleRecord {
  filePath: string
  source: string
  ast: t.File
  imports: ImportSpec[]
  externalImports: ExternalImportSpec[]
  resourceDependencies: Set<string>
  externalStatements: string[]
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
  /** 外部moduleとViteの資源import。compilerのAST解析へ入れず生成moduleへ残す。 */
  externalImports: string[]
  /** compileProject()の利用側が相対moduleを監視できる絶対pathの一覧。 */
  dependencies: string[]
  /** 連結後ソースの範囲と元モジュールの対応。診断位置の復元に使う。 */
  origins: DiagnosticOrigin[]
}

function compileError(message: string): Error {
  return new Error(`compile: ${message} (scope limit)`)
}

function parseModule(filePath: string, source: string): ModuleRecord {
  try {
    return parseModuleUnchecked(filePath, source)
  } catch (error) {
    throw withCompileDiagnostic(error, { filePath, source })
  }
}

function parseModuleUnchecked(filePath: string, source: string): ModuleRecord {
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
  const externalImports: ExternalImportSpec[] = []
  const resourceDependencies = new Set<string>()
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
        const isSharedState =
          (stateCall === 'signal' && isSharedSignalDeclarator(declarator)) ||
          (stateCall === 'derived' && isSharedDerivedDeclarator(declarator))
        if (!isSharedState) {
          throw compileError(
            `module "${filePath}" cannot declare module-scope ${stateCall}() state`,
          )
        }
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
      const source = statement.source.value
      const isRelative = source.startsWith('./') || source.startsWith('../')
      const resourcePath = isRelative ? resolveResource(source, filePath) : null
      const isResource = resourcePath !== null
      if (isRelative && !isResource && statement.specifiers.length === 0) {
        throw compileError(`side-effect imports are not supported in module "${filePath}"`)
      }
      const spec: ImportSpec = {
        source,
        defaultLocal: null,
        named: [],
      }
      for (const specifier of statement.specifiers) {
        if (specifier.type === 'ImportNamespaceSpecifier') {
          if (!isRelative || isResource) {
            addImportName(specifier.local.name)
            continue
          }
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
      if (!isRelative || isResource) {
        externalImports.push({ statement, resourcePath, usedLocals: new Set() })
        if (resourcePath) resourceDependencies.add(resourcePath)
      } else {
        if (statement.specifiers.length === 0) {
          throw compileError(`side-effect imports are not supported in module "${filePath}"`)
        }
        imports.push(spec)
      }
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
    source,
    ast,
    imports,
    externalImports,
    resourceDependencies,
    externalStatements: [],
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

function resolveResource(specifier: string, fromFile: string): string | null {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null
  const resourceSpecifier = specifier.split(/[?#]/, 1)[0] ?? specifier
  const extension = path.extname(resourceSpecifier)
  const hasQuery = resourceSpecifier !== specifier
  if (!hasQuery && (extension === '' || extension === '.js' || extension === '.jsx')) {
    return null
  }
  const resourcePath = path.resolve(path.dirname(fromFile), resourceSpecifier)
  if (!isFile(resourcePath)) {
    throw compileError(`cannot resolve resource import "${specifier}" from "${fromFile}"`)
  }
  return resourcePath
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
      if (callee.type === 'Identifier' && (callee.name === 'signal' || callee.name === 'derived')) {
        stateCall = callee.name
        path.stop()
      }
    },
  })
  return stateCall
}

function isContextDeclarator(declarator: t.VariableDeclarator): boolean {
  const init = declarator.init
  return (
    declarator.id.type === 'Identifier' &&
    init?.type === 'CallExpression' &&
    init.callee.type === 'Identifier' &&
    (init.callee.name === 'createContext' || init.callee.name === 'createAsyncContext') &&
    init.arguments.length === 1 &&
    init.arguments[0]?.type !== 'SpreadElement'
  )
}

function isSharedSignalDeclarator(declarator: t.VariableDeclarator): boolean {
  const init = declarator.init
  return (
    declarator.id.type === 'Identifier' &&
    init?.type === 'CallExpression' &&
    init.callee.type === 'Identifier' &&
    init.callee.name === 'signal' &&
    init.arguments.length === 1 &&
    init.arguments[0]?.type !== 'SpreadElement'
  )
}

function isSharedDerivedDeclarator(declarator: t.VariableDeclarator): boolean {
  const init = declarator.init
  const argument = init?.type === 'CallExpression' ? init.arguments[0] : null
  return (
    declarator.id.type === 'Identifier' &&
    init?.type === 'CallExpression' &&
    init.callee.type === 'Identifier' &&
    init.callee.name === 'derived' &&
    init.arguments.length === 1 &&
    argument?.type === 'ArrowFunctionExpression' &&
    argument.params.length === 0 &&
    argument.body.type !== 'BlockStatement'
  )
}

function isSharedStateDeclarator(declarator: t.VariableDeclarator): boolean {
  return isSharedSignalDeclarator(declarator) || isSharedDerivedDeclarator(declarator)
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
    throw withCompileDiagnostic(
      new Error(
        `compile: failed to read module "${filePath}": ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      ),
      { filePath, source: '' },
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
  try {
    renameModuleBindingsUnchecked(record, dependencies)
  } catch (error) {
    throw withCompileDiagnostic(error, { filePath: record.filePath, source: record.source })
  }
}

function renameModuleBindingsUnchecked(
  record: ModuleRecord,
  dependencies: Map<string, ModuleRecord>,
): void {
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

  for (const external of record.externalImports) {
    for (const specifier of external.statement.specifiers) {
      const localName = specifier.local.name
      const binding = programPath.scope.getBinding(localName)
      if ((binding?.referencePaths.length ?? 0) === 0) continue
      const outputName = generatedName(record, localName)
      external.usedLocals.add(outputName)
      importRenames.set(localName, outputName)
    }
  }

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

  record.externalStatements = []
  for (const external of record.externalImports) {
    if (external.statement.specifiers.length === 0) {
      record.externalStatements.push(generate(external.statement, { comments: false }).code)
      continue
    }
    external.statement.specifiers = external.statement.specifiers.filter((specifier) =>
      external.usedLocals.has(specifier.local.name),
    )
    if (external.statement.specifiers.length > 0) {
      record.externalStatements.push(generate(external.statement, { comments: false }).code)
    }
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
      throw withCompileDiagnostic(
        compileError(`circular module dependency is not supported: ${cycle}`),
        {
          filePath: record.filePath,
          source: record.source,
        },
      )
    }
    if (record.state === 'done') return record
    record.state = 'visiting'
    for (const spec of record.imports) {
      try {
        visit(resolveModule(record.filePath, spec.source), [...stack, record.filePath])
      } catch (error) {
        throw withCompileDiagnostic(error, { filePath: record.filePath, source: record.source })
      }
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
    throw withCompileDiagnostic(compileError(`entry module "${absoluteEntry}" does not exist`), {
      filePath: absoluteEntry,
      source: '',
    })
  }
  if (!absoluteEntry.endsWith('.js') && !absoluteEntry.endsWith('.jsx')) {
    throw withCompileDiagnostic(
      compileError(`entry module "${absoluteEntry}" must use .js or .jsx`),
      {
        filePath: absoluteEntry,
        source: '',
      },
    )
  }

  const { order } = linkGraph(absoluteEntry)
  const sourceParts: string[] = []
  const origins: DiagnosticOrigin[] = []
  const supportStatements: string[] = []
  const supportNames = new Set<string>()
  const externalImports: string[] = []
  const dependencies = new Set<string>()

  for (const record of order) {
    // 元ASTの行を保つことで、連結後のcompile errorを元モジュールの行へ
    // 戻せる。生成module向けのsupport statementとは異なり、ここは診断位置
    // のための中間ソースである。
    const generated = generate(record.ast, { comments: false, retainLines: true }).code
    const generatedStart = sourceParts.length === 0 ? 0 : sourceParts.join('\n').length + 1
    sourceParts.push(generated)
    origins.push({
      generatedStart,
      generatedEnd: generatedStart + generated.length,
      filePath: record.filePath,
      source: record.source,
    })
    externalImports.push(...record.externalStatements)
    dependencies.add(record.filePath)
    for (const resourcePath of record.resourceDependencies) dependencies.add(resourcePath)
    for (const statement of record.ast.program.body) {
      if (statement.type === 'FunctionDeclaration' && !hasRenderCall(statement)) {
        supportStatements.push(generate(statement, { comments: false }).code)
        if (statement.id) supportNames.add(statement.id.name)
      } else if (statement.type === 'VariableDeclaration') {
        const supportDeclarators = statement.declarations.filter(
          (declarator) => !isContextDeclarator(declarator) && !isSharedStateDeclarator(declarator),
        )
        if (supportDeclarators.length > 0) {
          const supportStatement = t.variableDeclaration(statement.kind, supportDeclarators)
          supportStatements.push(generate(supportStatement, { comments: false }).code)
        }
        for (const declarator of supportDeclarators) {
          if (declarator.id.type === 'Identifier') supportNames.add(declarator.id.name)
        }
      }
    }
  }

  return {
    source: sourceParts.join('\n'),
    supportStatements,
    supportNames,
    externalImports: [...new Set(externalImports)],
    dependencies: [...dependencies],
    origins,
  }
}
