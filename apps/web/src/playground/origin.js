// Playgroundの配信元をOriginへ正規化し、公式サイトと実行管理画面の境界を検査する。

export function normalizeOrigin(value, label = 'Origin') {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label}を明示してください`)
  }
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${label}が不正です`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${label}はhttpまたはhttpsで指定してください`)
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${label}はOriginだけで指定してください`)
  }
  return url.origin
}

export function validateSeparateOrigins(siteOrigin, controllerOrigin) {
  const site = normalizeOrigin(siteOrigin, '公式Origin')
  const controller = normalizeOrigin(controllerOrigin, '実行管理Origin')
  if (new URL(site).hostname === new URL(controller).hostname) {
    throw new Error('公式Originと実行管理Originは異なるhostnameを指定してください')
  }
  return { siteOrigin: site, controllerOrigin: controller }
}

export function createControllerCsp(siteOrigin) {
  const frameAncestors = siteOrigin ? normalizeOrigin(siteOrigin, '公式Origin') : "'none'"
  return [
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
    `frame-ancestors ${frameAncestors}`,
  ].join('; ')
}
