// Monacoは編集画面でだけ遅延読込みし、投稿sourceの実行には使わない。

import * as monaco from 'monaco-editor/editor/editor.api.js'
import {
  javascriptDefaults,
  JsxEmit,
  ScriptTarget,
} from 'monaco-editor/language/typescript/monaco.contribution.js'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import TypeScriptWorker from 'monaco-editor/language/typescript/ts.worker.js?worker'

self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    return label === 'typescript' || label === 'javascript'
      ? new TypeScriptWorker()
      : new EditorWorker()
  },
}

javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSuggestionDiagnostics: true,
})
javascriptDefaults.setCompilerOptions({
  allowNonTsExtensions: true,
  jsx: JsxEmit.Preserve,
  target: ScriptTarget.ESNext,
})

export function createSourceEditor(container, { value, readOnly, onChange }) {
  container.hidden = false
  const model = monaco.editor.createModel(
    value,
    'javascript',
    monaco.Uri.parse('file:///playground.jsx'),
  )
  const editor = monaco.editor.create(container, {
    model,
    theme: 'vs-dark',
    automaticLayout: true,
    readOnly,
    ariaLabel: '入力JSX',
    fontSize: 13,
    lineHeight: 21,
    minimap: { enabled: false },
    padding: { top: 12, bottom: 12 },
    scrollBeyondLastLine: false,
    tabSize: 2,
    insertSpaces: true,
    wordWrap: 'on',
  })
  const change = editor.onDidChangeModelContent(() => onChange(editor.getValue()))

  return {
    setValue(next) {
      if (editor.getValue() !== next) editor.setValue(next)
    },
    setReadOnly(next) {
      editor.updateOptions({ readOnly: next })
    },
    dispose() {
      change.dispose()
      editor.dispose()
      model.dispose()
    },
  }
}
