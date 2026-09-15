// Playgroundの親画面、実行管理画面、Worker、結果iframeが共有する通信形式。
// 投稿ソースと生成結果はこの境界を越えるたびに検査し、任意のHTMLとして扱わない。

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
