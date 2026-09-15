// 公式サイト側の編集画面。例と実行管理画面の接続を待ってからsourceを編集可能にする。
// 投稿sourceはこの画面でもサーバーへ送らず、実行管理画面から結果を受け取らない。

import {
  isStatusMessage,
  messageByteLength,
  PLAYGROUND_MESSAGE_MAX_BYTES,
  PLAYGROUND_PROTOCOL_VERSION,
  PLAYGROUND_SOURCE_MAX_BYTES,
} from './protocol.js'
import {
  clearPendingSave,
  deletePlayground,
  downloadText,
  exportSaveBundle,
  readPendingSave,
  savePlayground,
} from './save-share.js'
import { validateSeparateOrigins } from './origin.js'

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
  const saveElement = root.querySelector('[data-playground-save]')
  const deleteElement = root.querySelector('[data-playground-delete]')
  const exportElement = root.querySelector('[data-playground-export]')
  const titleElement = root.querySelector('[data-playground-title]')
  const descriptionElement = root.querySelector('[data-playground-description]')
  const statusElement = root.querySelector('[data-playground-status]')
  const resultElement = root.querySelector('[data-playground-result]')
  const shareElement = root.querySelector('[data-playground-share]')
  const shareLinkElement = root.querySelector('[data-playground-share-link]')
  const deleteTokenElement = root.querySelector('[data-playground-delete-token]')
  if (
    !(sourceElement instanceof HTMLTextAreaElement) ||
    !(exampleElement instanceof HTMLSelectElement) ||
    !(runElement instanceof HTMLButtonElement) ||
    !(stopElement instanceof HTMLButtonElement) ||
    !(saveElement instanceof HTMLButtonElement) ||
    !(deleteElement instanceof HTMLButtonElement) ||
    !(exportElement instanceof HTMLButtonElement) ||
    !(titleElement instanceof HTMLInputElement) ||
    !(descriptionElement instanceof HTMLInputElement) ||
    !(statusElement instanceof HTMLElement) ||
    !(resultElement instanceof HTMLElement) ||
    !(shareElement instanceof HTMLElement) ||
    !(shareLinkElement instanceof HTMLAnchorElement) ||
    !(deleteTokenElement instanceof HTMLElement)
  ) {
    return
  }

  // 共有ページからの複製値と既存入力は初期化より先に確定し、遅延した例読込みで失わない。
  const duplicateSource = readDuplicateSource()
  let sourceEdited = sourceElement.value.length > 0
  if (!sourceEdited) {
    sourceElement.value = duplicateSource ?? DEFAULT_SOURCE
    sourceEdited = duplicateSource !== null
  }
  const initialSource = sourceElement.value
  sourceElement.readOnly = true
  exampleElement.disabled = true
  runElement.disabled = true

  let controllerOrigin = null
  let executionError = ''
  try {
    controllerOrigin = resolveControllerOrigin()
    validateSeparateOrigins(location.origin, controllerOrigin)
  } catch (error) {
    controllerOrigin = null
    executionError = error instanceof Error ? error.message : String(error)
    resultElement.textContent =
      '実行管理画面を設定できないため実行できません。入力は保持されています。'
  }

  let controllerFrame = null
  let controllerReady = false
  if (controllerOrigin) {
    const parentOrigin = location.origin
    const controllerUrl = `${controllerOrigin}/playground-controller.html?parentOrigin=${encodeURIComponent(parentOrigin)}`
    controllerFrame = document.createElement('iframe')
    controllerFrame.className = 'playground-controller'
    controllerFrame.title = 'Playground実行管理画面'
    controllerFrame.setAttribute('referrerpolicy', 'no-referrer')
    controllerFrame.src = controllerUrl
    controllerFrame.addEventListener('load', () => {
      controllerReady = true
      updateReadyState()
    })
    resultElement.replaceChildren(controllerFrame)
  } else {
    controllerReady = true
    stopElement.disabled = true
    resultElement.textContent =
      '実行管理画面を設定できないため実行できません。入力は保持されています。'
  }

  let examples = []
  let examplesLoaded = false
  let examplesError = false
  let nextRunNumber = 0
  let activeRunId = null
  let latestSave = null

  sourceElement.addEventListener('input', () => {
    sourceEdited = true
  })

  if (controllerFrame && controllerOrigin) {
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
  }

  runElement.addEventListener('click', () => {
    if (!controllerFrame || !controllerOrigin) {
      setStatus(executionError || '実行管理画面を設定できないため実行できません', 'error')
      return
    }
    if (!examplesLoaded || !controllerReady) {
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
    if (!activeRunId || !controllerFrame || !controllerOrigin) return
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
    if (selected) {
      sourceElement.value = selected.source
      sourceEdited = true
    }
  })

  saveElement.addEventListener('click', async () => {
    saveElement.disabled = true
    setStatus('保存しています')
    try {
      latestSave = await savePlayground({
        title: titleElement.value,
        description: descriptionElement.value,
        source: sourceElement.value,
      })
      shareLinkElement.href = new URL(latestSave.url, location.origin).href
      shareLinkElement.textContent = shareLinkElement.href
      deleteTokenElement.textContent = latestSave.managementKey
      shareElement.hidden = false
      exportElement.disabled = false
      deleteElement.disabled = false
      setStatus('保存しました', 'success')
    } catch (error) {
      const pending = readPendingSave()
      exportElement.disabled = !pending?.managementKey
      setStatus(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      saveElement.disabled = false
    }
  })

  deleteElement.addEventListener('click', async () => {
    const pending = readPendingSave()
    const id = latestSave?.id ?? pending?.result?.id
    if (!id || !pending?.managementKey) return
    deleteElement.disabled = true
    setStatus('削除しています')
    try {
      await deletePlayground({ id, managementKey: pending.managementKey })
      clearPendingSave()
      latestSave = null
      shareElement.hidden = true
      exportElement.disabled = true
      setStatus('共有を削除しました', 'success')
    } catch (error) {
      deleteElement.disabled = false
      setStatus(error instanceof Error ? error.message : String(error), 'error')
    }
  })

  exportElement.addEventListener('click', () => {
    const pending = readPendingSave()
    if (!pending?.managementKey) return
    const result = latestSave ?? pending.result
    downloadText(
      'irisout-playground-share.json',
      exportSaveBundle({
        managementKey: pending.managementKey,
        result,
        source: sourceElement.value,
      }),
    )
    setStatus('共有情報を書き出しました', 'success')
  })

  updateReadyState()
  void loadExamples()

  function postToController(message) {
    controllerFrame?.contentWindow?.postMessage(message, controllerOrigin ?? '')
  }

  function setStatus(message, state = '') {
    statusElement.textContent = message
    statusElement.dataset.state =
      state === 'error' || state === 'timeout' ? 'error' : state === 'success' ? 'success' : ''
  }

  function updateReadyState() {
    const ready = examplesLoaded && controllerReady
    sourceElement.readOnly = !ready
    exampleElement.disabled = !examplesLoaded
    runElement.disabled = !ready || !controllerOrigin
    if (!ready) {
      if (!examplesLoaded) {
        setStatus('例を読み込んでいます')
      } else if (controllerOrigin && !controllerReady) {
        setStatus('実行管理画面を読み込んでいます')
      } else if (executionError) {
        setStatus(executionError, 'error')
      }
      return
    }
    setStatus(
      executionError || (examplesError ? '初期例を使っています' : '実行できます'),
      executionError ? 'error' : '',
    )
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
        if (!sourceEdited && sourceElement.value === initialSource) {
          sourceElement.value = examples[0].source
        }
      }
      const pending = readPendingSave()
      exportElement.disabled = !pending?.managementKey
      if (pending?.managementKey && pending.result?.id && pending.result?.url) {
        latestSave = pending.result
        shareLinkElement.href = new URL(pending.result.url, location.origin).href
        shareLinkElement.textContent = shareLinkElement.href
        deleteTokenElement.textContent = pending.managementKey
        shareElement.hidden = false
        deleteElement.disabled = false
      }
    } catch {
      examplesError = true
    } finally {
      examplesLoaded = true
      updateReadyState()
    }
  }

  function readDuplicateSource() {
    try {
      const source = sessionStorage.getItem('irisout.playground.duplicate-source')
      sessionStorage.removeItem('irisout.playground.duplicate-source')
      return source
    } catch {
      return null
    }
  }

  function resolveControllerOrigin() {
    const configured = import.meta.env.VITE_IRISOUT_PLAYGROUND_CONTROLLER_ORIGIN
    if (typeof configured !== 'string' || configured.trim().length === 0) {
      throw new Error('実行管理Originが未設定のため実行できません')
    }
    return new URL(configured).origin
  }
}
