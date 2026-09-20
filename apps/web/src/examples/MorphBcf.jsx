// 共有レイアウトの形状変形と、内容のぼかし交差フェードを組み合わせる。
// Motion拡張の対応範囲に合わせ、exitではなく条件分岐とinitial/animateを使う。
import { render, signal } from 'irisout'
import { motion } from 'irisout/motion'

export function MorphBcf() {
  const cards = signal([
    {
      id: 'focus',
      kicker: 'Interaction 01',
      title: 'Focus Shift',
      meta: 'irisout + Motion',
      copy: '外枠はlayoutIdで変形します。内容は別速度のぼかし交差フェードで切り替えます。',
    },
    {
      id: 'context',
      kicker: 'Interaction 02',
      title: 'Context',
      meta: 'Shared layout',
      copy: '開閉で同じlayoutIdを共有し、カードと詳細画面の位置と大きさを補間します。',
    },
    {
      id: 'quiet',
      kicker: 'Interaction 03',
      title: 'Quiet Motion',
      meta: '300 ms / 900 ms',
      copy: '形状変形を短く、BCFを長くすると、形状が先に決まり、焦点があとから移ります。',
    },
  ])
  const selected = signal(null)
  const morphMs = signal(300)
  const bcfMs = signal(900)

  render(
    <main class="morph-page">
      <a class="back-link" href="/examples">
        ← 実例一覧
      </a>
      <section class="stage" aria-label="MorphとBCFの操作例">
        <div class="grid">
          {cards().map((item) => (
            <motion.article
              class="card"
              key={item.id}
              layoutId={`card-${item.id}`}
              transition={{ duration: morphMs() / 1000 }}
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
                  transition={{ duration: bcfMs() / 1000 }}
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
              transition={{ duration: morphMs() / 1000 }}
            >
              <motion.div
                class="detail-content"
                initial={{ opacity: 0, filter: 'blur(14px)', y: 8, scale: 0.992 }}
                animate={{ opacity: 1, filter: 'blur(0px)', y: 0, scale: 1 }}
                transition={{ duration: bcfMs() / 1000 }}
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
                    onClick={() => selected(null)}
                  >
                    ×
                  </button>
                </div>
                <div class="detail-copy">
                  <p>{selected().copy}</p>
                  <p>形状変形は位置と寸法、BCFは内容の焦点移動を担当します。</p>
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
    </main>,
  )
}
