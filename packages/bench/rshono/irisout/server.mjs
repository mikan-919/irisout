// 両実装で同じNode用Hono配信器を使う。動的ページは公式入口の要求単位SSRで返す。
import { app } from './app.mjs'
const { serve } = await import(
  process.env.RSHONO_APP + '/node_modules/@hono/node-server/dist/index.mjs'
)
serve({ fetch: app.fetch, hostname: '127.0.0.1', port: Number(process.env.PORT ?? 4104) })
