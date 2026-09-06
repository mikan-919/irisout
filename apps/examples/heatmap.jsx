import analysisDictionaryUrl from './heatmap-dictionary.json?url'
import HeatmapWorker from './heatmap.worker.js?worker'
import './heatmap.css'

// 日本語と記号を含む本文を、段落ごとの指標へ変換して表示する代表例。
// 指標の定義はこのファイルに置き、compilerやruntimeは文章の意味を判定しない。

export function HeatmapApp() {
  const source = signal(
    '概要: irisout は本文を段落へ分けて表示します。\n\n数値 42 と記号 # を含む段落です。\n\n最後の段落では同じ語をもう一度読みます。',
  )
  const metric = signal('length')
  const selectedId = signal(1)
  const analysisStatus = signal('解析資源を準備中')
  const tokenCount = signal(0)
  const paragraphs = derived(() =>
    source()
      .split(/\n\s*\n/)
      .map((text, index) => ({ id: index + 1, text })),
  )
  const scores = derived(() =>
    paragraphs().map((paragraph) => ({
      ...paragraph,
      score:
        metric() === 'length'
          ? paragraph.text.length
          : (paragraph.text.match(/[0-9０-９]+/g) ?? []).length /
            Math.max(1, paragraph.text.length),
    })),
  )
  const selectedParagraph = derived(() =>
    scores().find((paragraph) => paragraph.id === selectedId()),
  )

  render(
    <main class="heatmap-app">
      <h1>情報量ヒートマップ</h1>
      <label>
        本文
        <textarea value={source()} onInput={(event) => source(event.currentTarget.value)} />
      </label>

      <section class="metric-controls">
        <h2>指標</h2>
        <button
          type="button"
          class={metric() === 'length' ? 'active' : ''}
          onClick={() => metric('length')}
        >
          段落の長さ
        </button>
        <button
          type="button"
          class={metric() === 'number' ? 'active' : ''}
          onClick={() => metric('number')}
        >
          数値の割合
        </button>
      </section>

      <p class="selection">
        選択中: {selectedParagraph() ? `第${selectedParagraph().id}段落` : 'なし'}
      </p>
      <p class="analysis-status" aria-live="polite">
        {analysisStatus()} / 単語数 {tokenCount()}
      </p>

      <nav class="overview" aria-label="段落の全体地図">
        <h2>全体地図</h2>
        {scores().map((paragraph) => (
          <a
            key={paragraph.id}
            href={`#paragraph-${paragraph.id}`}
            class={selectedId() === paragraph.id ? 'selected' : ''}
            style={`--heat: ${metric() === 'length' ? paragraph.score : paragraph.score * 100}%`}
            onClick={(event) => {
              event.preventDefault()
              selectedId(paragraph.id)
            }}
          >
            {paragraph.id}
          </a>
        ))}
      </nav>

      <section class="paragraph-list">
        <h2>段落一覧</h2>
        {scores().map((paragraph) => (
          <ParagraphRow
            key={paragraph.id}
            paragraph={paragraph}
            paragraphCount={scores().length}
            metric={metric()}
            selectedId={selectedId}
          />
        ))}
      </section>

      <section class="detail-panel">
        {selectedParagraph() ? (
          <Detail paragraph={selectedParagraph()} metric={metric()} />
        ) : (
          <p>段落を選択してください。</p>
        )}
      </section>
    </main>,
  )

  onMount(() => {
    const worker = new HeatmapWorker()
    let disposed = false
    let workerReady = false
    let composing = false
    let requestId = 0
    let latestRequestId = 0
    const onWorkerMessage = (event) => {
      if (!disposed) {
        if (event.data?.type === 'ready') {
          workerReady = true
          analysisStatus('解析準備完了')
          const nextRequestId = ++requestId
          latestRequestId = nextRequestId
          analysisStatus('解析中')
          worker.postMessage({ type: 'analyze', requestId: nextRequestId, source: source() })
        } else if (event.data?.type === 'result' && event.data.requestId === latestRequestId) {
          tokenCount(event.data.tokenCount)
          analysisStatus(`解析完了 (${event.data.elapsedMs.toFixed(2)}ms)`)
        } else if (
          event.data?.type === 'error' &&
          (event.data.requestId == null || event.data.requestId === latestRequestId)
        ) {
          analysisStatus('解析に失敗')
        }
      }
    }
    const onWorkerError = () => {
      if (!disposed) analysisStatus('解析に失敗')
    }
    const textarea = globalThis.document?.querySelector('.heatmap-app textarea')
    const onInput = () => {
      if (composing || !workerReady) return
      const nextRequestId = ++requestId
      latestRequestId = nextRequestId
      analysisStatus('解析中')
      worker.postMessage({ type: 'analyze', requestId: nextRequestId, source: source() })
    }
    const onCompositionStart = () => {
      composing = true
    }
    const onCompositionEnd = () => {
      composing = false
      if (!workerReady) return
      const nextRequestId = ++requestId
      latestRequestId = nextRequestId
      analysisStatus('解析中')
      worker.postMessage({ type: 'analyze', requestId: nextRequestId, source: source() })
    }
    worker.addEventListener('message', onWorkerMessage)
    worker.addEventListener('error', onWorkerError)
    textarea?.addEventListener('input', onInput)
    textarea?.addEventListener('compositionstart', onCompositionStart)
    textarea?.addEventListener('compositionend', onCompositionEnd)
    fetch(analysisDictionaryUrl)
      .then((response) => response.json())
      .then((dictionary) => {
        if (disposed) return
        worker.postMessage({ type: 'initialize', terms: dictionary.terms })
      })
      .catch(() => {
        if (!disposed) analysisStatus('解析資源の読み込みに失敗')
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
  })
}

function ParagraphRow({ paragraph, paragraphCount, metric, selectedId }) {
  render(
    <article
      key={paragraph.id}
      id={`paragraph-${paragraph.id}`}
      class={selectedId() === paragraph.id ? 'selected' : ''}
      tabIndex="0"
      aria-selected={selectedId() === paragraph.id ? 'true' : 'false'}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
          event.preventDefault()
          if (paragraph.id < paragraphCount) selectedId(paragraph.id + 1)
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
          event.preventDefault()
          if (paragraph.id > 1) selectedId(paragraph.id - 1)
        }
      }}
    >
      <h3>第{paragraph.id}段落</h3>
      <p>{paragraph.text}</p>
      <p class="paragraph-score">
        {metric === 'length' ? '文字数' : '数値の割合'}: {paragraph.score}
      </p>
      <button type="button" onClick={() => selectedId(paragraph.id)}>
        この段落を選ぶ
      </button>
    </article>,
  )
}

function Detail({ paragraph, metric }) {
  const reasonOpen = signal(true)

  render(
    <aside class="detail">
      <h2>選択した段落</h2>
      <p>{paragraph.text}</p>
      <p class="score">
        {metric === 'length' ? '文字数' : '数値の割合'}: {paragraph.score}
      </p>
      <button type="button" onClick={() => reasonOpen(!reasonOpen())}>
        {reasonOpen() ? '理由を隠す' : '色の理由を表示'}
      </button>
      {reasonOpen() ? (
        <p class="reason">この色は選択した指標の値から計算しています。</p>
      ) : (
        <p class="reason">理由を表示すると指標の説明を確認できます。</p>
      )}
    </aside>,
  )
}
