// 公式サイト側の保存下書きと管理鍵を扱う。
// 管理鍵はこの画面で生成して保存し、実行管理iframeや共有ページへ渡さない。

export const PLAYGROUND_SAVE_SCHEMA_VERSION = 1
export const PLAYGROUND_COMPILER_VERSION = '0.2.2'
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
