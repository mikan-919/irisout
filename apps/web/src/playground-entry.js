// Playground JSXと、コンパイラ未対応のMonaco遅延読込みだけを起動する。
import 'virtual:irisout-playground'

const sourceElement = document.querySelector('[data-playground-source]')
const monacoElement = document.querySelector('[data-playground-monaco]')
if (sourceElement instanceof HTMLTextAreaElement && monacoElement instanceof HTMLElement) {
  let editor = null
  const syncEditor = (event) => {
    editor?.setValue(event.detail.value)
    editor?.setReadOnly(event.detail.readOnly)
  }
  sourceElement.addEventListener('irisout:editor-state', syncEditor)

  void import('./playground/monaco-editor.js')
    .then(({ createSourceEditor }) =>
      createSourceEditor(monacoElement, {
        value: sourceElement.value,
        readOnly: sourceElement.readOnly,
        onChange(value) {
          if (sourceElement.value === value) return
          sourceElement.value = value
          sourceElement.dispatchEvent(new Event('input', { bubbles: true }))
        },
      }),
    )
    .then((createdEditor) => {
      editor = createdEditor
      editor.setValue(sourceElement.value)
      editor.setReadOnly(sourceElement.readOnly)
      sourceElement.hidden = true
    })
    .catch(() => {
      monacoElement.hidden = true
    })

  window.addEventListener(
    'pagehide',
    () => {
      sourceElement.removeEventListener('irisout:editor-state', syncEditor)
      editor?.dispose()
    },
    { once: true },
  )
}
