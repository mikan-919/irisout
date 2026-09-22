// 共有レイアウトの形状変形と、内容のぼかし交差フェードを組み合わせる。
// Motion拡張の対応範囲に合わせ、退場BCFだけWeb Animations APIで補う。
import { render, signal } from 'irisout'
import { motion } from 'irisout/motion'
import { SiteHeader } from '../../../src/SiteHeader.jsx'

export function MorphBcf() {
  const cards = signal([
    {
      id: 'focus',
      kicker: 'Interaction 01',
      title: 'Focus Shift',
      meta: 'React + Motion',
      copy: '外枠は Motion の layoutId で変形します。内容だけを別速度の blur crossfade で切り替えます。',
    },
    {
      id: 'context',
      kicker: 'Interaction 02',
      title: 'Context',
      meta: 'Shared layout',
      copy: '開閉の両方で同じ layoutId を共有するため、カードと詳細画面の位置・大きさを Motion が補間します。',
    },
    {
      id: 'quiet',
      kicker: 'Interaction 03',
      title: 'Quiet Motion',
      meta: '300 ms / 900 ms',
      copy: 'morph を短く、BCF を長くすると、形状が先に決まり、そのあと焦点だけが移る動きになります。',
    },
  ])
  const selected = signal(null)
  const morphMs = signal(300)
  const bcfMs = signal(900)

  render(
    <div>
      <SiteHeader current="examples" search={false} onSearch={null} />
      <main class="morph-page">
        <section class="stage" aria-label="MorphとBCFの操作例">
          <div class="grid">
            {cards().map((item) => (
              <motion.article
                class="card"
                key={item.id}
                layoutId={`card-${item.id}`}
                transition={{ duration: morphMs() / 1000, ease: [0.22, 0.72, 0.2, 1] }}
              >
                <button
                  class="card-button"
                  type="button"
                  aria-label={`${item.title}を開く`}
                  onClick={() => selected(item)}
                >
                  <motion.div
                    class="compact-content"
                    animate={
                      selected()?.id === item.id
                        ? { opacity: 0, filter: 'blur(12px)', scale: 0.985 }
                        : { opacity: 1, filter: 'blur(0px)', scale: 1 }
                    }
                    transition={{ duration: bcfMs() / 1000, ease: [0.22, 0.72, 0.2, 1] }}
                  >
                    <span class="kicker">{item.kicker}</span>
                    <span>
                      <strong class="title">{item.title}</strong>
                      <small class="meta">{item.meta}</small>
                    </span>
                  </motion.div>
                </button>
              </motion.article>
            ))}
          </div>

          {selected() && (
            <div class="overlay">
              <motion.article
                class="expanded-shell"
                layoutId={`card-${selected().id}`}
                transition={{ duration: morphMs() / 1000, ease: [0.22, 0.72, 0.2, 1] }}
              >
                <motion.div
                  class="detail-content"
                  initial={{ opacity: 0, filter: 'blur(14px)', y: 8, scale: 0.992 }}
                  animate={{ opacity: 1, filter: 'blur(0px)', y: 0, scale: 1 }}
                  transition={{ duration: bcfMs() / 1000, ease: [0.22, 0.72, 0.2, 1] }}
                >
                  <div class="detail-top">
                    <div>
                      <span class="kicker">{selected().kicker}</span>
                      <h1>{selected().title}</h1>
                    </div>
                    <button
                      class="close"
                      type="button"
                      aria-label="詳細を閉じる"
                      onClick={closeDetail}
                    >
                      ×
                    </button>
                  </div>
                  <div class="detail-copy">
                    <p>{selected().copy}</p>
                    <p>morph は位置と形状、BCF は内容の焦点移動を担当します。</p>
                  </div>
                  <div class="detail-bottom">
                    <span class="pill">Morph / layoutId</span>
                    <span class="pill">Blur Crossfade</span>
                  </div>
                </motion.div>
              </motion.article>
            </div>
          )}

          <div class="controls">
            <label>
              <span>Morph</span>
              <input
                type="range"
                min="120"
                max="1200"
                step="20"
                value={morphMs()}
                onInput={(event) => morphMs(Number(event.currentTarget.value))}
              />
              <output>{morphMs()} ms</output>
            </label>
            <label>
              <span>BCF</span>
              <input
                type="range"
                min="200"
                max="1800"
                step="50"
                value={bcfMs()}
                onInput={(event) => bcfMs(Number(event.currentTarget.value))}
              />
              <output>{bcfMs()} ms</output>
            </label>
          </div>
        </section>
      </main>
    </div>,
  )

  function closeDetail(event) {
    const shell = event.currentTarget.closest('.expanded-shell')
    const detail = /** @type {HTMLElement | null} */ (shell?.querySelector('.detail-content'))
    const stage = shell?.closest('.stage')
    if (detail && stage) {
      // Motion拡張はexitを持たないため、退場完了まで表示内容だけを保持する。
      const exiting = /** @type {HTMLElement} */ (detail.cloneNode(true))
      exiting.classList.add('exit-detail')
      exiting.inert = true
      exiting.setAttribute('aria-hidden', 'true')
      stage.append(exiting)
      const exitAnimation = exiting.animate(
        [
          { opacity: 1, filter: 'blur(0px)', transform: 'translateY(0) scale(1)' },
          { opacity: 0, filter: 'blur(14px)', transform: 'translateY(8px) scale(.992)' },
        ],
        {
          duration: bcfMs(),
          easing: 'cubic-bezier(.22,.72,.2,1)',
          fill: 'forwards',
        },
      )
      void exitAnimation.finished.then(() => exiting.remove())
    }
    selected(null)
  }
}
