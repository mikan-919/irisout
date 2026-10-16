// 上流の測定器と本番実装を準備する。依存は上流の固定ファイルからBunで導入する。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { checkout, frameworks, root, upstreamCommit, workspace } from './config.mjs'

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}
if (!fs.existsSync(checkout)) {
  run('git', [
    'clone',
    '--depth',
    '1',
    'https://github.com/krausest/js-framework-benchmark.git',
    checkout,
  ])
}
const actual = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: checkout,
  encoding: 'utf8',
}).trim()
if (actual !== upstreamCommit) {
  run('git', ['fetch', '--depth', '1', 'origin', upstreamCommit], checkout)
  run('git', ['checkout', '--detach', upstreamCommit], checkout)
}

for (const directory of [
  'server',
  'webdriver-ts',
  ...frameworks
    .filter((name) => !['irisout', 'vanillajs'].includes(name))
    .map((name) => `frameworks/keyed/${name}`),
]) {
  const cwd = path.join(checkout, directory)
  // 上流の固定package-lockから毎回移行し、別の試行の解決結果を混ぜない。
  fs.rmSync(path.join(cwd, 'bun.lock'), { force: true })
  run(process.execPath, ['install', '--ignore-scripts'], cwd)
}
for (const [directory, dependency] of [
  ['react-hooks', 'react'],
  ['vue', 'vue'],
  ['solid', 'solid-js'],
]) {
  const cwd = path.join(checkout, 'frameworks/keyed', directory)
  const expected = JSON.parse(fs.readFileSync(path.join(cwd, 'package-lock.json'), 'utf8'))
    .packages[`node_modules/${dependency}`].version
  const installed = JSON.parse(
    fs.readFileSync(path.join(cwd, 'node_modules', dependency, 'package.json'), 'utf8'),
  ).version
  if (installed !== expected)
    throw new Error(`${dependency}: expected ${expected}, installed ${installed}`)
}
run(
  'node',
  ['node_modules/typescript/bin/tsc', '--ignoreDeprecations', '6.0'],
  path.join(checkout, 'webdriver-ts'),
)
for (const [framework, args] of [
  ['react-hooks', ['node_modules/webpack-cli/bin/cli.js']],
  ['vue', ['node_modules/vite/bin/vite.js', 'build']],
  ['solid', ['node_modules/rollup/dist/bin/rollup', '-c', '--environment', 'production']],
])
  run('node', args, path.join(checkout, 'frameworks/keyed', framework))

run('node', ['scripts/build-packages.mjs'], workspace)
const version = JSON.parse(
  fs.readFileSync(path.join(workspace, 'packages/irisout/package.json'), 'utf8'),
).version
const target = path.join(checkout, 'frameworks/keyed/irisout')
fs.mkdirSync(target, { recursive: true })
for (const file of ['main.jsx', 'index.html'])
  fs.copyFileSync(path.join(root, 'irisout', file), path.join(target, file))
// 配信側はpackage-lock.jsonの存在で実装を検出する。irisout本体はこの作業木から構築する。
fs.writeFileSync(
  path.join(target, 'package.json'),
  JSON.stringify(
    {
      name: 'js-framework-benchmark-irisout',
      version,
      'js-framework-benchmark': {
        frameworkVersion: `${version}-dev`,
        frameworkHomeURL: 'https://github.com/mikan-919/irisout',
        customURL: '/dist',
        language: 'JavaScript',
      },
    },
    null,
    2,
  ) + '\n',
)
fs.writeFileSync(
  path.join(target, 'package-lock.json'),
  JSON.stringify(
    { name: 'js-framework-benchmark-irisout', version, lockfileVersion: 3, packages: {} },
    null,
    2,
  ) + '\n',
)
run(process.execPath, [path.join(root, 'irisout/build.mjs')], workspace)
