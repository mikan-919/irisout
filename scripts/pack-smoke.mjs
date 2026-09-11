import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'

const repoRoot = path.resolve(import.meta.dirname, '..')
const sourcePackageVersion = JSON.parse(
  readFileSync(path.join(repoRoot, 'packages', 'irisout', 'package.json'), 'utf8'),
).version
const packDir = mkdtempSync(path.join(os.tmpdir(), 'irisout-pack-'))
const fixtureDir = mkdtempSync(path.join(os.tmpdir(), 'irisout-consumer-'))

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    env: process.env,
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
    'package/dist/jsx.d.ts',
  ]) {
    if (!files.includes(expected)) throw new Error(`pack smoke: ${expected} missing from tarball`)
  }
  return tarball
}

const packageSpec = registryPackage ?? `file:${pack()}`
mkdirSync(path.join(fixtureDir, 'src'))
const packageJson = {
  name: 'irisout-pack-smoke-consumer',
  private: true,
  type: 'module',
  scripts: { build: 'vp build', typecheck: 'tsc --noEmit' },
  dependencies: {
    irisout: packageSpec,
  },
  overrides: {
    irisout: packageSpec,
  },
  devDependencies: { typescript: '^5.9.0', 'vite-plus': '0.3.0' },
}
writeFileSync(path.join(fixtureDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)
writeFileSync(
  path.join(fixtureDir, 'index.html'),
  '<!doctype html><div id="app"><!--irisout-html--></div><script type="module" src="/src/main.js"></script>\n',
)
writeFileSync(
  path.join(fixtureDir, 'src/App.jsx'),
  `export function App() {\n  const count = signal(0);\n  const items = signal([{ id: 1, text: 'a' }]);\n  render(<div><button onClick={increment}>{count()}</button><ul>{items().map((item) => <li key={item.id}>{item.text}</li>)}</ul></div>);\n  function increment() {\n    console.log('irisout-pack-source-map');\n    items((previous) => previous.map((item) => item.id === 1 ? { ...item, text: item.text + '!' } : item));\n    count((previous) => previous + 1);\n  }\n}\n`,
)
writeFileSync(path.join(fixtureDir, 'src/main.js'), "import 'virtual:irisout-entry'\n")
writeFileSync(
  path.join(fixtureDir, 'tsconfig.json'),
  `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        allowJs: true,
        checkJs: true,
        jsx: 'preserve',
        types: ['irisout/jsx'],
        noEmit: true,
        skipLibCheck: true,
      },
      include: ['src/**/*.jsx'],
    },
    null,
    2,
  )}\n`,
)
writeFileSync(
  path.join(fixtureDir, 'vite.config.ts'),
  `import { defineConfig } from 'vite-plus';\nimport { irisout } from 'irisout/vite';\nexport default defineConfig({ plugins: [irisout({ entry: 'src/App.jsx' })], build: { sourcemap: true, minify: false } });\n`,
)

try {
  run('bun', ['install', '--no-progress'], fixtureDir)
  if (!existsSync(path.join(fixtureDir, 'node_modules/irisout/dist/LICENSE'))) {
    throw new Error('pack smoke: license missing')
  }
  run('bun', ['run', 'typecheck'], fixtureDir)
  run('bun', ['run', 'build'], fixtureDir)
  const dist = path.join(fixtureDir, 'dist')
  if (!existsSync(path.join(dist, 'index.html'))) throw new Error('pack smoke: index.html missing')
  const html = readFileSync(path.join(dist, 'index.html'), 'utf8')
  const app = readdirSync(path.join(dist, 'assets'))
    .filter((name) => name.endsWith('.js'))
    .map((name) => readFileSync(path.join(dist, 'assets', name), 'utf8'))
    .join('\n')
  if (
    !html.includes('<button') ||
    !app.includes('addEventListener') ||
    !app.includes('reconcileList')
  ) {
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
  const needle = 'irisout-pack-source-map'
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
  if (!original.source?.endsWith('src/App.jsx') || original.line !== 6) {
    throw new Error(
      `pack smoke: expected handler source src/App.jsx:6, received ${original.source}:${original.line}`,
    )
  }
  console.log(`pack smoke passed: ${fixtureDir}`)
} finally {
  if (process.env.IRISOUT_PACK_SMOKE_KEEP !== '1') {
    rmSync(packDir, { recursive: true, force: true })
    rmSync(fixtureDir, { recursive: true, force: true })
  }
}
