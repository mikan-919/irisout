// ヒートマップの段落行と詳細表示を担当する。状態は各componentのfactoryへ閉じ、
// 親の選択状態と指標はpropsの式置換で受け取る。

import { metricLabel } from './heatmap-model.js'

export function ParagraphRow({ paragraph, paragraphCount, metric, selectedId }) {
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
        {metricLabel(metric)}: {paragraph.score}
      </p>
      <p class="paragraph-reason">理由: {paragraph.reason}</p>
      <button type="button" onClick={() => selectedId(paragraph.id)}>
        この段落を選ぶ
      </button>
    </article>,
  )
}

export function Detail({ paragraph, metric }) {
  const reasonOpen = signal(true)

  render(
    <aside class="detail">
      <h2>選択した段落</h2>
      <p>{paragraph.text}</p>
      <p class="score">
        {metricLabel(metric)}: {paragraph.score}
      </p>
      <button type="button" onClick={() => reasonOpen(!reasonOpen())}>
        {reasonOpen() ? '理由を隠す' : '色の理由を表示'}
      </button>
      {reasonOpen() ? (
        <p class="reason">{paragraph.reason}</p>
      ) : (
        <p class="reason">理由を表示すると指標の説明を確認できます。</p>
      )}
    </aside>,
  )
}
