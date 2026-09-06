import { Suzume } from '@libraz/suzume'
import suzumeWasmUrl from '@libraz/suzume/wasm?url'

let analyzer
let dictionaryTerms = []

self.onmessage = (event) => {
  const message = event.data
  if (message?.type === 'initialize') {
    dictionaryTerms = Array.isArray(message.terms) ? message.terms : []
    Suzume.create({ wasmPath: suzumeWasmUrl })
      .then((nextAnalyzer) => {
        analyzer = nextAnalyzer
        self.postMessage({ type: 'ready', dictionaryTermCount: dictionaryTerms.length })
      })
      .catch((error) => {
        self.postMessage({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      })
    return
  }
  if (message?.type === 'dispose') {
    analyzer?.destroy()
    analyzer = undefined
    self.close()
    return
  }
  if (message?.type !== 'analyze') return
  const requestId = message.requestId
  if (!analyzer) {
    self.postMessage({ type: 'error', requestId, message: 'analyzer is not ready' })
    return
  }
  try {
    const source = String(message.source ?? '')
    const startedAt = performance.now()
    const tokens = analyzer.analyze(source)
    const elapsedMs = performance.now() - startedAt
    const dictionaryHits = dictionaryTerms.filter((term) => source.includes(term)).length
    self.postMessage({
      type: 'result',
      requestId,
      tokenCount: tokens.length,
      dictionaryHits,
      elapsedMs,
    })
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
