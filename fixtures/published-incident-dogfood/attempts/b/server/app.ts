import { Hono } from 'hono'
import { createFileRouter, notFound } from 'irisout/hono'
const incidents = [
  { id: 'i1', title: '決済API停止', resolved: false },
  { id: 'i2', title: '通知遅延', resolved: false },
  { id: 'i3', title: '検索障害', resolved: false },
]
export const app = new Hono()
app.get('/api/incidents', async (c) => {
  const q = c.req.query('q') ?? ''
  if (q === '決済') await Bun.sleep(600)
  if (q === '通知') await Bun.sleep(30)
  if (q === '失敗') return c.json({ error: '検索失敗' }, 503)
  return c.json(incidents.filter((incident) => incident.title.includes(q)))
})
app.post('/api/incidents/:id/resolve', (c) => {
  const incident = incidents.find((item) => item.id === c.req.param('id'))
  if (!incident) return c.json({ error: '見つかりません' }, 404)
  incident.resolved = true
  return c.json(incident)
})
const pages = createFileRouter('./routes', {
  loaders: {
    '/': () => ({ initial: incidents }),
    '/incidents/:id': ({ params }) => {
      const incident = incidents.find((item) => item.id === params.id)
      return incident ? { incident } : notFound()
    },
  },
})
app.route('/', pages)
