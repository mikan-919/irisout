// Worker、辞書URL、要求番号の管理を画面から分離する。最新要求だけを採用し、
// 画面破棄時に購読とWorkerを解放する。解析指標の定義はWorker側の結果を受ける。

export function startHeatmapAnalysis({
  textarea,
  Worker,
  dictionaryUrl,
  getSource,
  onStatus,
  onResult,
}) {
  const worker = new Worker()
  let disposed = false
  let workerReady = false
  let composing = false
  let requestId = 0
  let latestRequestId = 0

  const canAnalyze = (source) => {
    const paragraphCount = source.split(/\n\s*\n/).length
    return source.length <= 25_000 && paragraphCount <= 300
  }

  const requestAnalysis = () => {
    if (disposed || composing || !workerReady) return
    const source = getSource()
    if (!canAnalyze(source)) {
      onStatus('解析対象が上限を超えています')
      return
    }
    const nextRequestId = ++requestId
    latestRequestId = nextRequestId
    onStatus('解析中')
    worker.postMessage({ type: 'analyze', requestId: nextRequestId, source })
  }

  const onWorkerMessage = (event) => {
    if (disposed) return
    if (event.data?.type === 'ready') {
      workerReady = true
      onStatus('解析準備完了')
      requestAnalysis()
    } else if (event.data?.type === 'result' && event.data.requestId === latestRequestId) {
      onResult(event.data)
      onStatus(`解析完了 (${event.data.elapsedMs.toFixed(2)}ms)`)
    } else if (
      event.data?.type === 'error' &&
      (event.data.requestId == null || event.data.requestId === latestRequestId)
    ) {
      onStatus('解析に失敗')
    }
  }
  const onWorkerError = () => {
    if (!disposed) onStatus('解析に失敗')
  }
  const onInput = () => requestAnalysis()
  const onCompositionStart = () => {
    composing = true
  }
  const onCompositionEnd = () => {
    composing = false
    requestAnalysis()
  }
  worker.addEventListener('message', onWorkerMessage)
  worker.addEventListener('error', onWorkerError)
  textarea?.addEventListener('input', onInput)
  textarea?.addEventListener('compositionstart', onCompositionStart)
  textarea?.addEventListener('compositionend', onCompositionEnd)
  fetch(dictionaryUrl)
    .then((response) => response.json())
    .then((dictionary) => {
      if (!disposed) worker.postMessage({ type: 'initialize', terms: dictionary.terms })
    })
    .catch(() => {
      if (!disposed) onStatus('解析資源の読み込みに失敗')
    })

  return () => {
    disposed = true
    worker.removeEventListener('message', onWorkerMessage)
    worker.removeEventListener('error', onWorkerError)
    textarea?.removeEventListener('input', onInput)
    textarea?.removeEventListener('compositionstart', onCompositionStart)
    textarea?.removeEventListener('compositionend', onCompositionEnd)
    worker.postMessage({ type: 'dispose' })
    worker.terminate()
  }
}
