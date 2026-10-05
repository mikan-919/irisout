// 比較対象を固定したコミットから取得し、Bunで測定専用依存を導入する。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
const root = import.meta.dirname
const checkout = process.env.RSHONO_CHECKOUT ?? '/tmp/irisout-rshono-comparison'
const app = process.env.RSHONO_APP ?? '/tmp/irisout-rshono-app'
const commit = '532edf8e53b70f78c05a4385d4938c06de79965b'
if (!fs.existsSync(checkout))
  execFileSync('git', ['clone', 'https://github.com/rshono/rshono.git', checkout], {
    stdio: 'inherit',
  })
if (
  execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== commit
)
  execFileSync('git', ['-C', checkout, 'checkout', '--detach', commit], { stdio: 'inherit' })
if (!fs.existsSync(app))
  fs.cpSync(checkout + '/packages/benchmarks/apps/rshono', app, { recursive: true })
const manifest = JSON.parse(fs.readFileSync(app + '/package.json'))
manifest.dependencies['@rshono/core'] = '1.0.0-rc.24'
manifest.dependencies.hono = '4.13.8'
delete manifest.devDependencies
fs.writeFileSync(app + '/package.json', JSON.stringify(manifest, null, 2) + '\n')
fs.mkdirSync(app + '/src/generated', { recursive: true })
fs.copyFileSync(
  checkout + '/packages/benchmarks/fixtures/data.json',
  app + '/src/generated/data.json',
)
fs.copyFileSync(root + '/rshono-app.bun.lock', app + '/bun.lock')
execFileSync('bun', ['install', '--frozen-lockfile', '--cwd', app], { stdio: 'inherit' })
execFileSync('bun', ['run', 'build:packages'], {
  cwd: path.resolve(root, '../../..'),
  stdio: 'inherit',
})
fs.mkdirSync(root + '/irisout/node_modules', { recursive: true })
if (!fs.existsSync(root + '/irisout/node_modules/irisout'))
  fs.symlinkSync('../../../../irisout', root + '/irisout/node_modules/irisout')
