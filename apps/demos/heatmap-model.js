// ヒートマップの入力分割と指標計算を保持する。文章の意味を判定する処理は
// 利用例の責務であり、compiler/runtimeへ組み込まない。

export const HEATMAP_LIMITS = Object.freeze({
  paragraphs: 300,
  characters: 25_000,
})

export function splitParagraphs(source) {
  return source.split(/\n\s*\n/).map((text, index) => ({ id: index + 1, text }))
}

export function metricLabel(metric) {
  if (metric === 'number') return '数値の割合'
  if (metric === 'tokens') return '解析語数'
  return '段落の長さ'
}

export function scoreParagraphs(paragraphs, metric, analysisResults) {
  return paragraphs.map((paragraph) => {
    const analysis = analysisResults?.[paragraph.id]
    const score =
      metric === 'number'
        ? (paragraph.text.match(/[0-9０-９]+/g) ?? []).length / Math.max(1, paragraph.text.length)
        : metric === 'tokens'
          ? (analysis?.tokenCount ?? 0)
          : paragraph.text.length
    return {
      ...paragraph,
      score,
      reason:
        metric === 'number'
          ? '数字の出現数を文字数で割った値'
          : metric === 'tokens'
            ? (analysis?.reason ?? 'Workerの解析結果を待っています')
            : '空白を含む段落の文字数',
    }
  })
}

export function isWithinHeatmapLimits(source) {
  const paragraphs = splitParagraphs(source)
  return (
    source.length <= HEATMAP_LIMITS.characters && paragraphs.length <= HEATMAP_LIMITS.paragraphs
  )
}
