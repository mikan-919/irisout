// 対応前後のコンパイラへ同じ最小例を渡し、生成物の実行結果を保存する。
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { compile as currentCompile } from '../../packages/compiler/src/compiler.ts'
import { createContainer, loadGenerated } from '../../packages/compiler/test/helpers.ts'

const compile = process.env.IRISOUT_BASELINE_COMPILER
  ? (await import(pathToFileURL(path.resolve(process.env.IRISOUT_BASELINE_COMPILER)).href)).compile
  : currentCompile
const bodies = {
  constAlias: `function run() { function write() { count(1); } const alias = write; alias(); }`,
  parameter: `function run() { function invoke(fn) { fn(); } function write() { count(1); } invoke(write); }`,
  storedCleanup: `function run() { count(1); } onMount(() => { const cleanup = () => { globalThis.__boundaryRepro.push('cleanup'); }; return cleanup; });`,
  reservedName: `function run() { __container__(); } function __container__() { count(1); }`,
}
const cases = []
for (const [name, body] of Object.entries(bodies)) {
  const source = `export function App() { const count = signal(0); render(<button onClick={run}>{count()}</button>); ${body} }`
  globalThis.__boundaryRepro = []
  try {
    const compiled = compile(source)
    const module = await loadGenerated(compiled.code)
    const container = createContainer()
    const instance = module.mountComponent(container)
    container
      .querySelector('button')
      .dispatchEvent(new container.ownerDocument.defaultView.Event('click'))
    const text = container.textContent
    instance.unmount()
    cases.push({
      name,
      accepted: true,
      text,
      cleanup: [...globalThis.__boundaryRepro],
      pass:
        text === '1' && (name !== 'storedCleanup' || globalThis.__boundaryRepro[0] === 'cleanup'),
    })
  } catch (error) {
    cases.push({ name, accepted: false, error: error.message })
  }
}
delete globalThis.__boundaryRepro
const result = {
  date: '2026-10-19',
  baseline: process.env.IRISOUT_BASELINE_COMPILER ?? null,
  cases,
}
const target = process.env.IRISOUT_BOUNDARY_RESULT ?? '/tmp/irisout-javascript-boundaries.json'
await Bun.write(target, JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
