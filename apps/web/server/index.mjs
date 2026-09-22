// 公式サイトのページ経路を一つのHono appへ集約し、サーバーとVite設定で共有する。
// 待受とAPIは含めず、Vite設定からimportしても外部状態を変更しない。

import path from 'node:path'
import { Hono } from 'hono'
import { createFileRouter } from 'irisout/hono'
import { transformMotionSource } from 'irisout/motion/vite'

export const pageDocuments = new Set([
  '/',
  '/playground',
  '/examples',
  '/examples/bcf-copy-button',
  '/examples/task-board',
  '/examples/morph-bcf',
])

const pageMetadata = new Map([
  ['/', ['irisout — compile the interface', 'JSXから直接DOM更新コードを生成するUIコンパイラ']],
  ['/playground', ['Playground — irisout', 'ブラウザー内でirisoutのJSXを試せます']],
  ['/examples', ['実例 — irisout', 'irisoutで実装した画面の実例一覧']],
  ['/examples/bcf-copy-button', ['BCF Copy Button — irisout', 'BCF交差フェードの実例']],
  ['/examples/task-board', ['Task Board — irisout', '状態と一覧更新の実例']],
  ['/examples/morph-bcf', ['Morph BCF — irisout', '共有配置変形の実例']],
])

function renderDocument(html, routePath, stateScript) {
  const docs = routePath.startsWith('/docs')
  const [title, description] = pageMetadata.get(routePath) ?? [
    'ドキュメント — irisout',
    'irisoutの公式ドキュメント',
  ]
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${description}" />
    <link rel="stylesheet" href="/site.css" />
    ${docs ? '<link rel="stylesheet" href="/docs/site.css" />' : ''}
    <title>${title}</title>
  </head>
  <body>
    <div id="app">${html}</div>
    ${stateScript}
    ${docs ? '<script type="module" src="/docs/search.js"></script>' : ''}
    <script type="module" src="/site.js"></script>
    <script type="module" src="/irisout-client.js"></script>
  </body>
</html>`
}

export const siteApp = new Hono()

siteApp.route(
  '/',
  createFileRouter(path.resolve(import.meta.dirname, '../routes'), {
    transformSource: transformMotionSource,
    document: ({ html, route, stateScript }) => renderDocument(html, route.path, stateScript),
  }),
)

export default siteApp
