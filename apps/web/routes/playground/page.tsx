// Playgroundの画面構造・状態・操作をirisout JSXへ集約する。
// Monaco、保存通信、実行iframeのプロトコルだけをブラウザー境界のJSへ委ねる。
import { derived, onMount, render, signal } from 'irisout'
import { SiteHeader } from '../../src/SiteHeader.jsx'
// @ts-ignore authored JSXではVite aliasをコンパイラ境界として使う。
import {
  clearPendingSave,
  configuredPlaygroundControllerOrigin,
  deletePlayground,
  downloadText,
  exportSaveBundle,
  isStatusMessage,
  messageByteLength,
  PLAYGROUND_MESSAGE_MAX_BYTES,
  PLAYGROUND_PROTOCOL_VERSION,
  PLAYGROUND_SOURCE_MAX_BYTES,
  readPendingSave,
  resolvePlaygroundController,
  savePlayground,
  takeDuplicateSource,
  // @ts-ignore Vite aliasはコンパイラ境界として実行時に解決する。
} from '@playground/shared'

const DEFAULT_SOURCE = `import { render, signal } from 'irisout'

export function Counter() {
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

export function Playground() {
  const source = signal(DEFAULT_SOURCE)
  const sourceEdited = signal(false)
  const examples = signal([])
  const selectedExampleId = signal('')
  const examplesLoaded = signal(false)
  const examplesError = signal(false)
  const controllerOrigin = signal('')
  const controllerReady = signal(false)
  const executionError = signal('')
  const statusText = signal('例を読み込んでいます')
  const statusState = signal('')
  const running = signal(false)
  const saving = signal(false)
  const deleting = signal(false)
  const title = signal('Irisout Playground')
  const description = signal('')
  const shareUrl = signal('')
  const managementKey = signal('')
  const savedId = signal('')
  const nextRunNumber = signal(0)
  const activeRunId = signal(null)
  const controllerFrame = signal(null)
  const ready = derived(() => examplesLoaded() && controllerReady())
  const controllerUrl = derived(() =>
    controllerOrigin()
      ? `${controllerOrigin()}/playground-controller.html?parentOrigin=${encodeURIComponent(location.origin)}`
      : '',
  )
  render(
    <div class="site-shell playground-shell">
      <SiteHeader current="playground" search={false} onSearch={null} />
      <main>
        <section class="playground-section playground-page-section">
          <div class="playground-intro">
            <div>
              <h1>Playground</h1>
              <p>JSXと実行結果を並べて確認する。</p>
            </div>
            <p
              id="playground-status"
              class="playground-status"
              data-playground-status
              data-state={statusState()}
              role="status"
            >
              <span class="playground-status-dot" aria-hidden="true" />
              <span>{statusText()}</span>
            </p>
          </div>
          <div class="playground-editor" data-playground-root>
            <div class="playground-editor-head">
              <div class="playground-actions">
                <label class="playground-example-label">
                  <select
                    data-playground-example
                    aria-label="公式例"
                    value={selectedExampleId()}
                    disabled={!examplesLoaded()}
                    onChange={selectExample}
                  >
                    {examples().map((example) => (
                      <option key={example.id} value={example.id}>
                        {example.title}
                      </option>
                    ))}
                  </select>
                </label>
                <button class="playground-control" type="button" onClick={resetSource}>
                  戻す
                </button>
              </div>
              <div class="playground-actions">
                <span class="playground-shortcut">⌘ / Ctrl + Enter</span>
                <button
                  class="playground-control playground-primary"
                  type="button"
                  data-playground-run
                  disabled={!ready() || !controllerOrigin()}
                  onClick={runSource}
                >
                  実行
                </button>
                <button
                  class="playground-control"
                  type="button"
                  data-playground-stop
                  disabled={!running()}
                  onClick={stopRun}
                >
                  停止
                </button>
              </div>
            </div>
            <div class="playground-workspace">
              <div class="playground-pane playground-source-pane">
                <div class="playground-pane-head">
                  <strong>App.jsx</strong>
                  <span>source</span>
                </div>
                <label class="playground-visually-hidden" for="playground-source">
                  入力JSX
                </label>
                <textarea
                  id="playground-source"
                  class="playground-source"
                  data-playground-source
                  spellcheck="false"
                  readOnly={!ready()}
                  rows="16"
                  aria-describedby="playground-status"
                  value={source()}
                  use={announceEditorState}
                  onInput={editSource}
                />
                <div
                  class="playground-monaco"
                  data-playground-monaco
                  aria-describedby="playground-status"
                  hidden
                />
              </div>
              <div class="playground-pane playground-preview-pane">
                <div class="playground-pane-head">
                  <strong>Preview</strong>
                  <span>browser</span>
                </div>
                <div class="playground-result" data-playground-result>
                  {controllerUrl() ? (
                    <iframe
                      class="playground-controller"
                      title="Playground実行管理画面"
                      referrerpolicy="no-referrer"
                      src={controllerUrl()}
                      use={(element) => {
                        controllerFrame(element)
                      }}
                      onLoad={() => {
                        controllerReady(true)
                        updateReadyState()
                      }}
                    />
                  ) : (
                    <p>実行管理画面を設定できないため実行できません。入力は保持されています。</p>
                  )}
                </div>
              </div>
            </div>
            <section class="playground-output" aria-labelledby="playground-share-heading">
              <h2 id="playground-share-heading">共有</h2>
              <div class="playground-output-shell">
                <div class="playground-output-head">
                  <span>保存設定</span>
                  <div class="playground-actions">
                    <button
                      class="playground-control"
                      type="button"
                      data-playground-save
                      disabled={saving()}
                      onClick={saveSource}
                    >
                      保存／再送
                    </button>
                    <button
                      class="playground-control"
                      type="button"
                      data-playground-delete
                      disabled={!savedId() || !managementKey() || deleting()}
                      onClick={deleteShare}
                    >
                      共有を削除
                    </button>
                    <button
                      class="playground-control"
                      type="button"
                      data-playground-export
                      disabled={!managementKey()}
                      onClick={exportShare}
                    >
                      書き出し
                    </button>
                  </div>
                </div>
                <div class="playground-save-fields">
                  <label class="playground-source-label" for="playground-title">
                    共有タイトル
                    <input
                      id="playground-title"
                      data-playground-title
                      value={title()}
                      onInput={(event) => title(event.currentTarget.value)}
                    />
                  </label>
                  <label class="playground-source-label" for="playground-description">
                    説明
                    <input
                      id="playground-description"
                      data-playground-description
                      value={description()}
                      onInput={(event) => description(event.currentTarget.value)}
                    />
                  </label>
                </div>
                {shareUrl() && (
                  <div class="playground-share" data-playground-share aria-live="polite">
                    <p>
                      <span>共有URL: </span>
                      <a
                        data-playground-share-link
                        href={shareUrl()}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shareUrl()}
                      </a>
                    </p>
                    <p>
                      <span>削除用の管理鍵: </span>
                      <code data-playground-delete-token>{managementKey()}</code>
                    </p>
                    <small>管理鍵を失うと自分で削除できません。書き出して保管してください。</small>
                  </div>
                )}
              </div>
            </section>
          </div>
        </section>
      </main>
      <footer class="site-footer">
        <div class="content-shell footer-inner">
          <a class="brand footer-brand" href="/">
            <span class="brand-name">irisout</span>
            <span class="footer-tagline">compile the interface</span>
          </a>
          <div class="footer-links">
            <a href="/">ホーム</a>
            <a href="/docs">ドキュメント</a>
            <a href="https://github.com/mikan-919/irisout">GitHub ↗</a>
          </div>
          <span class="footer-copy">Apache License 2.0 · 2026</span>
        </div>
      </footer>
    </div>,
  )

  function setStatus(message, state = '') {
    statusText(message)
    statusState(
      state === 'error' || state === 'timeout' ? 'error' : state === 'success' ? 'success' : '',
    )
  }

  function updateReadyState() {
    if (!examplesLoaded()) {
      setStatus('例を読み込んでいます')
    } else if (controllerOrigin() && !controllerReady()) {
      setStatus('実行管理画面を読み込んでいます')
    } else {
      setStatus(
        executionError() || (examplesError() ? '初期例を使っています' : '実行できます'),
        executionError() ? 'error' : '',
      )
    }
  }

  function editSource(event) {
    const value = event.currentTarget.value
    sourceEdited(true)
    source(value)
  }

  function selectExample(event) {
    const id = event.currentTarget.value
    const selected = examples().find((example) => example.id === id)
    selectedExampleId(id)
    if (selected) {
      sourceEdited(true)
      source(selected.source)
    }
  }

  function resetSource() {
    const selected = examples().find((example) => example.id === selectedExampleId())
    source(selected?.source ?? DEFAULT_SOURCE)
    sourceEdited(true)
    setStatus('入力を戻しました')
  }

  function announceEditorState(element) {
    return {
      update() {
        element.readOnly = !ready()
        element.dispatchEvent(
          new CustomEvent('irisout:editor-state', {
            detail: { value: source(), readOnly: !ready() },
          }),
        )
      },
    }
  }

  function postToController(message) {
    controllerFrame()?.contentWindow?.postMessage(message, controllerOrigin())
  }

  function runSource() {
    if (!controllerFrame() || !controllerOrigin()) {
      setStatus(executionError() || '実行管理画面を設定できないため実行できません', 'error')
    } else if (!ready()) {
      setStatus('実行管理画面を読み込んでいます', 'error')
    } else if (new TextEncoder().encode(source()).byteLength > PLAYGROUND_SOURCE_MAX_BYTES) {
      setStatus('入力は64 KiB以内にしてください', 'error')
    } else {
      nextRunNumber(nextRunNumber() + 1)
      activeRunId(`run-${nextRunNumber()}`)
      running(true)
      postToController({
        type: 'irisout-playground/run',
        version: PLAYGROUND_PROTOCOL_VERSION,
        runId: activeRunId(),
        source: source(),
        compilerVersion: '0.2.2',
      })
      setStatus('変換中です')
    }
  }

  function stopRun() {
    if (!activeRunId() || !controllerFrame() || !controllerOrigin()) return
    postToController({
      type: 'irisout-playground/stop',
      version: PLAYGROUND_PROTOCOL_VERSION,
      runId: activeRunId(),
    })
    activeRunId(null)
    running(false)
    setStatus('停止しました')
  }

  function saveSource() {
    saving(true)
    setStatus('保存しています')
    void savePlayground({ title: title(), description: description(), source: source() })
      .then((saved) => {
        const url = new URL(saved.url, location.origin).href
        savedId(saved.id)
        managementKey(saved.managementKey)
        shareUrl(url)
        setStatus('保存しました', 'success')
      })
      .catch((error) => {
        const pending = readPendingSave()
        managementKey(pending?.managementKey ?? '')
        setStatus(error instanceof Error ? error.message : String(error), 'error')
      })
      .finally(() => saving(false))
  }

  function deleteShare() {
    if (!savedId() || !managementKey()) return
    deleting(true)
    setStatus('削除しています')
    void deletePlayground({ id: savedId(), managementKey: managementKey() })
      .then(() => {
        clearPendingSave()
        savedId('')
        shareUrl('')
        managementKey('')
        setStatus('共有を削除しました', 'success')
      })
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : String(error), 'error')
      })
      .finally(() => deleting(false))
  }

  function exportShare() {
    if (!managementKey()) return
    const pending = readPendingSave()
    const result = pending?.result ?? { id: savedId(), url: shareUrl() }
    downloadText(
      'irisout-playground-share.json',
      exportSaveBundle({ managementKey: managementKey(), result, source: source() }),
    )
    setStatus('共有情報を書き出しました', 'success')
  }

  onMount(() => {
    const duplicateSource = takeDuplicateSource()
    if (duplicateSource !== null) {
      sourceEdited(true)
      source(duplicateSource)
    }

    const resolved = resolvePlaygroundController(
      location.origin,
      configuredPlaygroundControllerOrigin(),
    )
    controllerOrigin(resolved.origin)
    executionError(resolved.error)
    if (!resolved.origin) controllerReady(true)

    const pending = readPendingSave()
    if (pending?.managementKey) managementKey(pending.managementKey)
    if (pending?.result?.id && pending.result.url) {
      savedId(pending.result.id)
      shareUrl(new URL(pending.result.url, location.origin).href)
    }

    const requestedValues = new URLSearchParams(location.search).getAll('example')
    const requestedId =
      requestedValues.length === 1 && requestedValues[0] ? requestedValues[0] : null
    void fetch('/docs/examples.json', { credentials: 'same-origin' })
      .then((response) => {
        if (!response.ok) throw new Error(`examples.json: ${response.status}`)
        return response.json()
      })
      .then((value) => {
        if (!Array.isArray(value)) throw new Error('examples.jsonの形式が不正です')
        const loaded = value.filter(
          (example) =>
            example &&
            typeof example.id === 'string' &&
            typeof example.title === 'string' &&
            typeof example.source === 'string',
        )
        examples(loaded)
        const selected = loaded.find((example) => example.id === requestedId) ?? loaded[0]
        if (selected) {
          selectedExampleId(selected.id)
          if (!sourceEdited()) source(selected.source)
        }
      })
      .catch(() => examplesError(true))
      .finally(() => {
        examplesLoaded(true)
        updateReadyState()
      })

    const receiveStatus = (event) => {
      if (
        event.source !== controllerFrame()?.contentWindow ||
        event.origin !== controllerOrigin() ||
        messageByteLength(event.data) > PLAYGROUND_MESSAGE_MAX_BYTES ||
        !isStatusMessage(event.data) ||
        event.data.runId !== activeRunId()
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
      if (['success', 'error', 'timeout', 'stopped'].includes(status.status)) running(false)
    }
    const runShortcut = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        runSource()
      }
    }
    window.addEventListener('message', receiveStatus)
    window.addEventListener('keydown', runShortcut)
    updateReadyState()
    return () => {
      window.removeEventListener('message', receiveStatus)
      window.removeEventListener('keydown', runShortcut)
    }
  })
}
