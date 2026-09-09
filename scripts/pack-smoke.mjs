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

const repoRoot = path.resolve(import.meta.dirname, '..')
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
  return path.resolve(output.split('\n').at(-1))
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
  `export function App() {\n  const count = signal(0);\n  render(<button onClick={() => count(count() + 1)}>{count()}</button>);\n}\n`,
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
  `import { defineConfig } from 'vite-plus';\nimport { irisout } from 'irisout/vite';\nexport default defineConfig({ plugins: [irisout({ entry: 'src/App.jsx' })] });\n`,
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
  if (!html.includes('<button') || !app.includes('addEventListener')) {
    throw new Error('pack smoke: generated runtime entry missing')
  }
  const lockfile = readFileSync(path.join(fixtureDir, 'bun.lock'), 'utf8')
  if (lockfile.includes('workspace:')) throw new Error('pack smoke: workspace dependency leaked')
  console.log(`pack smoke passed: ${fixtureDir}`)
} finally {
  if (process.env.IRISOUT_PACK_SMOKE_KEEP !== '1') {
    rmSync(packDir, { recursive: true, force: true })
    rmSync(fixtureDir, { recursive: true, force: true })
  }
}
