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
})
