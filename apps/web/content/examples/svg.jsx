// 公式文書とPlaygroundが共有するSVG入力。
import { render } from 'irisout'

export function SvgExample() {
  render(
    <main>
      <h1>SVG</h1>
      <svg viewBox="0 0 40 40" role="img" aria-label="円">
        <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" />
      </svg>
    </main>,
  )
}
