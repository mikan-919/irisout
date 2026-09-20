// BCFによるラベルの交差フェードを、irisoutの状態更新とWeb Animations APIで示す。
// クリップボード操作は含めず、ボタン表示の切り替えだけを扱う。
import { render, signal } from 'irisout'

export function BcfCopyButton() {
  const copied = signal(false)
  const animating = signal(false)
  const duration = signal(400)

  render(
    <main class="demo">
      <a class="back-link" href="/examples">
        ← 実例一覧
      </a>
      <section class="demo-card" aria-labelledby="demo-title">
        <div class="demo-heading">
          <p>INTERACTION EXAMPLE</p>
          <h1 id="demo-title">BCF Copy Button</h1>
          <span>ぼかしを使った交差フェード</span>
        </div>

        <div class="demo-stage">
          <button
            class="bcf-button"
            type="button"
            disabled={animating()}
            aria-label={copied() ? '表示をCopyへ戻す' : '表示をCopiedへ切り替える'}
            onClick={toggleLabel}
          >
            <span class="label-layer copy-label" data-label="copy">
              Copy
            </span>
            <span class="label-layer copied-label" data-label="copied">
              Copied
            </span>
          </button>

          <label class="controls">
            <span>BCF</span>
            <input
              type="range"
              min="150"
              max="1000"
              step="25"
              value={duration()}
              aria-label="交差フェードの時間"
              onInput={(event) => duration(Number(event.currentTarget.value))}
            />
            <output>{duration()} ms</output>
          </label>

          <p class="note">押すたびに Copy ⇄ Copied</p>
        </div>
      </section>
    </main>,
  )

  async function toggleLabel(event) {
    if (animating()) return
    const button = event.currentTarget
    const copyLabel = /** @type {HTMLElement | null} */ (
      button.querySelector('[data-label="copy"]')
    )
    const copiedLabel = /** @type {HTMLElement | null} */ (
      button.querySelector('[data-label="copied"]')
    )
    const from = copied() ? copiedLabel : copyLabel
    const to = copied() ? copyLabel : copiedLabel
    if (!from || !to) return

    animating(true)

    from.style.zIndex = '2'
    to.style.zIndex = '1'
    const animationDuration = matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 1
      : duration()
    const outgoing = from.animate(
      [
        { opacity: 1, filter: 'blur(0px)', transform: 'scale(1)' },
        { opacity: 0, filter: 'blur(9px)', transform: 'scale(.985)' },
      ],
      {
        duration: animationDuration,
        easing: 'cubic-bezier(.22,.72,.2,1)',
        fill: 'forwards',
      },
    )
    const incoming = to.animate(
      [
        { opacity: 0, filter: 'blur(9px)', transform: 'scale(1.015)' },
        { opacity: 1, filter: 'blur(0px)', transform: 'scale(1)' },
      ],
      {
        duration: animationDuration,
        easing: 'cubic-bezier(.22,.72,.2,1)',
        fill: 'forwards',
      },
    )

    await Promise.all([outgoing.finished, incoming.finished])
    outgoing.cancel()
    incoming.cancel()
    from.style.opacity = '0'
    from.style.filter = 'blur(9px)'
    from.style.transform = 'scale(.985)'
    from.style.zIndex = ''
    to.style.opacity = '1'
    to.style.filter = 'blur(0px)'
    to.style.transform = 'scale(1)'
    to.style.zIndex = ''
    copied(!copied())
    animating(false)
  }
}
