// Motion JSXの作者APIとブラウザ実行時処理。
// 変換器は`irisout/motion/vite`へ分離し、ここへBabel依存を含めない。

import { animate } from 'motion'
import { registerProjectionElement } from './projection.js'

export type MotionTarget = Record<string, unknown>
export type MotionTransition = Record<string, unknown>
export type MotionLayout = boolean | 'position' | 'size' | 'preserve-aspect'

export interface MotionElementOptions {
  layout?: MotionLayout
  layoutId?: string
  layoutScroll?: boolean
  layoutRoot?: boolean
  layoutCrossfade?: boolean
  initial?: MotionTarget | false
  transition?: MotionTransition
}

export interface MotionElementController {
  update(target: MotionTarget | undefined, transition?: MotionTransition): void
  destroy(): void
}

export function mountMotionElement(
  element: Element,
  options: MotionElementOptions,
): MotionElementController {
  let animation: ReturnType<typeof animate> | null = null
  const transition = options.transition
  const unregisterProjection =
    options.layout || options.layoutId ? registerProjectionElement(element, options) : null
  if (options.initial !== false && options.initial) {
    animate(element, options.initial, { ...transition, duration: 0 }).complete()
  }
  return {
    update(target, nextTransition = transition) {
      animation?.stop()
      if (target) animation = animate(element, target, nextTransition)
    },
    destroy() {
      unregisterProjection?.()
      animation?.stop()
      animation = null
    },
  }
}

// JSXではコンパイル前変換が参照し、ブラウザ実行時には残らない。
export const motion = Object.create(null) as MotionElements

type UnsupportedMotionProps = {
  [
    K in
      | 'drag'
      | 'dragConstraints'
      | 'exit'
      | 'variants'
      | 'whileDrag'
      | 'whileFocus'
      | 'whileHover'
      | 'whileInView'
      | 'whileTap'
  ]?: never
}

type MotionProps = {
  layout?: MotionLayout
  layoutId?: string
  layoutScroll?: boolean
  layoutRoot?: boolean
  layoutCrossfade?: boolean
  initial?: MotionTarget | false
  animate?: MotionTarget
  transition?: MotionTransition
} & UnsupportedMotionProps

type MotionHostProps = MotionProps & {
  children?: unknown
  id?: unknown
  class?: unknown
  className?: unknown
  style?: unknown
  title?: unknown
  role?: unknown
  tabIndex?: unknown
  hidden?: unknown
  disabled?: unknown
  checked?: unknown
  value?: unknown
  type?: unknown
  name?: unknown
  href?: unknown
  src?: unknown
  alt?: unknown
  width?: unknown
  height?: unknown
  viewBox?: unknown
  fill?: unknown
  stroke?: unknown
  d?: unknown
  cx?: unknown
  cy?: unknown
  r?: unknown
  [handler: `on${string}`]: ((event: any) => void) | undefined
} & { [attribute in `data-${string}`]?: unknown } & {
  [attribute in `aria-${string}`]?: unknown
}
type MotionElementFactory = (props: MotionHostProps) => any
type MotionElements = {
  [K in keyof HTMLElementTagNameMap]: MotionElementFactory
} & {
  [K in Exclude<keyof SVGElementTagNameMap, keyof HTMLElementTagNameMap>]: MotionElementFactory
}
