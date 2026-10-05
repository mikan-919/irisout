// 固定したrshonoの測定アプリとirisoutの公開Hono入口を同条件で測る。
// 上流の負荷生成器を再利用し、生の試行値と機能検証結果をJSONに残す。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { gzipSync, brotliCompressSync, constants } from 'node:zlib'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const root = import.meta.dirname
const upstream = process.env.RSHONO_CHECKOUT ?? '/tmp/irisout-rshono-comparison'
const rshono = process.env.RSHONO_APP ?? '/tmp/irisout-rshono-app'
const { run, startServer } = await import(upstream + '/packages/benchmarks/harness/lib/proc.mjs')
const { drive } = await import(upstream + '/packages/benchmarks/harness/lib/loadgen.mjs')
const { treeRss } = await import(upstream + '/packages/benchmarks/harness/lib/rss.mjs')
const targets = [
  {
    id: 'irisout',
    dir: root + '/irisout',
    port: 4104,
    build: ['node', ['build.mjs']],
    start: ['node', ['server.mjs']],
    cacheDirs: ['dist', 'node_modules/.vite'],
  },
  {
    id: 'rshono',
    dir: rshono,
    port: 4101,
    build: ['node', ['node_modules/@rshono/core/bin/rshono.mjs', 'build']],
    start: ['node', ['node_modules/@rshono/core/bin/rshono.mjs', 'start']],
    cacheDirs: ['dist', 'node_modules/.cache'],
  },
]
const samples = 3
const routes = ['/', '/ssr', '/interactive', '/api/health']
const report = {
  date: new Date().toISOString(),
  environment: {
    node: process.version,
    bun: execFileSync('bun', ['--version'], { encoding: 'utf8' }).trim(),
    platform: process.platform,
    hono: JSON.parse(fs.readFileSync(rshono + '/node_modules/hono/package.json')).version,
    rshono: JSON.parse(fs.readFileSync(rshono + '/node_modules/@rshono/core/package.json')).version,
    nodeServer: JSON.parse(fs.readFileSync(rshono + '/node_modules/@hono/node-server/package.json'))
      .version,
    cpu: os.cpus()[0].model,
    cpus: os.cpus().length,
    memory: os.totalmem(),
    irisoutCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    rshonoCommit: execFileSync('git', ['-C', upstream, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
  },
  settings: { samples, connections: 16, workers: 4, durationMs: 2000, warmupMs: 1000, heapMb: 256 },
  targets: {},
}
function bytes(buffer) {
  return {
    raw: buffer.length,
    gzip: gzipSync(buffer, { level: 9 }).length,
    brotli: brotliCompressSync(buffer, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
  }
}
function size(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .reduce(
      (sum, entry) =>
        sum +
        (entry.isDirectory()
          ? size(path.join(dir, entry.name))
          : fs.statSync(path.join(dir, entry.name)).size),
      0,
    )
}
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  (fs.existsSync('/etc/NIXOS')
    ? execFileSync('nix', ['build', '--no-link', '--print-out-paths', 'nixpkgs#chromium'], {
        encoding: 'utf8',
      })
        .trim()
        .split('\n')
        .at(-1) + '/bin/chromium'
    : undefined)
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
report.environment.chromium = browser.version()
const visible = {}
try {
  for (const target of targets) {
    console.log(target.id)
    const result = (report.targets[target.id] = {
      buildColdMs: [],
      buildWarmMs: [],
      startupMs: [],
      payload: {},
      load: {},
      rss: {},
      functional: [],
    })
    for (let trial = 0; trial < samples; trial++) {
      for (const dir of target.cacheDirs)
        fs.rmSync(path.join(target.dir, dir), { recursive: true, force: true })
      for (const metric of ['buildColdMs', 'buildWarmMs']) {
        const build = await run(...target.build, {
          cwd: target.dir,
          label: target.id,
          env: { NODE_ENV: 'production' },
        })
        assert.equal(build.code, 0, build.stderr + build.stdout)
        result[metric].push(build.ms)
      }
    }
    result.distBytes = size(target.dir + '/dist')
    for (let trial = 0; trial < samples; trial++) {
      const server = await startServer(target, {
        env: { RSHONO_APP: rshono, NODE_OPTIONS: '--max-old-space-size=256' },
      })
      result.startupMs.push(server.readyMs)
      await server.stop()
    }
    const server = await startServer(target, {
      env: { RSHONO_APP: rshono, NODE_OPTIONS: '--max-old-space-size=256' },
    })
    try {
      result.rss.idle = await treeRss(server.pid)
      for (const route of routes) {
        if (route === '/api/health') {
          const response = await fetch(server.base + route)
          assert.equal(response.status, 200)
          assert.deepEqual(await response.json(), { ok: true, route: 'health' })
          continue
        }
        const page = await browser.newPage()
        const errors = []
        page.on('pageerror', (e) => errors.push(e.message))
        const requests = []
        page.on('response', (response) => {
          requests.push(
            (async () => ({
              url: response.url(),
              type: response.request().resourceType(),
              status: response.status(),
              sizes: bytes(await response.body()),
            }))(),
          )
        })
        const navigation = await page.goto(server.base + route, { waitUntil: 'networkidle' })
        assert.equal(navigation.status(), 200, target.id + route + ': ' + (await page.content()))
        assert.deepEqual(errors, [])
        const main = (await page.locator('main').innerText()).replace(/\s+/g, ' ').trim()
        visible[target.id + route] = main
        if (route === '/ssr') {
          assert.equal(await page.locator('tbody tr').count(), 100)
          const a = await fetch(server.base + route, { headers: { 'user-agent': 'bench-a' } })
          const b = await fetch(server.base + route, { headers: { 'user-agent': 'bench-b' } })
          assert.match(await a.text(), /bench-a/)
          assert.match(await b.text(), /bench-b/)
        }
        const responses = await Promise.all(requests)
        assert.ok(
          responses.every((r) => r.status === 200),
          JSON.stringify(responses),
        )
        result.payload[route] = {
          responses,
          totals: Object.fromEntries(
            ['raw', 'gzip', 'brotli'].map((key) => [
              key,
              responses.reduce((sum, r) => sum + r.sizes[key], 0),
            ]),
          ),
        }
        if (route === '/interactive') {
          assert.match(main, /100 of 100/)
          assert.equal(await page.locator('.matches li').count(), 25)
          await page.getByRole('button', { name: 'Increment' }).click()
          await page.getByText('Clicked 1 time', { exact: true }).waitFor()
          await page.getByRole('textbox', { name: 'Filter users' }).fill('Ada Lovelace')
          await page.getByText('1 of 100', { exact: true }).waitFor()
          assert.equal(await page.locator('.matches li').count(), 1)
          await page.getByRole('textbox', { name: 'Filter users' }).fill('')
          await page.getByText('100 of 100', { exact: true }).waitFor()
          await page.getByRole('button', { name: 'Submit', exact: true }).click()
          await page.getByText('Name is required.', { exact: true }).waitFor()
          await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Test')
          await page.getByRole('textbox', { name: 'Email', exact: true }).fill('invalid')
          await page.getByRole('button', { name: 'Submit', exact: true }).click()
          await page.getByText('A valid email is required.', { exact: true }).waitFor()
          await page.getByRole('textbox', { name: 'Email', exact: true }).fill('test@example.com')
          await page.getByRole('button', { name: 'Submit', exact: true }).click()
          await page.getByText('Created user #101', { exact: true }).waitFor()
          const cdp = await page.context().newCDPSession(page)
          await cdp.send('HeapProfiler.collectGarbage')
          result.browserHeapUsedBytes = (await cdp.send('Runtime.getHeapUsage')).usedSize
        }
        assert.deepEqual(errors, [])
        result.functional.push(route)
        await page.close()
      }
      for (const route of routes) {
        result.load[route] = []
        for (let trial = 0; trial < samples; trial++) {
          const load = await drive(server.base + route, report.settings)
          assert.ok(load.ok, JSON.stringify(load))
          result.load[route].push(load)
        }
        result.rss[route] = await treeRss(server.pid)
        console.log(' ', route, result.load[route].map((r) => Math.round(r.rps)).join(', '))
      }
    } finally {
      await server.stop()
    }
  }
  for (const route of routes.slice(0, 3))
    assert.equal(visible['irisout' + route], visible['rshono' + route], route + ' visible content')
  report.visibleContentEqual = true
} finally {
  await browser.close()
  fs.writeFileSync(root + '/results.json', JSON.stringify(report, null, 2) + '\n')
}
console.log('results.json')
