// irisout/honoの公開入口で測定用経路を登録する。ビルド時にも待受は開始しない。
import fs from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { createFileRouter } from 'irisout/hono'
const fixture = JSON.parse(fs.readFileSync(new URL('./data.json', import.meta.url)))
const users = fixture.users
export function document(html, stateScript = '', client = true, title = 'Interactive') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/styles.css"></head><body><header><nav><strong>Benchmark Suite</strong><a href="/">Home</a><a href="/ssr">SSR</a><a href="/interactive">Interactive</a></nav></header><div id="app">${html}</div><footer><p>rshono — Hono + Rspack + React Server Components.</p></footer>${stateScript}${client ? '<script type="module" src="/irisout-client.js"></script>' : ''}</body></html>`
}
export const app = new Hono()
app.get('/api/health', (c) => c.json({ ok: true, route: 'health' }))
app.post('/api/signup', async (c) => {
  const input = await c.req.json()
  if (!input.name.trim()) return c.json({ ok: false, error: 'Name is required.' })
  if (!input.email.includes('@')) return c.json({ ok: false, error: 'A valid email is required.' })
  return c.json({ ok: true, id: users.length + 1 })
})
app.get('/', (c) => c.html(fs.readFileSync(new URL('./dist/index.html', import.meta.url), 'utf8')))
app.get('*', (c, next) => {
  const pathname = c.req.path
  if (!/^\/(?:assets\/[\w.-]+|irisout-client\.js|styles\.css)$/.test(pathname)) return next()
  const file = new URL('./dist' + pathname, import.meta.url)
  if (!fs.existsSync(file)) return c.notFound()
  c.header('content-type', pathname.endsWith('.css') ? 'text/css' : 'text/javascript')
  return c.body(fs.readFileSync(file))
})
app.route(
  '/',
  createFileRouter(path.resolve(import.meta.dirname, 'routes'), {
    loaders: {
      '/ssr': ({ request }) => ({
        users,
        count: users.length,
        totalScore: users.reduce((sum, user) => sum + user.score, 0).toLocaleString('en-US'),
        admins: users.filter((user) => user.role === 'admin').length,
        agent: (request.headers.get('user-agent') ?? 'unknown').slice(0, 40),
      }),
      '/interactive': () => ({ users }),
    },
    document: ({ html, stateScript, route }) =>
      document(html, stateScript, true, route.path === '/ssr' ? 'Users' : 'Interactive'),
  }),
)
