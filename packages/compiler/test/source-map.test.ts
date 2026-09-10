import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'
import { describe, expect, it } from 'vite-plus/test'
import { compile, compileProject, type CompileResult } from '../src/compiler.ts'

function generatedPosition(code: string, needle: string, occurrence = 1) {
  let offset = -1
  for (let index = 0; index < occurrence; index++) offset = code.indexOf(needle, offset + 1)
  expect(offset).toBeGreaterThanOrEqual(0)
  const before = code.slice(0, offset)
  return {
    line: before.split('\n').length,
    column: offset - before.lastIndexOf('\n') - 1,
  }
}

function originalFor(result: CompileResult, needle: string, occurrence = 1) {
  return originalPositionFor(
    new TraceMap(result.map),
    generatedPosition(result.code, needle, occurrence),
  )
}

describe('runtime source maps', () => {
  it('maps each root handler statement without confusing duplicate source text', () => {
    const source = `export function App() {
  render(<button onClick={run}>実行</button>)
  function run() {
    console.log('same')
    console.log('same')
  }
}`
    const result = compile(source)

    expect(result.code).not.toContain('__IRISOUT_MAP_')
    expect(originalFor(result, "console.log('same')", 1)).toMatchObject({
      source: '<source>',
      line: 4,
      column: 4,
    })
    expect(originalFor(result, "console.log('same')", 2)).toMatchObject({
      source: '<source>',
      line: 5,
      column: 4,
    })
  })

  it('maps async handler statements on both sides of await', () => {
    const source = `export function App() {
  render(<button onClick={run}>実行</button>)
  async function run() {
    console.log('before')
    await Promise.resolve()
    JSON.parse('after')
  }
}`
    const result = compile(source)

    expect(originalFor(result, "console.log('before')")).toMatchObject({ line: 4, column: 4 })
    expect(originalFor(result, 'await Promise.resolve()')).toMatchObject({ line: 5, column: 4 })
    expect(originalFor(result, "JSON.parse('after')")).toMatchObject({ line: 6, column: 4 })
  })

  it('maps a linked child handler to the child module', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'irisout-source-map-'))
    const entry = path.join(root, 'App.jsx')
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
  render(<button onClick={run}>実行</button>)
  function run() {
    JSON.parse('child')
  }
}`,
    )

    const result = compileProject(entry)
    expect(originalFor(result, "JSON.parse('child')")).toMatchObject({
      source: child,
      line: 4,
      column: 4,
    })
  })

  it('maps use action setup, update, and destroy bodies', () => {
    const source = `export function App() {
  render(<div use={observe}>対象</div>)
  function observe(element) {
    console.log('action setup', element)
    return {
      update() {
        console.log('action update', element)
      },
      destroy() {
        console.log('action destroy', element)
      }
    }
  }
}`
    const result = compile(source)

    expect(originalFor(result, "console.log('action setup'")).toMatchObject({ line: 4 })
    expect(originalFor(result, "console.log('action update'")).toMatchObject({ line: 7 })
    expect(originalFor(result, "console.log('action destroy'")).toMatchObject({ line: 10 })
  })

  it('maps onMount and effect setup and cleanup bodies', () => {
    const source = `export function App() {
  const count = signal(0)
  render(<output>{count()}</output>)
  onMount(() => {
    console.log('mount setup')
    return () => {
      console.log('mount cleanup')
    }
  })
  effect(() => {
    console.log('effect setup', count())
    return () => {
      console.log('effect cleanup')
    }
  })
}`
    const result = compile(source)

    expect(originalFor(result, "console.log('mount setup')")).toMatchObject({ line: 5 })
    expect(originalFor(result, "console.log('mount cleanup')")).toMatchObject({ line: 7 })
    expect(originalFor(result, "console.log('effect setup'")).toMatchObject({ line: 11 })
    expect(originalFor(result, "console.log('effect cleanup')")).toMatchObject({ line: 13 })
  })

  it('maps lifecycle bodies owned by a keyed structural unit', () => {
    const source = `function Row({ item }) {
  render(<li key={item.id}>{item.label}</li>)
  onMount(() => {
    console.log('unit mount', item.id)
    return () => console.log('unit mount cleanup', item.id)
  })
  effect(() => {
    console.log('unit effect', item.id)
    return () => console.log('unit effect cleanup', item.id)
  })
}
export function App() {
  const items = signal([{ id: 1, label: 'a' }])
  render(<ul>{items().map((item) => <Row key={item.id} item={item} />)}</ul>)
}`
    const result = compile(source)

    expect(originalFor(result, "console.log('unit mount'")).toMatchObject({ line: 4 })
    expect(originalFor(result, "console.log('unit mount cleanup'")).toMatchObject({ line: 5 })
    expect(originalFor(result, "console.log('unit effect'")).toMatchObject({ line: 8 })
    expect(originalFor(result, "console.log('unit effect cleanup'")).toMatchObject({ line: 9 })
  })
})
