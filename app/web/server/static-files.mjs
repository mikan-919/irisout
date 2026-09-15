// 共有distの静的ファイルを安全に解決する。
// 公式サーバーと実行管理配信器で、percent encodingとpath traversalの検査を共有する。

import { readFile } from 'node:fs/promises'
import path from 'node:path'

export function decodeRequestPath(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) {
    throw publicPathError('invalid request path')
  }
  if (pathname.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw publicPathError('path traversal')
  }
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    throw publicPathError('invalid percent encoding')
  }
  if (
    decoded.includes('\0') ||
    decoded.includes('\\') ||
    decoded.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    throw publicPathError('path traversal')
  }
  return decoded
}

export async function resolvePublicPath(root, pathname, candidates = defaultCandidates) {
  return resolveDecodedPublicPath(root, decodeRequestPath(pathname), candidates)
}

export async function resolveDecodedPublicPath(
  root,
  decodedPathname,
  candidates = defaultCandidates,
) {
  const absoluteRoot = path.resolve(root)
  const relativePaths = candidates(decodedPathname)
  for (const relativePath of relativePaths) {
    const filePath = path.resolve(absoluteRoot, relativePath)
    if (filePath !== absoluteRoot && !filePath.startsWith(`${absoluteRoot}${path.sep}`)) {
      throw publicPathError('path traversal')
    }
    try {
      await readFile(filePath)
      return filePath
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'EISDIR') throw error
    }
  }
  const error = new Error('file not found')
  error.code = 'ENOENT'
  throw error
}

function defaultCandidates(decodedPathname) {
  const relative = decodedPathname === '/' ? 'index.html' : decodedPathname.slice(1)
  return [relative, path.join(relative, 'index.html'), `${relative}.html`]
}

function publicPathError(message) {
  const error = new Error(message)
  error.code = 'EINVAL'
  return error
}
