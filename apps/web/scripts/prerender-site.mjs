// Honoの登録済み静的経路を要求し、完成したHTML文書を配信用distへ書き出す。

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { irisoutHonoPageMetadata } from 'irisout/hono'
import { siteApp } from '../server/index.mjs'

const dist = path.resolve(import.meta.dirname, '../dist')
const routes = siteApp.routes
  .filter((route) => route.handler[irisoutHonoPageMetadata])
  .map((route) => route.path)

for (const routePath of routes) {
  const response = await siteApp.request(`http://irisout.local${routePath}`)
  if (!response.ok) throw new Error(`事前生成に失敗しました: ${routePath} (${response.status})`)
  const html = await response.text()
  const relative = routePath === '/' ? 'index.html' : `${routePath.slice(1)}/index.html`
  const output = path.join(dist, relative)
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, html)
  if (routePath !== '/') await writeFile(path.join(dist, `${routePath.slice(1)}.html`), html)
}

console.log(`site: Honoから${routes.length}件のHTML文書を生成しました`)
