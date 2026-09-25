// Playgroundの通信形式、配信元検査、保存と共有をまとめた境界モジュール。
// JSX、実行管理画面、Worker、サーバーから共有する処理だけを置く。

export const PLAYGROUND_PROTOCOL_VERSION = 1
export const PLAYGROUND_SOURCE_MAX_BYTES = 64 * 1024
export const PLAYGROUND_MESSAGE_MAX_BYTES = 128 * 1024
export const PLAYGROUND_RESULT_MAX_BYTES = 1024 * 1024
export const PLAYGROUND_COMPILE_TIMEOUT_MS = 5_000

const RUN_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/

export function byteLength(value) {
  return new TextEncoder().encode(value).byteLength
}

export function messageByteLength(value) {
  try {
    return byteLength(JSON.stringify(value))
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value, keys) {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

function isRunId(value) {
  return typeof value === 'string' && RUN_ID_PATTERN.test(value)
}

export function isRunMessage(value) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['type', 'version', 'runId', 'source', 'compilerVersion']) &&
    value.type === 'irisout-playground/run' &&
    value.version === PLAYGROUND_PROTOCOL_VERSION &&
    isRunId(value.runId) &&
    typeof value.source === 'string' &&
    byteLength(value.source) <= PLAYGROUND_SOURCE_MAX_BYTES &&
    typeof value.compilerVersion === 'string' &&
    value.compilerVersion.length > 0 &&
    value.compilerVersion.length <= 32
  )
}

export function isStopMessage(value) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['type', 'version', 'runId']) &&
    value.type === 'irisout-playground/stop' &&
    value.version === PLAYGROUND_PROTOCOL_VERSION &&
    isRunId(value.runId)
  )
}

export function isCompileResult(value) {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['type', 'version', 'runId', 'ok', 'code', 'initialHtml', 'message'])
  ) {
    return false
  }
  if (
    value.type !== 'irisout-playground/compile-result' ||
    value.version !== PLAYGROUND_PROTOCOL_VERSION ||
    !isRunId(value.runId) ||
    typeof value.ok !== 'boolean'
  ) {
    return false
  }
  if (value.ok) {
    return (
      typeof value.code === 'string' &&
      typeof value.initialHtml === 'string' &&
      typeof value.message === 'undefined'
    )
  }
  return typeof value.message === 'string' && value.message.length <= 8_192
}

export function isResultMessage(value) {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['type', 'version', 'runId', 'status', 'message']) ||
    value.type !== 'irisout-playground/result' ||
    value.version !== PLAYGROUND_PROTOCOL_VERSION ||
    !isRunId(value.runId) ||
    (value.status !== 'ready' && value.status !== 'error')
  ) {
    return false
  }
  return value.status === 'ready'
    ? typeof value.message === 'undefined'
    : typeof value.message === 'string' && value.message.length <= 8_192
}

export function makeStatusMessage(runId, status, message) {
  const result = {
    type: 'irisout-playground/status',
    version: PLAYGROUND_PROTOCOL_VERSION,
    runId,
    status,
  }
  if (message !== undefined) result.message = String(message).slice(0, 8_192)
  return result
}

export function isStatusMessage(value) {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['type', 'version', 'runId', 'status', 'message']) ||
    value.type !== 'irisout-playground/status' ||
    value.version !== PLAYGROUND_PROTOCOL_VERSION ||
    !isRunId(value.runId) ||
    typeof value.status !== 'string' ||
    !['ready', 'compiling', 'running', 'success', 'error', 'timeout', 'stopped'].includes(
      value.status,
    )
  ) {
    return false
  }
  return (
    value.message === undefined ||
    (typeof value.message === 'string' && value.message.length <= 8_192)
  )
}

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

export function configuredPlaygroundControllerOrigin() {
  return /** @type {{ env?: { VITE_IRISOUT_PLAYGROUND_CONTROLLER_ORIGIN?: string } }} */ (
    /** @type {unknown} */ (import.meta)
  ).env?.VITE_IRISOUT_PLAYGROUND_CONTROLLER_ORIGIN
}

export function resolvePlaygroundController(siteOrigin, configuredOrigin) {
  if (typeof configuredOrigin !== 'string' || configuredOrigin.trim().length === 0) {
    return { origin: '', error: '実行管理Originが未設定のため実行できません' }
  }
  try {
    const { controllerOrigin } = validateSeparateOrigins(siteOrigin, configuredOrigin)
    return { origin: controllerOrigin, error: '' }
  } catch (error) {
    return { origin: '', error: error instanceof Error ? error.message : String(error) }
  }
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

export const PLAYGROUND_SAVE_SCHEMA_VERSION = 1
export const PLAYGROUND_COMPILER_VERSION = '0.3.0'
export const PLAYGROUND_SAVE_DRAFT_KEY = 'irisout.playground.pending-save'

let memoryDraft = null

export function createManagementKey() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export function createRequestId() {
  return crypto.randomUUID()
}

export function readPendingSave(storage = getStorage()) {
  try {
    const serialized = storage?.getItem(PLAYGROUND_SAVE_DRAFT_KEY)
    return serialized ? JSON.parse(serialized) : memoryDraft
  } catch {
    return memoryDraft
  }
}

export function writePendingSave(value, storage = getStorage()) {
  memoryDraft = value
  try {
    storage?.setItem(PLAYGROUND_SAVE_DRAFT_KEY, JSON.stringify(value))
  } catch {
    // 保存領域が使えない環境ではメモリに残し、書き出し操作を使えるようにする。
  }
}

export function clearPendingSave(storage = getStorage()) {
  memoryDraft = null
  try {
    storage?.removeItem(PLAYGROUND_SAVE_DRAFT_KEY)
  } catch {
    // 下書き削除の失敗は次の保存を妨げない。
  }
}

export function takeDuplicateSource(storage = getSessionStorage()) {
  try {
    const source = storage?.getItem('irisout.playground.duplicate-source') ?? null
    storage?.removeItem('irisout.playground.duplicate-source')
    return source
  } catch {
    return null
  }
}

export function createSaveInput({
  title,
  description,
  source,
  compilerVersion = PLAYGROUND_COMPILER_VERSION,
}) {
  return {
    schemaVersion: PLAYGROUND_SAVE_SCHEMA_VERSION,
    title,
    description,
    source,
    compilerVersion,
    visibility: 'unlisted',
    requestId: createRequestId(),
  }
}

export async function savePlayground({
  title,
  description,
  source,
  compilerVersion = PLAYGROUND_COMPILER_VERSION,
  apiUrl = '/api/playgrounds',
  fetchImpl = globalThis.fetch,
  storage = getStorage(),
} = {}) {
  const candidate = { title, description, source, compilerVersion }
  const pending = readPendingSave(storage)
  const reusable = pending && sameInput(pending.input, candidate)
  const managementKey = reusable ? pending.managementKey : createManagementKey()
  const input = reusable
    ? pending.input
    : createSaveInput({ title, description, source, compilerVersion })
  const draft = { input, managementKey }
  writePendingSave(draft, storage)

  let response
  try {
    response = await fetchImpl(apiUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${managementKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
      credentials: 'same-origin',
    })
  } catch (error) {
    throw new SaveError('保存通信に失敗しました。入力は保持されています', 0, error)
  }

  let body = null
  try {
    body = await response.json()
  } catch {
    // 応答がJSONでない場合は状態を下書きのまま残す。
  }
  if (!response.ok || !isSaveResponse(body)) {
    const message =
      typeof body?.error === 'string' ? body.error : `保存に失敗しました (${response.status})`
    throw new SaveError(message, response.status)
  }
  const saved = { ...draft, result: body }
  writePendingSave(saved, storage)
  return { ...body, managementKey, input }
}

export async function deletePlayground({
  id,
  managementKey,
  apiUrl = id ? `/api/playgrounds/${encodeURIComponent(id)}` : '',
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof id !== 'string' || typeof managementKey !== 'string' || !apiUrl) {
    throw new SaveError('削除対象または管理鍵がありません', 0)
  }
  let response
  try {
    response = await fetchImpl(apiUrl, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${managementKey}` },
      credentials: 'same-origin',
    })
  } catch (error) {
    throw new SaveError('削除通信に失敗しました。管理鍵は保持されています', 0, error)
  }
  if (!response.ok) {
    let body = null
    try {
      body = await response.json()
    } catch {
      // JSONでない障害応答はHTTP状態だけを表示する。
    }
    const message =
      typeof body?.error === 'string' ? body.error : `削除に失敗しました (${response.status})`
    throw new SaveError(message, response.status)
  }
  return true
}

export function exportSaveBundle({ managementKey, result, source } = {}) {
  return JSON.stringify(
    {
      shareUrl: result?.url ?? '',
      deleteToken: managementKey ?? '',
      source: source ?? '',
    },
    null,
    2,
  )
}

export function downloadText(filename, text, documentObject = globalThis.document) {
  if (!documentObject?.body) return false
  const link = documentObject.createElement('a')
  link.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  link.download = filename
  link.click()
  queueMicrotask(() => URL.revokeObjectURL(link.href))
  return true
}

export class SaveError extends Error {
  constructor(message, status, cause) {
    super(message, { cause })
    this.name = 'SaveError'
    this.status = status
  }
}

function sameInput(input, candidate) {
  return (
    input &&
    input.title === candidate.title &&
    input.description === candidate.description &&
    input.source === candidate.source &&
    input.compilerVersion === candidate.compilerVersion
  )
}

function isSaveResponse(value) {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.id === 'string' &&
    typeof value.url === 'string' &&
    typeof value.createdAt === 'string' &&
    Object.keys(value).every((key) => ['id', 'url', 'createdAt'].includes(key))
  )
}

function getStorage() {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function getSessionStorage() {
  try {
    return globalThis.sessionStorage
  } catch {
    return undefined
  }
}
