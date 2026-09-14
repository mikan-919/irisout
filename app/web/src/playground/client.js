// 公式サイト側の編集画面。sourceを実行管理iframeへ送り、返る診断はtextContentだけで表示する。
// 投稿sourceはこの画面でもサーバーへ送らず、実行管理画面から結果を受け取らない。

import {
  isStatusMessage,
  messageByteLength,
  PLAYGROUND_MESSAGE_MAX_BYTES,
  PLAYGROUND_PROTOCOL_VERSION,
  PLAYGROUND_SOURCE_MAX_BYTES,
} from './protocol.js'

const DEFAULT_SOURCE = `export function Counter() {
  const count = signal(0)

  render(
    <main>
      <h1>Counter</h1>
      <output>{count()}</output>
      <button type="button" onClick={increment}>
        増加
      </button>
    </main>,
  )

  function increment() {
    count(count() + 1)
  }
}`

export function setupPlayground(root) {
  if (!(root instanceof HTMLElement)) return
  const sourceElement = root.querySelector('[data-playground-source]')
  const exampleElement = root.querySelector('[data-playground-example]')
  const runElement = root.querySelector('[data-playground-run]')
  const stopElement = root.querySelector('[data-playground-stop]')
  const statusElement = root.querySelector('[data-playground-status]')
  const resultElement = root.querySelector('[data-playground-result]')
  if (
    !(sourceElement instanceof HTMLTextAreaElement) ||
    !(exampleElement instanceof HTMLSelectElement) ||
    !(runElement instanceof HTMLButtonElement) ||
    !(stopElement instanceof HTMLButtonElement) ||
    !(statusElement instanceof HTMLElement) ||
    !(resultElement instanceof HTMLElement)
  ) {
    return
  }

  const controllerOrigin = resolveControllerOrigin()
  const parentOrigin = location.origin
  const controllerUrl = `${controllerOrigin}/playground-controller.html?parentOrigin=${encodeURIComponent(parentOrigin)}`
  const controllerFrame = document.createElement('iframe')
  controllerFrame.className = 'playground-controller'
  controllerFrame.title = 'Playground実行管理画面'
  controllerFrame.setAttribute('referrerpolicy', 'no-referrer')
  controllerFrame.src = controllerUrl
  resultElement.replaceChildren(controllerFrame)

  sourceElement.value = DEFAULT_SOURCE
  let examples = []
  let loaded = false
  let nextRunNumber = 0
  let activeRunId = null

  controllerFrame.addEventListener('load', () => {
    loaded = true
    runElement.disabled = false
    setStatus('実行できます')
  })
  window.addEventListener('message', (event) => {
    if (
      event.source !== controllerFrame.contentWindow ||
      event.origin !== controllerOrigin ||
      messageByteLength(event.data) > PLAYGROUND_MESSAGE_MAX_BYTES ||
      !isStatusMessage(event.data) ||
      event.data.runId !== activeRunId
    ) {
      return
    }
    const status = event.data
    const label = {
      compiling: '変換中です',
      running: '実行中です',
      success: '実行しました',
      error: '実行できませんでした',
      timeout: '時間超過で停止しました',
      stopped: '停止しました',
    }[status.status]
    setStatus(status.message ? `${label}: ${status.message}` : label, status.status)
    if (['success', 'error', 'timeout', 'stopped'].includes(status.status)) {
      stopElement.disabled = true
    }
  })

  runElement.addEventListener('click', () => {
    if (!loaded) {
      setStatus('実行管理画面を読み込んでいます', 'error')
      return
    }
    const source = sourceElement.value
    if (new TextEncoder().encode(source).byteLength > PLAYGROUND_SOURCE_MAX_BYTES) {
      setStatus('入力は64 KiB以内にしてください', 'error')
      return
    }
    const runId = `run-${++nextRunNumber}`
    activeRunId = runId
    stopElement.disabled = false
    postToController({
      type: 'irisout-playground/run',
      version: PLAYGROUND_PROTOCOL_VERSION,
      runId,
      source,
      compilerVersion: '0.2.2',
    })
    setStatus('変換中です')
  })

  stopElement.addEventListener('click', () => {
    if (!activeRunId) return
    postToController({
      type: 'irisout-playground/stop',
      version: PLAYGROUND_PROTOCOL_VERSION,
      runId: activeRunId,
    })
    activeRunId = null
    stopElement.disabled = true
    setStatus('停止しました')
  })

  exampleElement.addEventListener('change', () => {
    const selected = examples.find((example) => example.id === exampleElement.value)
    if (selected) sourceElement.value = selected.source
  })

  void loadExamples()

  function postToController(message) {
    controllerFrame.contentWindow?.postMessage(message, controllerOrigin)
  }

  function setStatus(message, state = '') {
    statusElement.textContent = message
    statusElement.dataset.state =
      state === 'error' || state === 'timeout' ? 'error' : state === 'success' ? 'success' : ''
  }

  async function loadExamples() {
    try {
      const response = await fetch('/docs/examples.json', { credentials: 'same-origin' })
      if (!response.ok) throw new Error(`examples.json: ${response.status}`)
      const value = await response.json()
      if (!Array.isArray(value)) throw new Error('examples.jsonの形式が不正です')
      examples = value.filter(
        (example) =>
          example &&
          typeof example.id === 'string' &&
          typeof example.title === 'string' &&
          typeof example.source === 'string',
      )
      for (const example of examples) {
        const option = document.createElement('option')
        option.value = example.id
        option.textContent = example.title
        exampleElement.append(option)
      }
      if (examples[0]) {
        exampleElement.value = examples[0].id
        sourceElement.value = examples[0].source
      }
      setStatus('実行できます')
    } catch {
      setStatus('初期例を使っています')
    }
  }

  function resolveControllerOrigin() {
    const configured = import.meta.env.VITE_IRISOUT_PLAYGROUND_CONTROLLER_ORIGIN
    if (typeof configured === 'string' && configured.length > 0) {
      return new URL(configured, location.origin).origin
    }
    return location.origin
  }
}
