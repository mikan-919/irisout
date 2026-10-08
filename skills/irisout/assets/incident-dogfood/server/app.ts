// 要求ごとのHTMLと試験用API。同じプロセスのメモリだけに解決状態を保存する。
import { Hono } from 'hono'
import { createFileRouter, notFound } from 'irisout/hono'

export const app = new Hono()
const incidents = [
  { id: 'i1', title: '決済API停止', resolved: false },
  { id: 'i2', title: '通知遅延', resolved: false },
  { id: 'i3', title: '検索障害', resolved: false },
]

app.get('/api/incidents', async (context) => {
  const query = context.req.query('q') || ''
  if (query === '失敗') return context.json({ message: '検索に失敗しました' }, 503)
  if (query === '決済') await Bun.sleep(600)
  if (query === '通知') await Bun.sleep(30)
  return context.json(incidents.filter((incident) => incident.title.includes(query)))
})
app.post('/api/incidents/:id/resolve', (context) => {
  const incident = incidents.find((item) => item.id === context.req.param('id'))
  if (!incident) return context.json({ message: '障害がありません' }, 404)
  incident.resolved = true
  return context.json(incident)
})
app.route(
  '/',
  createFileRouter('./routes', {
    loaders: {
      '/': () => ({ incidents }),
      '/incidents/:id': ({ params }) => {
        const incident = incidents.find((item) => item.id === params.id)
        return incident ? { incident } : notFound()
      },
    },
  }),
)
