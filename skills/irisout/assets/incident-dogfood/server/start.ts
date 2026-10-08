// 構築済み資産とHonoを同じ配信元で起動する、ローカル試験用の入口。
import { app } from './app.ts'

// 構築済みのブラウザー用ファイルをHonoのページと同じ配信元へ置く。
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.DOGFOOD_PORT || 4313),
  async fetch(request) {
    const path = new URL(request.url).pathname
    if (path === '/irisout-client.js' || path.startsWith('/assets/')) {
      const file = Bun.file('./dist' + path)
      if (await file.exists()) return new Response(file)
    }
    return app.fetch(request)
  },
})
console.log(server.url.href)
