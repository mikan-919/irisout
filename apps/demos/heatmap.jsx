import analysisDictionaryUrl from './heatmap-dictionary.json?url'
import HeatmapWorker from './heatmap.worker.js?worker'
import './heatmap.css'
import { Detail, ParagraphRow } from './heatmap-components.jsx'
import { HEATMAP_LIMITS, scoreParagraphs, splitParagraphs } from './heatmap-model.js'
import { startHeatmapAnalysis } from './heatmap-worker-client.js'

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
  const analysisResults = signal({})
  const paragraphs = derived(() => splitParagraphs(source()))
  const scores = derived(() => scoreParagraphs(paragraphs(), metric(), analysisResults()))
  const selectedParagraph = derived(() =>
    scores().find((paragraph) => paragraph.id === selectedId()),
  )

  render(
    <main class="heatmap-app">
      <h1>情報量ヒートマップ</h1>
      <label>
        本文
        <textarea
          use={setupHeatmapAnalysis}
          value={source()}
          onInput={(event) => source(event.currentTarget.value)}
        />
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
        <button
          type="button"
          class={metric() === 'tokens' ? 'active' : ''}
          onClick={() => metric('tokens')}
        >
          解析語数
        </button>
      </section>

      <p class="selection">
        選択中: {selectedParagraph() ? `第${selectedParagraph().id}段落` : 'なし'}
      </p>
      <p class="analysis-status" aria-live="polite">
        {analysisStatus()} / 単語数 {tokenCount()} / 上限 {HEATMAP_LIMITS.paragraphs}段落・
        {HEATMAP_LIMITS.characters}文字
      </p>

      <nav class="overview" aria-label="段落の全体地図">
        <h2>全体地図</h2>
        {scores().map((paragraph) => (
          <a
            key={paragraph.id}
            href={`#paragraph-${paragraph.id}`}
            class={selectedId() === paragraph.id ? 'selected' : ''}
            style={`--heat: ${metric() === 'number' ? paragraph.score * 100 : paragraph.score}%`}
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

  function setupHeatmapAnalysis(textarea) {
    const cleanup = startHeatmapAnalysis({
      textarea,
      Worker: HeatmapWorker,
      dictionaryUrl: analysisDictionaryUrl,
      getSource: () => source(),
      onStatus: (status) => analysisStatus(status),
      onResult: (result) => {
        tokenCount(result.tokenCount)
        analysisResults(
          Object.fromEntries(
            (result.paragraphs ?? []).map((paragraph) => [paragraph.id, paragraph]),
          ),
        )
      },
    })
    return {
      destroy() {
        cleanup()
      },
    }
  }
}
