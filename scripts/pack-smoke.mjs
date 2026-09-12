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
    'package/dist/jsx.d.ts',
  ]) {
    if (!files.includes(expected)) throw new Error(`pack smoke: ${expected} missing from tarball`)
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
writeFileSync(path.join(fixtureDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)

try {
  run('bun', ['install', '--no-progress'], fixtureDir)
  if (!existsSync(path.join(fixtureDir, 'node_modules/irisout/dist/LICENSE'))) {
    throw new Error('pack smoke: license missing')
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
