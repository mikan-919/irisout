// 共有Playgroundの保存・削除APIを扱う。
// 公式OriginとJSONを検査し、投稿JSXは保存値としてだけSQLiteへ渡す。

import { TextDecoder } from 'node:util'

export const PLAYGROUND_SCHEMA_VERSION = 1
export const PLAYGROUND_BODY_MAX_BYTES = 128 * 1024
export const PLAYGROUND_SOURCE_MAX_BYTES = 64 * 1024
export const PLAYGROUND_TITLE_MAX_CODE_POINTS = 120
export const PLAYGROUND_DESCRIPTION_MAX_CODE_POINTS = 1_000
export const PLAYGROUND_TOKEN_BYTES = 32
export const PLAYGROUND_REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const PLAYGROUND_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/

const textDecoder = new TextDecoder('utf-8', { fatal: true })
const encoder = new TextEncoder()
const allowedInputKeys = new Set([
  'schemaVersion',
  'title',
  'description',
  'source',
  'compilerVersion',
  'visibility',
  'requestId',
])

export function createPlaygroundApi({
  store,
  officialOrigin,
  compilerVersions = ['0.2.2'],
  limits = {},
  now = () => Date.now(),
} = {}) {
  if (!store) throw new Error('PlaygroundStoreが必要です')
  const origin = new URL(officialOrigin).origin
  const supportedVersions = new Set(compilerVersions)
  const rateLimiter = new RateLimiter({
    savePerMinute: limits.savePerMinute ?? 10,
    savePerDay: limits.savePerDay ?? 100,
    deletePerMinute: limits.deletePerMinute ?? 30,
    now,
  })

  return {
    async handle(request) {
      const url = new URL(request.url)
      if (url.pathname === '/api/playgrounds' && request.method === 'POST') {
        return handleSave(request, { store, origin, supportedVersions, rateLimiter })
      }
      const idMatch = url.pathname.match(/^\/api\/playgrounds\/([^/]+)$/)
      if (idMatch && request.method === 'DELETE') {
        return handleDelete(request, idMatch[1], { store, origin, rateLimiter })
      }
      return null
    },
    resetRateLimits() {
      rateLimiter.clear()
    },
  }
}

async function handleSave(request, context) {
  const originError = checkOrigin(request, context.origin)
  if (originError) return originError
  if (!isJsonContentType(request.headers.get('content-type'))) {
    return jsonError(415, 'application/jsonが必要です')
  }
  const rateError = context.rateLimiter.check(request, 'save')
  if (rateError) return rateError

  const token = readBearerToken(request.headers.get('authorization'))
  if (!token) return jsonError(400, '管理鍵が必要です')
  let body
  try {
    body = await readJsonBody(request)
  } catch (error) {
    return jsonError(error.status ?? 400, error.message)
  }
  const input = validateInput(body, context.supportedVersions)
  if (!input.ok) return jsonError(input.status, input.message)

  try {
    const result = context.store.save({ input: input.value, deleteToken: token })
    if (result.kind === 'not-found') return jsonError(404, '保存要求が見つかりません')
    if (result.kind === 'deleted') return jsonError(410, '保存要求は削除済みです')
    if (result.kind === 'conflict') return jsonError(409, '保存要求IDが別の入力に使われています')
    return json({
      status: result.kind === 'created' ? 201 : 200,
      value: {
        id: result.id,
        url: new URL(`/playground/${result.id}`, context.origin).href,
        createdAt: result.createdAt,
      },
    })
  } catch {
    return jsonError(503, '保存先を利用できません')
  }
}

async function handleDelete(request, id, context) {
  const originError = checkOrigin(request, context.origin)
  if (originError) return originError
  if (!PLAYGROUND_ID_PATTERN.test(id)) return jsonError(404, '共有が見つかりません')
  const rateError = context.rateLimiter.check(request, 'delete')
  if (rateError) return rateError
  const token = readBearerToken(request.headers.get('authorization'))
  if (!token) return jsonError(404, '共有が見つかりません')

  try {
    const result = context.store.delete(id, token)
    if (result === 'not-found') return jsonError(404, '共有が見つかりません')
    return new Response(null, {
      status: 204,
      headers: noStoreHeaders(),
    })
  } catch {
    return jsonError(503, '保存先を利用できません')
  }
}

export function validateInput(value, supportedVersions = new Set(['0.2.2'])) {
  if (!isRecord(value)) return invalid(400, 'JSONオブジェクトが必要です')
  for (const key of Object.keys(value)) {
    if (!allowedInputKeys.has(key)) return invalid(422, `未知の項目: ${key}`)
  }
  if (value.schemaVersion !== PLAYGROUND_SCHEMA_VERSION) {
    return invalid(422, 'schemaVersionは1だけを指定できます')
  }
  if (typeof value.title !== 'string') return invalid(400, 'titleは文字列が必要です')
  const title = value.title.trim()
  if (!inCodePointRange(title, 1, PLAYGROUND_TITLE_MAX_CODE_POINTS)) {
    return invalid(422, 'titleは前後の空白を除いて120文字以内にしてください')
  }
  const description = value.description === undefined ? '' : value.description
  if (typeof description !== 'string') {
    return invalid(400, 'descriptionは文字列が必要です')
  }
  if (!inCodePointRange(description, 0, PLAYGROUND_DESCRIPTION_MAX_CODE_POINTS)) {
    return invalid(422, 'descriptionは1000文字以内にしてください')
  }
  if (typeof value.source !== 'string') return invalid(400, 'sourceは文字列が必要です')
  if (encoder.encode(value.source).byteLength > PLAYGROUND_SOURCE_MAX_BYTES) {
    return invalid(413, 'sourceは64 KiB以内にしてください')
  }
  if (typeof value.compilerVersion !== 'string') {
    return invalid(400, 'compilerVersionは文字列が必要です')
  }
  if (!supportedVersions.has(value.compilerVersion)) {
    return invalid(422, '利用できないcompilerVersionです')
  }
  if (value.visibility !== 'unlisted') return invalid(422, 'visibilityはunlistedだけを指定できます')
  if (typeof value.requestId !== 'string' || !PLAYGROUND_REQUEST_ID_PATTERN.test(value.requestId)) {
    return invalid(422, 'requestIdはUUIDで指定してください')
  }
  return {
    ok: true,
    value: {
      schemaVersion: value.schemaVersion,
      title,
      description,
      source: value.source,
      compilerVersion: value.compilerVersion,
      visibility: value.visibility,
      requestId: value.requestId,
    },
  }
}

export function readBearerToken(value) {
  if (typeof value !== 'string') return null
  const match = value.match(/^Bearer ([A-Za-z0-9_-]+)$/)
  if (!match || match[1].length !== 43) return null
  try {
    if (Buffer.from(match[1], 'base64url').byteLength !== PLAYGROUND_TOKEN_BYTES) return null
  } catch {
    return null
  }
  return match[1]
}

export function createPlaygroundOgp(record, officialOrigin) {
  if (!record || typeof record.id !== 'string') return null
  const origin = new URL(officialOrigin).origin
  return {
    title: record.title,
    description: record.description,
    url: new URL(`/playground/${record.id}`, origin).href,
    image: new URL('/docs/assets/logo.webp', origin).href,
  }
}

function checkOrigin(request, officialOrigin) {
  if (request.headers.get('origin') !== officialOrigin) {
    return jsonError(403, '公式Originからの要求だけを受け付けます')
  }
  return null
}

function isJsonContentType(value) {
  return typeof value === 'string' && /^application\/json(?:\s*;|$)/i.test(value)
}

async function readJsonBody(request) {
  const reader = request.body?.getReader()
  if (!reader) throw httpError(400, 'JSON本文が必要です')
  const chunks = []
  let total = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      total += part.value.byteLength
      if (total > PLAYGROUND_BODY_MAX_BYTES) throw httpError(413, '本文は128 KiB以内にしてください')
      chunks.push(part.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  let text
  try {
    text = textDecoder.decode(bytes)
  } catch {
    throw httpError(400, 'UTF-8のJSONが必要です')
  }
  try {
    return JSON.parse(text)
  } catch {
    throw httpError(400, 'JSONを解析できません')
  }
}

function invalid(status, message) {
  return { ok: false, status, message }
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status })
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function inCodePointRange(value, minimum, maximum) {
  const count = Array.from(value).length
  return count >= minimum && count <= maximum
}

function json({ status, value }) {
  return new Response(JSON.stringify(value), {
    status,
    headers: noStoreHeaders(),
  })
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: noStoreHeaders(),
  })
}

function noStoreHeaders() {
  return {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  }
}

class RateLimiter {
  constructor({ savePerMinute, savePerDay, deletePerMinute, now }) {
    this.limits = { savePerMinute, savePerDay, deletePerMinute }
    this.now = now
    this.buckets = new Map()
  }

  check(request, operation) {
    const key = `${operation}:${request.headers.get('x-forwarded-for') ?? 'unknown'}`
    const current = this.now()
    const bucket = this.buckets.get(key) ?? { minute: [], day: [] }
    bucket.minute = bucket.minute.filter((timestamp) => current - timestamp < 60_000)
    bucket.day = bucket.day.filter((timestamp) => current - timestamp < 86_400_000)
    const minuteLimit =
      operation === 'save' ? this.limits.savePerMinute : this.limits.deletePerMinute
    const dayLimit = operation === 'save' ? this.limits.savePerDay : Number.POSITIVE_INFINITY
    if (bucket.minute.length >= minuteLimit || bucket.day.length >= dayLimit) {
      const oldest = bucket.minute[0] ?? bucket.day[0] ?? current
      const retryAfter = Math.max(
        1,
        Math.ceil(
          (oldest + (bucket.day.length >= dayLimit ? 86_400_000 : 60_000) - current) / 1000,
        ),
      )
      this.buckets.set(key, bucket)
      return new Response(JSON.stringify({ error: '要求回数が上限を超えています' }), {
        status: 429,
        headers: {
          ...noStoreHeaders(),
          'retry-after': String(retryAfter),
        },
      })
    }
    bucket.minute.push(current)
    if (operation === 'save') bucket.day.push(current)
    this.buckets.set(key, bucket)
    return null
  }

  clear() {
    this.buckets.clear()
  }
}
