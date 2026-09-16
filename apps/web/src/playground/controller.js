// 公式サイトから分離した実行管理画面。
// この画面だけがWorkerと結果iframeを所有し、親画面へ生成HTMLやsourceを返さない。

import './controller.css'
import {
  byteLength,
  isCompileResult,
  isResultMessage,
  isRunMessage,
  isStopMessage,
  makeStatusMessage,
  messageByteLength,
  PLAYGROUND_COMPILE_TIMEOUT_MS,
  PLAYGROUND_MESSAGE_MAX_BYTES,
  PLAYGROUND_RESULT_MAX_BYTES,
} from './protocol.js'

const statusElement = document.querySelector('#controller-status')
const resultRoot = document.querySelector('#result-root')
const controllerParameters = new URLSearchParams(location.search)
const parentOrigin = controllerParameters.get('parentOrigin')
const runtimeModulePromise = import('./runtime.js')

let currentRunId = null
let activeWorker = null
let activeResult = null

window.addEventListener('message', (event) => {
  if (
    event.source !== window.parent ||
    !isAllowedParentOrigin(event.origin) ||
    messageByteLength(event.data) > PLAYGROUND_MESSAGE_MAX_BYTES
  ) {
    return
  }

  if (isRunMessage(event.data)) {
    startRun(event.data)
    return
  }
  if (isStopMessage(event.data)) stopRun(event.data.runId)
})

function isAllowedParentOrigin(origin) {
  return typeof parentOrigin === 'string' && parentOrigin === origin
}

function startRun(message) {
  stopRun(currentRunId, false)
  currentRunId = message.runId
  clearResult()
  setStatus('compiling')

  let worker
  try {
    worker = new Worker(new URL('./compiler.worker.js', import.meta.url), { type: 'module' })
  } catch (error) {
    setStatus('error', error)
    return
  }

  const workerRun = { runId: message.runId, worker, timeoutId: 0 }
  activeWorker = workerRun
  workerRun.timeoutId = window.setTimeout(() => {
    if (activeWorker !== workerRun || currentRunId !== message.runId) return
    finishWorker(workerRun)
    setStatus('timeout', 'コンパイルが5秒を超えたため停止しました')
  }, PLAYGROUND_COMPILE_TIMEOUT_MS)
  worker.addEventListener('message', (event) => handleCompileResult(workerRun, event.data))
  worker.addEventListener('error', (event) => {
    if (activeWorker !== workerRun || currentRunId !== message.runId) return
    finishWorker(workerRun)
    setStatus('error', event.message || 'コンパイルWorkerでエラーが発生しました')
  })
  worker.postMessage(message)
}

function handleCompileResult(workerRun, value) {
  if (activeWorker !== workerRun || currentRunId !== workerRun.runId) return
  if (
    messageByteLength(value) > PLAYGROUND_RESULT_MAX_BYTES + PLAYGROUND_MESSAGE_MAX_BYTES ||
    !isCompileResult(value) ||
    value.runId !== workerRun.runId
  ) {
    finishWorker(workerRun)
    setStatus('error', 'コンパイル結果の形式または大きさが不正です')
    return
  }

  finishWorker(workerRun)
  if (!value.ok) {
    setStatus('error', value.message)
    return
  }
  if (byteLength(value.code) + byteLength(value.initialHtml) > PLAYGROUND_RESULT_MAX_BYTES) {
    setStatus('error', '生成結果が1 MiBを超えています')
    return
  }
  setStatus('running')
  void createResult(value, workerRun.runId).catch((error) => {
    clearResult()
    setStatus('error', error)
  })
}

function finishWorker(workerRun) {
  if (activeWorker !== workerRun) return
  activeWorker = null
  window.clearTimeout(workerRun.timeoutId)
  workerRun.worker.onmessage = null
  workerRun.worker.onerror = null
  void workerRun.worker.terminate()
}

function stopRun(runId, notify = true) {
  if (runId === null || runId === undefined) return
  if (currentRunId !== runId) return
  if (activeWorker) finishWorker(activeWorker)
  clearResult()
  currentRunId = null
  if (notify) setStatus('stopped')
}

function clearResult() {
  if (activeResult) {
    if (activeResult.messageHandler) {
      window.removeEventListener('message', activeResult.messageHandler)
    }
    activeResult = null
  }
  resultRoot?.replaceChildren()
}

async function createResult(result, runId) {
  const runtimeModule = await runtimeModulePromise
  if (currentRunId !== runId) return
  if (typeof runtimeModule.runtimeUrl !== 'string') {
    throw new Error('実行runtimeの配信先を確認できません')
  }
  const runtimeUrl = runtimeModule.runtimeUrl
  const generatedCode = replaceRuntimeImport(result.code, runtimeUrl)
  const moduleUrl = createModuleDataUrl(`${generatedCode}
try {
  mountComponent(document.getElementById('app'));
  parent.postMessage(${JSON.stringify({
    type: 'irisout-playground/result',
    version: 1,
    runId,
    status: 'ready',
  })}, '*');
} catch (error) {
  const resultError = ${JSON.stringify({
    type: 'irisout-playground/result',
    version: 1,
    runId,
    status: 'error',
  })};
  resultError.message = error instanceof Error ? error.message : String(error);
  parent.postMessage(resultError, '*');
}`)
  const iframe = document.createElement('iframe')
  iframe.title = 'JSXの実行結果'
  iframe.setAttribute('sandbox', 'allow-scripts')
  iframe.setAttribute('referrerpolicy', 'no-referrer')
  // CSSが未適用でもブラウザー既定の枠と寸法を表示しない。
  iframe.style.display = 'block'
  iframe.style.width = '100%'
  iframe.style.minHeight = '16rem'
  iframe.style.border = '0'
  iframe.style.background = 'transparent'
  iframe.srcdoc = createResultDocument(moduleUrl, runtimeUrl)
  const resultRun = { runId, iframe, moduleUrl, messageHandler: null }
  activeResult = resultRun
  iframe.addEventListener('load', () => {
    if (activeResult !== resultRun || currentRunId !== resultRun.runId) return
    setStatus('running')
  })
  resultRun.messageHandler = (event) => handleResultMessage(resultRun, event)
  window.addEventListener('message', resultRun.messageHandler)
  resultRoot?.replaceChildren(iframe)
}

function createModuleDataUrl(code) {
  const bytes = new TextEncoder().encode(code)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768))
  }
  return `data:text/javascript;base64,${btoa(binary)}`
}

function replaceRuntimeImport(code, runtimeUrl) {
  const importPattern = /from\s+(['"])irisout\/runtime\1/
  if (!importPattern.test(code)) throw new Error('生成moduleのruntime入口を確認できません')
  return code.replace(importPattern, `from ${JSON.stringify(runtimeUrl)}`)
}

function createResultDocument(blobUrl, runtimeUrl) {
  const runtimeOrigin = new URL(runtimeUrl).origin
  const csp = [
    "default-src 'none'",
    `script-src ${runtimeOrigin} data:`,
    "style-src 'unsafe-inline'",
    "connect-src 'none'",
    "img-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "navigate-to 'none'",
  ].join('; ')
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(csp)}"><style>html,body { background: transparent; }</style></head><body><div id="app"></div><script type="module" src="${escapeHtmlAttribute(blobUrl)}"></script></body></html>`
}

function escapeHtmlAttribute(value) {
  return value.replace(/[&"<>]/g, (character) => {
    if (character === '&') return '&amp;'
    if (character === '"') return '&quot;'
    if (character === '<') return '&lt;'
    return '&gt;'
  })
}

function handleResultMessage(resultRun, event) {
  if (
    activeResult !== resultRun ||
    currentRunId !== resultRun.runId ||
    event.source !== resultRun.iframe.contentWindow ||
    event.origin !== 'null' ||
    messageByteLength(event.data) > PLAYGROUND_MESSAGE_MAX_BYTES ||
    !isResultMessage(event.data) ||
    event.data.runId !== resultRun.runId
  ) {
    return
  }
  if (event.data.status === 'ready') {
    setStatus('success')
  } else {
    setStatus('error', event.data.message)
  }
}

function setStatus(status, message) {
  const labels = {
    compiling: '変換中です',
    running: '実行中です',
    success: '実行しました',
    error: '実行できませんでした',
    timeout: '時間超過で停止しました',
    stopped: '停止しました',
  }
  if (!statusElement) return
  statusElement.dataset.state = ['error', 'timeout'].includes(status)
    ? 'error'
    : status === 'success'
      ? 'success'
      : ''
  statusElement.textContent = message
    ? `${labels[status] ?? status}: ${String(message)}`
    : (labels[status] ?? status)
  postStatus(currentRunId ?? 'invalid', status, message)
}

function postStatus(runId, status, message) {
  if (!isRunIdForStatus(runId) || typeof parentOrigin !== 'string') return
  const payload = makeStatusMessage(runId, status, message)
  if (messageByteLength(payload) > PLAYGROUND_MESSAGE_MAX_BYTES) return
  window.parent.postMessage(payload, parentOrigin)
}

function isRunIdForStatus(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 64
}
