// Cloudflare Workersで公式サイト、共有API、共有ページSSRを配信する。
// 実行管理資産は別Workerへ置き、公式Originから取得させない。

import { createPlaygroundApi } from '../server/playground-api.mjs'
import { createPlaygroundPageHandler } from '../server/playground-ssr.mjs'
import { render } from '../dist/server/playground-page.js'
import { D1PlaygroundStore } from './d1-playground-store.mjs'

const applications = new Map()

export default {
  async fetch(request, env) {
    const officialOrigin = new URL(request.url).origin
    const { api, page } = getApplication(env, officialOrigin)
    const pathname = new URL(request.url).pathname

    if (isPrivateAssetPath(pathname)) return new Response('not found', { status: 404 })

    const pageResponse = await page(request)
    if (pageResponse) return pageResponse

    const apiResponse = await api.handle(request, {
      clientAddress: request.headers.get('cf-connecting-ip'),
    })
    if (apiResponse) return apiResponse

    if (pathname === '/playground/') return redirect('/playground', request.url)
    if (pathname === '/docs/') return redirect('/docs', request.url)
    if (pathname === '/examples/') return redirect('/examples', request.url)
    const documentMatch = pathname.match(/^\/docs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/$/)
    if (documentMatch) return redirect(`/docs/${documentMatch[1]}`, request.url)

    return env.ASSETS.fetch(exampleAssetRequest(request))
  },
}

function exampleAssetRequest(request) {
  const url = new URL(request.url)
  if (url.pathname === '/examples') url.pathname = '/examples/index.html'
  if (url.pathname === '/examples/bcf-copy-button') {
    url.pathname = '/examples/bcf-copy-button.html'
  }
  return url.href === request.url ? request : new Request(url, request)
}

function getApplication(env, officialOrigin) {
  const existing = applications.get(officialOrigin)
  if (existing) return existing
  const store = new D1PlaygroundStore(env.DB)
  // Worker instance内でAPIを再利用し、頻度制限のbucketを要求間で維持する。
  const application = {
    api: createPlaygroundApi({ store, officialOrigin }),
    page: createPlaygroundPageHandler({ store, render, officialOrigin }),
  }
  applications.set(officialOrigin, application)
  return application
}

function isPrivateAssetPath(pathname) {
  const normalized = pathname.replaceAll(/\/{2,}/g, '/')
  return (
    normalized === '/playground-controller.html' ||
    normalized.startsWith('/assets/controller/') ||
    normalized === '/server' ||
    normalized.startsWith('/server/')
  )
}

function redirect(pathname, requestUrl) {
  const source = new URL(requestUrl)
  return new Response(null, {
    status: 308,
    headers: { location: `${pathname}${source.search}` },
  })
}
