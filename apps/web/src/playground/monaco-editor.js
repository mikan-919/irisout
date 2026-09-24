// Monacoは編集画面でだけ遅延読込みし、投稿sourceの実行には使わない。

import * as monaco from 'monaco-editor/editor/editor.api.js'
import { language as typescriptLanguage } from 'monaco-editor/languages/definitions/typescript/typescript.js'
import 'monaco-editor/languages/definitions/typescript/register.js'
import {
  typescriptDefaults,
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

typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSuggestionDiagnostics: true,
})
typescriptDefaults.setCompilerOptions({
  allowNonTsExtensions: true,
  jsx: JsxEmit.Preserve,
  target: ScriptTarget.ESNext,
})

// 標準のTypeScript定義を保ち、Playgroundに必要なJSXのタグと属性だけを追加する。
// 型検査は無効のまま、同じTypeScript作業スレッドで構文だけを色分けする。
monaco.languages.setMonarchTokensProvider('typescript', {
  ...typescriptLanguage,
  tokenizer: {
    ...typescriptLanguage.tokenizer,
    common: [
      [/(<\/?)([A-Za-z][\w.-]*)(?=[\s/>])/, ['delimiter', { token: 'tag', next: '@jsxTag' }]],
      ...typescriptLanguage.tokenizer.common,
    ],
    jsxTag: [
      [/[ \t\r\n]+/, ''],
      [/\{/, { token: 'delimiter.bracket', next: '@jsxExpression' }],
      [/\/>/, { token: 'tag', next: '@pop' }],
      [/>/, { token: 'delimiter', next: '@pop' }],
      [/"/, 'string', '@string_double'],
      [/'/, 'string', '@string_single'],
      [/[A-Za-z_:][\w:.-]*/, 'attribute.name'],
      [/=/, 'delimiter'],
      [/[^\s/>=]+/, 'attribute.name'],
    ],
    jsxExpression: [
      [/\{/, 'delimiter.bracket', '@jsxExpression'],
      [/\}/, 'delimiter.bracket', '@pop'],
      { include: '@common' },
    ],
  },
})

export async function createSourceEditor(container, { value, readOnly, onChange }) {
  // 言語機能の失敗をtextareaを隠す前に検出し、client.jsの退避処理へ渡す。
  await import('monaco-editor/languages/features/typescript/tsMode.js')
  container.hidden = false
  const model = monaco.editor.createModel(
    value,
    'typescript',
    monaco.Uri.parse('file:///playground.tsx'),
  )
  monaco.editor.defineTheme('irisout-playground', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: { 'editor.background': '#111210' },
  })
  const editor = monaco.editor.create(container, {
    model,
    theme: 'irisout-playground',
    automaticLayout: true,
    readOnly,
    ariaLabel: '入力TypeScriptとJSX',
    fontSize: 13,
    lineHeight: 21,
    minimap: { enabled: false },
    lineNumbers: 'off',
    lineDecorationsWidth: 20,
    glyphMargin: false,
    folding: false,
    padding: { top: 12, bottom: 12 },
    scrollBeyondLastLine: false,
    tabFocusMode: true,
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
