// Cloudflare WorkersでPlaygroundの実行管理資産だけを配信する。
// 保存APIと共有ページを持たず、公式Originからだけiframe埋込みを許可する。

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname !== '/playground-controller.html' && !url.pathname.startsWith('/assets/')) {
      return new Response('not found', { status: 404, headers: controllerHeaders(env) })
    }
    const response = await env.ASSETS.fetch(request)
    const headers = new Headers(response.headers)
    for (const [name, value] of Object.entries(controllerHeaders(env))) headers.set(name, value)
    if (url.pathname.includes('/runtime-')) {
      headers.set('access-control-allow-origin', '*')
      headers.set('cross-origin-resource-policy', 'cross-origin')
    }
    return new Response(response.body, { status: response.status, headers })
  },
}

function controllerHeaders(env) {
  return {
    'content-security-policy': [
      "default-src 'none'",
      "script-src 'self' data: 'unsafe-eval'",
      "worker-src 'self' blob:",
      "style-src 'self'",
      "frame-src 'self'",
      "connect-src 'none'",
      "img-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      `frame-ancestors ${env.IRISOUT_SITE_ORIGIN}`,
    ].join('; '),
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': 'camera=(), geolocation=(), microphone=()',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  }
}
