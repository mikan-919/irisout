import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { describe, expect, it } from 'vite-plus/test'
import { createFileRouter, notFound, redirect } from '../../hono/src/index.ts'

function writePage(root: string, relative: string, source: string): string {
  const filePath = path.join(root, relative, 'page.tsx')
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, source)
  return filePath
}

function mountRouter(root: string, options: Parameters<typeof createFileRouter>[1] = {}): Hono {
  const router = createFileRouter(root, { prefix: '/apps', ...options })
  const app = new Hono()
  app.route('/', router)
  return app
}

describe('irisout Hono経路', () => {
  it('prefixをHonoのmount側へ委ねてもpage経路を照合する', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'irisout-hono-mount-'))
    try {
      writePage(
        root,
        'users/[id]',
        "import type { Missing } from './types.ts'; interface Input { id: string; unused?: Missing } export function Page({ id }: Input): void { render(<p>{id as string}</p>); }",
      )
      const router = createFileRouter(root, {
        loaders: { '/users/:id': ({ params }) => ({ id: params.id! }) },
      })
      const app = new Hono()
      app.route('/apps', router)
      const response = await app.request('http://example.test/apps/users/123')
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('>123</p>')
      expect((await app.request('http://example.test/apps/users/a%2Fb')).status).toBe(404)
      expect((await app.request('http://example.test/apps/users/%E0%A4%A')).status).toBe(404)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('prefix付きの直接HTMLと遷移JSONへ同じloader結果を渡す', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'irisout-hono-'))
    try {
      writePage(
        root,
        '',
        'export function Page({ title }) { render(<main><h1>{title}</h1></main>); }',
      )
      writePage(
        root,
        'users/[id]',
        'export function Page({ name, tab }) { render(<main><h1>{name}</h1><p>{tab}</p></main>); }',
      )
      const seen: string[] = []
      const app = mountRouter(root, {
        loaders: {
          '/': ({ request }) => ({ title: request.headers.get('x-title') ?? 'root' }),
          '/users/:id': ({ params, search, request }) => {
            seen.push(`${params.id!}:${search.get('tab')}:${request.method}`)
            return { name: params.id!, tab: search.get('tab') ?? 'none' }
          },
        },
        document: ({ html, stateScript }) =>
          `<!doctype html><div id="app">${html}</div>${stateScript}`,
      })

      const direct = await app.request('http://example.test/apps/users/a%20b/?tab=posts')
      expect(direct.status).toBe(200)
      const directHtml = await direct.text()
      expect(directHtml).toContain('>a b</h1>')
      expect(directHtml).toContain('"a b"')
      expect(directHtml).not.toContain('Request')

      const navigation = await app.request('http://example.test/apps/users/a%20b?tab=posts', {
        headers: { 'X-Irisout-Navigation': '1', Accept: 'application/json' },
      })
      expect(navigation.status).toBe(200)
      expect(await navigation.json()).toMatchObject({
        type: 'page',
        routeId: '/users/:id',
        html: expect.stringContaining('>a b</h1>'),
      })
      expect(seen).toEqual(['a b:posts:GET', 'a b:posts:GET'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('loaderなし、notFound、redirect、例外、同時要求を分離する', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'irisout-hono-controls-'))
    try {
      writePage(root, 'plain', 'export function Page() { render(<p>plain</p>); }')
      writePage(root, 'missing', 'export function Page() { render(<p>never</p>); }')
      writePage(root, 'go', 'export function Page() { render(<p>never</p>); }')
      writePage(root, 'error', 'export function Page() { render(<p>never</p>); }')
      writePage(root, 'value/[id]', 'export function Page({ value }) { render(<p>{value}</p>); }')
      const app = mountRouter(root, {
        loaders: {
          '/missing': () => notFound(),
          '/go': () => redirect('/apps/plain', 307),
          '/error': () => {
            throw new Error('secret request connection')
          },
          '/value/:id': async ({ params }) => ({ value: params.id! }),
        },
      })

      expect((await app.request('http://example.test/apps/plain')).status).toBe(200)
      const missing = await app.request('http://example.test/apps/missing')
      expect(missing.status).toBe(404)
      expect(await missing.text()).not.toContain('never')

      const moved = await app.request('http://example.test/apps/go')
      expect(moved.status).toBe(307)
      expect(moved.headers.get('location')).toBe('/apps/plain')
      const navigationMoved = await app.request('http://example.test/apps/go', {
        headers: { 'X-Irisout-Navigation': '1' },
      })
      expect(navigationMoved.status).toBe(307)
      expect(await navigationMoved.json()).toEqual({
        type: 'redirect',
        status: 307,
        location: '/apps/plain',
      })

      const error = await app.request('http://example.test/apps/error')
      expect(error.status).toBe(500)
      expect(await error.text()).not.toContain('secret request connection')
      const navigationError = await app.request('http://example.test/apps/error', {
        headers: { Accept: 'application/json' },
      })
      expect(navigationError.status).toBe(500)
      expect(await navigationError.json()).toEqual({ type: 'error', status: 500 })

      const [first, second] = await Promise.all([
        app.request('http://example.test/apps/value/first'),
        app.request('http://example.test/apps/value/second'),
      ])
      expect(await first.text()).toContain('>first</p>')
      expect(await second.text()).toContain('>second</p>')

      const navigationMissing = await app.request('http://example.test/apps/missing', {
        headers: { Accept: 'application/json' },
      })
      expect(await navigationMissing.json()).toEqual({ type: 'not-found', status: 404 })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('pageごとのソース変換をSSR前に適用する', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'irisout-hono-transform-'))
    try {
      writePage(root, '', 'export function Page() { render(<p>__LABEL__</p>); }')
      const router = createFileRouter(root, {
        transformSource: (source) => source.replace('__LABEL__', 'ready'),
      })
      const response = await router.request('http://example.test/')
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('<p>ready</p>')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
