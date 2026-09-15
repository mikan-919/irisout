import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'

const repoRoot = path.resolve(import.meta.dirname, '..')
const sourcePackageVersion = JSON.parse(
  readFileSync(path.join(repoRoot, 'packages', 'irisout', 'package.json'), 'utf8'),
).version
const packDir = mkdtempSync(path.join(os.tmpdir(), 'irisout-pack-'))
const fixtureDir = mkdtempSync(path.join(os.tmpdir(), 'irisout-consumer-'))

function run(command, args, cwd, env = {}) {
  return execFileSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  })
}

const registryPackage = process.env.IRISOUT_PACKAGE_SPEC
if (!registryPackage) run('node', [path.join(repoRoot, 'scripts/build-packages.mjs')], repoRoot)

function pack() {
  const packageDir = path.join(repoRoot, 'packages', 'irisout')
  const output = execFileSync('bun', ['pm', 'pack', '--destination', packDir, '--quiet'], {
    cwd: packageDir,
    env: process.env,
    encoding: 'utf8',
  }).trim()
  const tarball = path.resolve(output.split('\n').at(-1))
  const files = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).trim().split('\n')
  for (const expected of [
    'package/package.json',
    'package/README.md',
    'package/CHANGELOG.md',
    'package/dist/LICENSE',
    'package/dist/index.js',
    'package/dist/vite.js',
    'package/dist/ssr.js',
    'package/dist/ssr.d.ts',
    'package/dist/jsx.d.ts',
    'package/dist/compiler/source.d.ts',
    'package/dist/compiler/state.d.ts',
    'package/dist/source-map.d.ts',
  ]) {
    if (!files.includes(expected)) throw new Error(`pack smoke: ${expected} missing from tarball`)
  }
  if (
    files.some(
      (file) =>
        file.startsWith('package/dist/compiler/') &&
        !file.endsWith('/') &&
        !file.endsWith('/source.d.ts') &&
        !file.endsWith('/state.d.ts'),
    )
  ) {
    throw new Error('pack smoke: internal compiler declarations leaked into tarball')
  }
  if (!registryPackage) {
    for (const expected of ['package/dist/browser.js', 'package/dist/browser.d.ts']) {
      if (!files.includes(expected)) throw new Error(`pack smoke: ${expected} missing from tarball`)
    }
  }
  return tarball
}

const packageSpec = registryPackage ?? `file:${pack()}`
cpSync(path.join(repoRoot, 'examples', 'consumer-app'), fixtureDir, {
  recursive: true,
  filter: (source) => !['dist', 'node_modules'].includes(path.basename(source)),
})
const fixturePackagePath = path.join(fixtureDir, 'package.json')
const packageJson = JSON.parse(readFileSync(fixturePackagePath, 'utf8'))
packageJson.dependencies.irisout = packageSpec
packageJson.overrides = { irisout: packageSpec }
packageJson.devDependencies.typescript = '^5.9.0'
packageJson.devDependencies['@types/node'] = '^24.0.0'
writeFileSync(path.join(fixtureDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)

if (!registryPackage) {
  const tsconfigPath = path.join(fixtureDir, 'tsconfig.json')
  const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8'))
  tsconfig.compilerOptions.skipLibCheck = false
  tsconfig.compilerOptions.lib = ['ESNext', 'DOM', 'DOM.Iterable']
  tsconfig.include = ['src/**/*.jsx', 'src/public-api.ts']
  writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`)
  writeFileSync(
    path.join(fixtureDir, 'src/public-api.ts'),
    `import { compile, compileProject } from 'irisout'
import { compile as compileBrowser } from 'irisout/browser'
import { irisoutSsr, serializeSsrState } from 'irisout/ssr'
import {
  createCompilerState,
  toContextId,
  toDeclId,
  toMarkerId,
  type CompilerState,
  type ContextId,
  type DeclId,
  type MarkerId,
} from 'irisout/state'

const compilerState: CompilerState = createCompilerState('')
const ids: [DeclId, MarkerId, ContextId] = [
  toDeclId('decl_0'),
  toMarkerId('m0'),
  toContextId('ctx_0'),
]
const clientResult = compile('')
const projectResult = compileProject('src/App.jsx', { target: 'client' })
const browserResult = compileBrowser('')
const ssrPlugin = irisoutSsr({ entry: 'src/App.jsx' })
const serializedState = serializeSsrState({ ok: true })

void [compilerState, ids, clientResult, projectResult, browserResult, ssrPlugin, serializedState]
`,
  )
}

try {
  run('bun', ['install', '--no-progress'], fixtureDir)
  if (!existsSync(path.join(fixtureDir, 'node_modules/irisout/dist/LICENSE'))) {
    throw new Error('pack smoke: license missing')
  }
  run(
    'node',
    [
      '--input-type=module',
      '-e',
      "const compiler = await import('irisout'); const browser = await import('irisout/browser'); const ssr = await import('irisout/ssr'); const state = await import('irisout/state'); if (typeof compiler.compile !== 'function' || typeof browser.compile !== 'function' || typeof ssr.irisoutSsr !== 'function' || typeof ssr.serializeSsrState !== 'function' || typeof state.toDeclId !== 'function') throw new Error('pack smoke: public export missing')",
    ],
    fixtureDir,
  )
  if (!registryPackage) {
    const browserCode = readFileSync(
      path.join(fixtureDir, 'node_modules/irisout/dist/browser.js'),
      'utf8',
    )
    if (/['"]node:(?:fs|path)['"]/.test(browserCode)) {
      throw new Error('pack smoke: browser compiler contains a Node file module')
    }
    if (browserCode.includes('module-linker')) {
      throw new Error('pack smoke: browser compiler contains the module linker')
    }

    const workerFile = path.join(fixtureDir, 'browser-compiler-worker.mjs')
    writeFileSync(
      workerFile,
      `import { parentPort } from 'node:worker_threads'\nimport { compile } from 'irisout/browser'\n\nparentPort.on('message', (source) => {\n  try {\n    const result = compile(source)\n    parentPort.postMessage({ ok: true, initialHtml: result.initialHtml })\n  } catch (error) {\n    parentPort.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) })\n  }\n})\n`,
    )
    const workerResult = await new Promise((resolve, reject) => {
      const worker = new Worker(workerFile)
      worker.once('message', (message) => {
        void worker.terminate()
        resolve(message)
      })
      worker.once('error', (error) => {
        void worker.terminate()
        reject(error)
      })
      worker.postMessage(`export function App() { render(<button>browser worker</button>); }`)
    })
    if (
      workerResult?.ok !== true ||
      workerResult.initialHtml !== '<button>browser worker</button>'
    ) {
      throw new Error(`pack smoke: browser compiler worker failed: ${JSON.stringify(workerResult)}`)
    }
  }
  run('bun', ['run', 'typecheck'], fixtureDir)
  run('bun', ['run', 'build'], fixtureDir, { IRISOUT_SOURCEMAP: 'true' })
  const dist = path.join(fixtureDir, 'dist')
  if (!existsSync(path.join(dist, 'index.html'))) throw new Error('pack smoke: index.html missing')
  const html = readFileSync(path.join(dist, 'index.html'), 'utf8')
  const app = readdirSync(path.join(dist, 'assets'))
    .filter((name) => name.endsWith('.js'))
    .map((name) => readFileSync(path.join(dist, 'assets', name), 'utf8'))
    .join('\n')
  if (!html.includes('別アプリからの文章') || !app.includes('addEventListener')) {
    throw new Error('pack smoke: generated runtime entry missing')
  }
  const lockfile = readFileSync(path.join(fixtureDir, 'bun.lock'), 'utf8')
  if (lockfile.includes('workspace:')) throw new Error('pack smoke: workspace dependency leaked')
  const packageVersion = JSON.parse(
    readFileSync(path.join(fixtureDir, 'node_modules/irisout/package.json'), 'utf8'),
  ).version
  if (!registryPackage && packageVersion !== sourcePackageVersion) {
    throw new Error(
      `pack smoke: expected irisout ${sourcePackageVersion}, received ${packageVersion}`,
    )
  }
  const assetNames = readdirSync(path.join(dist, 'assets'))
  const jsName = assetNames.find((name) => name.endsWith('.js'))
  const mapName = assetNames.find((name) => name.endsWith('.js.map'))
  if (!jsName || !mapName) throw new Error('pack smoke: production source map missing')
  const code = readFileSync(path.join(dist, 'assets', jsName), 'utf8')
  const needle = 'text = event.currentTarget.value'
  const offset = code.indexOf(needle)
  if (offset < 0) throw new Error('pack smoke: mapped handler statement missing')
  const before = code.slice(0, offset)
  const original = originalPositionFor(
    new TraceMap(JSON.parse(readFileSync(path.join(dist, 'assets', mapName), 'utf8'))),
    {
      line: before.split('\n').length,
      column: offset - before.lastIndexOf('\n') - 1,
    },
  )
  if (!original.source?.endsWith('src/App.jsx') || original.line !== 11) {
    throw new Error(
      `pack smoke: expected handler source src/App.jsx:11, received ${original.source}:${original.line}`,
    )
  }
  console.log(`pack smoke passed: ${fixtureDir}`)
} finally {
  if (process.env.IRISOUT_PACK_SMOKE_KEEP !== '1') {
    rmSync(packDir, { recursive: true, force: true })
    rmSync(fixtureDir, { recursive: true, force: true })
  }
}
