import { app } from './app.ts'

const server = Bun.serve({
  port: Number(process.env.DOGFOOD_PORT || 4173),
  hostname: '127.0.0.1',
  async fetch(request) {
    const path = new URL(request.url).pathname
    if (path === '/irisout-client.js' || path.startsWith('/assets/')) {
      const file = Bun.file('./dist' + path)
      if (await file.exists()) return new Response(file)
      return new Response('Not found', { status: 404 })
    }
    return app.fetch(request)
  },
})
console.log('http://127.0.0.1:' + server.port)
