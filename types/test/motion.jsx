import { render } from 'irisout'
import { motion } from 'irisout/motion'

export function MotionExample() {
  render(
    <motion.div layout animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }}>
      Motion
    </motion.div>,
  )
  render(<motion.div layoutId="selected-item" />)

  // @ts-expect-error 未対応のMotion属性は通常属性へ降格させない。
  render(<motion.div whileHover={{ scale: 1.1 }} />)
  // @ts-expect-error 未知の属性名はMotion要素で受理しない。
  render(<motion.div animte={{ opacity: 1 }} />)
}
