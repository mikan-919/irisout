import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import {
  createRouteTable,
  matchRoute,
  toClientRouteTable,
  type RouteDefinition,
} from '../../routes/src/index.ts'
import { scanFileRoutes } from '../../routes/src/node.ts'

function writeRoute(root: string, relative: string, fileName = 'page.tsx'): string {
  const filePath = path.join(root, relative, fileName)
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, 'export function Page() { render(<p>page</p>) }')
  return filePath
}

describe('page.tsxファイル経路', () => {
  it('静的経路と動的経路を同じ表から照合する', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'irisout-file-routes-'))
    try {
      writeRoute(root, '')
      writeRoute(root, 'users')
      writeRoute(root, 'users/[id]')
      writeRoute(root, 'users/new')
      writeFileSync(path.join(root, 'users', 'ignored.js'), 'not a page')
      writeRoute(root, 'legacy', 'page.jsx')

      const manifest = scanFileRoutes(root)
      const client = toClientRouteTable(manifest)
      expect(manifest.routes.map((route) => route.path)).toEqual([
        '/',
        '/legacy',
        '/users',
        '/users/new',
        '/users/:id',
      ])
      expect(client.routes.every((route) => !('filePath' in route))).toBe(true)

      for (const table of [manifest, client]) {
        const staticMatch = matchRoute(table, 'https://example.test/users/new/?from=link#top')
        expect(staticMatch?.route.path).toBe('/users/new')
        expect(staticMatch?.params).toEqual({})
        expect(staticMatch?.searchParams.get('from')).toBe('link')

        const dynamicMatch = matchRoute(table, '/users/a%20b?tab=profile#details')
        expect(dynamicMatch?.route.path).toBe('/users/:id')
        expect(dynamicMatch?.params).toEqual({ id: 'a b' })
        expect(dynamicMatch?.searchParams.get('tab')).toBe('profile')
        expect(matchRoute(table, '/missing')).toBeNull()
        expect(matchRoute(table, '/users/a%2Fb')).toBeNull()
        expect(matchRoute(table, '/users/%E0%A4%A')).toBeNull()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('同じ順位の動的経路衝突を両方のファイル付きで拒否する', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'irisout-file-routes-collision-'))
    try {
      const first = writeRoute(root, 'users/[id]')
      const second = writeRoute(root, 'users/[name]')
      let error: unknown
      try {
        scanFileRoutes(root)
      } catch (caught) {
        error = caught
      }
      const message = error instanceof Error ? error.message : String(error)
      expect(message).toContain('route collision')
      expect(message).toContain(first)
      expect(message).toContain(second)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('ファイル集合の変更を次の生成へ反映する', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'irisout-file-routes-regenerate-'))
    try {
      const oldFile = writeRoute(root, 'old')
      expect(scanFileRoutes(root).routes.map((route) => route.path)).toEqual(['/old'])

      rmSync(oldFile)
      writeRoute(root, 'new')
      const next = scanFileRoutes(root)
      expect(next.routes.map((route) => route.path)).toEqual(['/new'])
      expect(matchRoute(next, '/old')).toBeNull()
      expect(matchRoute(next, '/new')?.route.filePath).toBe(path.join(root, 'new', 'page.tsx'))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('同じディレクトリのpage.tsxとpage.jsxを拒否する', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'irisout-file-routes-duplicate-'))
    try {
      writeRoute(root, '')
      writeRoute(root, '', 'page.jsx')
      expect(() => scanFileRoutes(root)).toThrow('contains both page.tsx and page.jsx')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('経路表の順序を静的優先へ固定する', () => {
    const routes: RouteDefinition[] = [
      { id: 'dynamic', path: '/users/:id', segments: [], params: [] },
      { id: 'static', path: '/users/new', segments: [], params: [] },
    ]
    const table = createRouteTable(routes)
    expect(table.routes.map((route) => route.id)).toEqual(['static', 'dynamic'])
  })
})
