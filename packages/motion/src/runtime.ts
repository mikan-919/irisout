// Motion JSXの作者APIとブラウザ実行時処理。
// 変換器は`irisout/motion/vite`へ分離し、ここへBabel依存を含めない。

import { animate } from 'motion'

export type MotionTarget = Record<string, unknown>
export type MotionTransition = Record<string, unknown>
export type MotionLayout = boolean | 'position' | 'size' | 'x' | 'y'

export interface MotionElementOptions {
  layout?: MotionLayout
  layoutId?: string
  initial?: MotionTarget | false
  transition?: MotionTransition
}

const sharedLayouts = new Map<string, { element: Element | null; rect: DOMRect }>()

export interface MotionElementController {
  update(target: MotionTarget | undefined, transition?: MotionTransition): void
  destroy(): void
}

function layoutTarget(previous: DOMRect, next: DOMRect, layout: MotionLayout): MotionTarget | null {
  const x = previous.left - next.left
  const y = previous.top - next.top
  const scaleX = next.width === 0 ? 1 : previous.width / next.width
  const scaleY = next.height === 0 ? 1 : previous.height / next.height
  const position = layout !== 'size'
  const size = layout !== 'position' && layout !== 'x' && layout !== 'y'
  const target: MotionTarget = {}
  if (position && layout !== 'y' && x) target.x = [x, 0]
  if (position && layout !== 'x' && y) target.y = [y, 0]
  if (size && scaleX !== 1) target.scaleX = [scaleX, 1]
  if (size && scaleY !== 1) target.scaleY = [scaleY, 1]
  return Object.keys(target).length > 0 ? target : null
}

export function mountMotionElement(
  element: Element,
  options: MotionElementOptions,
): MotionElementController {
  let animation: ReturnType<typeof animate> | null = null
  const ownRect = element.getBoundingClientRect()
  const shared = options.layoutId ? sharedLayouts.get(options.layoutId) : undefined
  let previous = shared?.rect ?? ownRect
  let frame = 0
  const usesLayout = Boolean(options.layout || options.layoutId)
  const transition = options.transition
  if (options.layoutId) sharedLayouts.set(options.layoutId, { element, rect: ownRect })
  if (options.initial !== false && options.initial) {
    animate(element, options.initial, { ...transition, duration: 0 }).complete()
  }
  const measure = () => {
    frame = 0
    if (!usesLayout || !element.isConnected) return
    const next = element.getBoundingClientRect()
    const target = layoutTarget(previous, next, options.layout ?? true)
    previous = next
    if (options.layoutId) sharedLayouts.set(options.layoutId, { element, rect: next })
    if (!target) return
    animation?.stop()
    animation = animate(element, target, transition)
  }
  const schedule = () => {
    if (!usesLayout || frame || typeof requestAnimationFrame === 'undefined') return
    frame = requestAnimationFrame(measure)
  }
  const observer =
    usesLayout && typeof MutationObserver !== 'undefined' ? new MutationObserver(schedule) : null
  if (observer) {
    observer.observe(element.ownerDocument, {
      childList: true,
      subtree: true,
      attributes: true,
    })
  }
  if (shared) schedule()
  return {
    update(target, nextTransition = transition) {
      animation?.stop()
      if (target) animation = animate(element, target, nextTransition)
      schedule()
    },
    destroy() {
      if (frame && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(frame)
      observer?.disconnect()
      if (options.layoutId && sharedLayouts.get(options.layoutId)?.element === element) {
        sharedLayouts.set(options.layoutId, {
          element: null,
          rect: element.getBoundingClientRect(),
        })
      }
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
