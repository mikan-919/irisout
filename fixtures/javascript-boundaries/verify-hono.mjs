// 梱包物の導入先へコピーし、実際のHono版で二段のonError経路を検証する。
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { createFileRouter } from 'irisout/hono'
import { irisoutHono } from 'irisout/hono/vite'

const root = mkdtempSync(path.join(tmpdir(), 'irisout-hono-peer-'))
try {
  writeFileSync(
    path.join(root, 'page.jsx'),
    'export function Page() { render(<p>compatible</p>); }',
  )
  const pages = createFileRouter(root)
  pages.onError((error, context) => context.text(error.message, 500))
  const group = new Hono().route('/pages', pages)
  group.onError((error, context) => context.text(error.message, 500))
  const app = new Hono().route('/apps', group)
  const plugin = irisoutHono(app)
  const id = plugin.resolveId('virtual:irisout-routes')
  const source = plugin.load(id).code
  assert.ok(source.includes('"path":"/apps/pages"'))
  const response = await app.request('/apps/pages')
  assert.equal(response.status, 200)
  assert.ok((await response.text()).includes('compatible'))
  const built = readFileSync(fileURLToPath(import.meta.resolve('irisout/hono/vite')), 'utf8')
  assert.ok(built.includes('hono/hono-base'))
  assert.ok(!built.includes('hono/utils/handler'))
  const honoEntry = fileURLToPath(import.meta.resolve('hono'))
  const dependency = JSON.parse(
    readFileSync(path.resolve(path.dirname(honoEntry), '../package.json'), 'utf8'),
  )
  console.log(
    JSON.stringify({
      hono: dependency.version,
      status: response.status,
      path: '/apps/pages',
      externalHonoBase: true,
      pass: true,
    }),
  )
} finally {
  rmSync(root, { recursive: true, force: true })
}
