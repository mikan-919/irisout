import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { app } from './app.ts'
const serverApp = new Hono()
serverApp.on(['GET', 'HEAD'], '/irisout-client.js', serveStatic({ root: './dist' }))
serverApp.on(['GET', 'HEAD'], '/assets/*', serveStatic({ root: './dist' }))
serverApp.route('/', app)
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.DOGFOOD_PORT ?? 4317),
  fetch: serverApp.fetch,
})
console.log(`http://127.0.0.1:${server.port}`)
