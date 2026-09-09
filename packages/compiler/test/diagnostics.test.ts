import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import { CompileDiagnostic, compile, compileProject } from '../src/compiler.js'

describe('compile diagnostics', () => {
  it('keeps parser line and column in a source diagnostic', () => {
    const source = `export function App() {
  render(<div>
}`
    let caught: unknown
    try {
      compile(source)
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(CompileDiagnostic)
    const diagnostic = caught as CompileDiagnostic
    expect(diagnostic.filePath).toBe('<source>')
    expect(diagnostic.line).toBeGreaterThan(1)
    expect(diagnostic.column).toBeGreaterThan(0)
    expect(diagnostic.message).toMatch(/\[<source>:\d+:\d+\]$/)
  })

  it('points module boundary errors to the importing file and specifier', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'irisout-diagnostics-'))
    const entry = path.join(root, 'main.jsx')
    mkdirSync(root, { recursive: true })
    writeFileSync(
      entry,
      `import { missing } from './missing.js'
export function App() { render(<div>{missing}</div>) }`,
    )

    let caught: unknown
    try {
      compileProject(entry)
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(CompileDiagnostic)
    const diagnostic = caught as CompileDiagnostic
    expect(diagnostic.filePath).toBe(entry)
    expect(diagnostic.line).toBe(1)
    expect(diagnostic.column).toBeGreaterThan(1)
    expect(diagnostic.message).toContain(`cannot resolve relative import`)
    expect(diagnostic.message).toMatch(new RegExp(`\\[${entry}:1:\\d+\\]$`))
  })

  it('points compiler errors in a linked child module to the child JSX location', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'irisout-child-diagnostics-'))
    const entry = path.join(root, 'main.jsx')
    const child = path.join(root, 'Child.jsx')
    mkdirSync(root, { recursive: true })
    writeFileSync(
      entry,
      `import Child from './Child.jsx'
export function App() {
  render(<Child />)
}`,
    )
    writeFileSync(
      child,
      `export default function Child() {
  const count = signal(0)
  render(
    <div {...{ class: 'unsupported' }}>{count()}</div>,
  )
}`,
    )

    let caught: unknown
    try {
      compileProject(entry)
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(CompileDiagnostic)
    const diagnostic = caught as CompileDiagnostic
    expect(diagnostic.filePath).toBe(child)
    expect(diagnostic.line).toBe(4)
    expect(diagnostic.column).toBeGreaterThan(4)
    expect(diagnostic.message).toContain('host element attributes')
  })

  it.each([
    ['TryStatement', '    try {\n      count(count() + 1)\n    } catch {}'],
    ['ForStatement', '    for (let index = 0; index < 1; index++) {\n      count(index)\n    }'],
  ])('points unsupported %s handler syntax to the rejected statement', (statement, body) => {
    const source = `export function App() {
  const count = signal(0)
  render(<button onClick={update}>{count()}</button>)
  function update() {
${body}
  }
}`

    let caught: unknown
    try {
      compile(source)
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(CompileDiagnostic)
    const diagnostic = caught as CompileDiagnostic
    expect(diagnostic.filePath).toBe('<source>')
    expect(diagnostic.line).toBe(5)
    expect(diagnostic.column).toBe(5)
    expect(diagnostic.message).toContain(`handler statement "${statement}"`)
  })
})
