// 公式サーバーの実装は保ち、一覧の返却順だけを反転して測定順の影響を検査する。
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkout } from './config.mjs'

const { buildServer } = await import(pathToFileURL(path.join(checkout, 'server/app.ts')).href)
const server = buildServer()
server.addHook('preSerialization', async (request, _reply, payload) =>
  request.url === '/ls' && Array.isArray(payload) ? [...payload].reverse() : payload,
)
await server.listen({ port: Number(process.env.PORT ?? 8080) })
