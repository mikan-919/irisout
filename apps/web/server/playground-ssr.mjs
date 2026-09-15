// 保存値を運営側SSR部品へ一度だけ渡し、共有ページのHTMLを組み立てる。
import { serializeSsrState } from 'irisout/ssr'
import { PLAYGROUND_ID_PATTERN } from './playground-api.mjs'

export const PLAYGROUND_PAGE_HEADERS = {
  'cache-control': 'no-store',
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'cross-origin-resource-policy': 'same-origin',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex, nofollow',
}

export function createPlaygroundPageHandler({
  store,
  render,
  officialOrigin,
  clientPath = '/playground.js',
} = {}) {
  if (!store) throw new Error('PlaygroundStoreが必要です')
  if (typeof render !== 'function') throw new Error('Playground SSR renderが必要です')
  const origin = new URL(officialOrigin).origin

  return async function handle(request) {
    const url = new URL(request.url)
    const match = url.pathname.match(/^\/playground\/([^/]+)(\/?)$/)
    if (!match) {
      if (
        url.pathname === '/playground/' &&
        (request.method === 'GET' || request.method === 'HEAD')
      ) {
        return redirect('/playground', url.search)
      }
      return null
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('method not allowed', {
        status: 405,
        headers: { ...PLAYGROUND_PAGE_HEADERS, allow: 'GET, HEAD' },
      })
    }

    let id
    try {
      id = decodeURIComponent(match[1])
    } catch {
      return pageError(404, 'not found')
    }
    if (!PLAYGROUND_ID_PATTERN.test(id)) return pageError(404, 'not found')
    if (match[2] === '/') return redirect(`/playground/${encodeURIComponent(id)}`, url.search)

    let record
    try {
      record = store.findById(id)
    } catch {
      return pageError(503, 'service unavailable')
    }
    if (!record) return pageError(404, 'not found')

    // 読取り値を許可項目へ固定する。管理鍵と削除状態はこの経路へ入れない。
    const displayRecord = {
      id: record.id,
      title: record.title,
      description: record.description,
      source: record.source,
      compilerVersion: record.compilerVersion,
      createdAt: record.createdAt,
    }

    let rendered
    try {
      rendered = render({ record: displayRecord })
    } catch {
      return pageError(503, 'service unavailable')
    }
    if (!isRenderResult(rendered)) return pageError(503, 'service unavailable')

    let html
    try {
      html = pageHtml({
        origin,
        id,
        displayRecord,
        rendered,
        clientPath,
      })
    } catch {
      return pageError(503, 'service unavailable')
    }
    return new Response(request.method === 'HEAD' ? null : html, {
      status: 200,
      headers: {
        ...PLAYGROUND_PAGE_HEADERS,
        'content-type': 'text/html; charset=utf-8',
      },
    })
  }
}

export function pageHtml({ origin, id, displayRecord, rendered, clientPath }) {
  const title = displayRecord.title
  const description = displayRecord.description
  const canonical = new URL(`/playground/${encodeURIComponent(id)}`, origin).href
  const state = serializeSsrState(rendered.state)
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="${escapeAttribute(description)}">
    <meta name="robots" content="noindex, nofollow">
    <meta property="og:title" content="${escapeAttribute(title)}">
    <meta property="og:description" content="${escapeAttribute(description)}">
    <meta property="og:url" content="${escapeAttribute(canonical)}">
    <link rel="canonical" href="${escapeAttribute(canonical)}">
    <title>${escapeText(title)}</title>
  </head>
  <body>
    <div id="app">${rendered.html}</div>
    <script id="playground-state" type="application/json">${state}</script>
    <script type="module" src="${escapeAttribute(clientPath)}"></script>
  </body>
</html>`
}

function isRenderResult(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.html === 'string' &&
    Object.prototype.hasOwnProperty.call(value, 'state')
  )
}

function redirect(location, search) {
  return new Response(null, {
    status: 308,
    headers: { ...PLAYGROUND_PAGE_HEADERS, location: `${location}${search}` },
  })
}

function pageError(status, message) {
  return new Response(message, {
    status,
    headers: {
      ...PLAYGROUND_PAGE_HEADERS,
      'content-type': 'text/plain; charset=utf-8',
    },
  })
}

function escapeText(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function escapeAttribute(value) {
  return escapeText(value).replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}
