import { render, signal } from 'irisout'
import { AnimatePresence, motion } from 'irisout/motion'

export function MotionLayout() {
  const expanded = signal(false)
  const reversed = signal(false)
  const detail = signal(false)
  const visible = signal(true)
  const presenceItems = signal(['x', 'y'])

  render(
    <main>
      <button id="resize" onClick={() => expanded(!expanded())}>
        寸法変更
      </button>
      <button id="reorder" onClick={() => reversed(!reversed())}>
        並べ替え
      </button>
      <button id="shared" onClick={() => detail(!detail())}>
        共有要素
      </button>
      <button id="exit-conditional" onClick={() => visible(false)}>
        条件分岐から削除
      </button>
      <button id="presence-reorder" onClick={() => presenceItems(['y', 'x'])}>
        退場対象の並べ替え
      </button>
      <button id="exit-list" onClick={() => presenceItems(['z', 'y'])}>
        一覧から削除
      </button>
      <AnimatePresence>
        {visible() && (
          <motion.div id="exit-card" exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
            退場する要素
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {presenceItems().map((item) => (
          <motion.div
            key={item}
            data-presence-item={item}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            {item}
          </motion.div>
        ))}
      </AnimatePresence>
      <motion.section
        id="parent"
        layout
        transition={{ duration: 0.8 }}
        style={`width:${expanded() ? 420 : 260}px;padding:16px;background:#eef2ff`}
      >
        <motion.div
          id="child"
          layout
          transition={{ duration: 0.8 }}
          style="width:80px;height:40px;border-radius:12px;background:#4f46e5"
        />
      </motion.section>
      <motion.div
        id="scroll-region"
        layout
        layoutScroll
        style="width:140px;overflow:auto;margin-top:24px"
      >
        <div id="list" style="display:flex;gap:12px;width:220px">
          {(reversed() ? ['c', 'b', 'a'] : ['a', 'b', 'c']).map((item) => (
            <motion.div
              key={item}
              layout
              transition={{ duration: 0.8 }}
              data-item={item}
              style="width:48px;height:48px;flex:none;background:#0f766e;color:white"
            >
              {item}
            </motion.div>
          ))}
        </div>
      </motion.div>
      {detail() ? (
        <motion.div
          id="detail-card"
          layoutId="card"
          transition={{ duration: 0.8 }}
          style="position:absolute;left:360px;top:220px;width:240px;height:160px;border-radius:24px;background:#be123c"
        />
      ) : (
        <motion.div
          id="summary-card"
          layoutId="card"
          transition={{ duration: 0.8 }}
          style="position:absolute;left:40px;top:220px;width:100px;height:70px;border-radius:10px;background:#be123c"
        />
      )}
    </main>,
  )
}
