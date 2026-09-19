import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vite-plus/test'
import { transformMotionSource } from '../../motion/src/vite.js'
import { mountMotionElement } from '../../motion/src/runtime.js'
import { compileProject } from '../src/compiler.js'
import { createContainer } from './helpers.js'

const animateCalls = vi.hoisted(() => [] as unknown[][])

vi.mock('motion', () => ({
  animate(element: Element, ...args: unknown[]) {
    animateCalls.push(args)
    element.setAttribute('data-animated', 'true')
    return {
      complete() {},
      stop() {
        element.setAttribute('data-stopped', 'true')
      },
    }
  },
}))

describe('irisout/motion extension', () => {
  it('lowers motion JSX without adding Motion knowledge to the core compiler', () => {
    const source = `import { render } from 'irisout'
import { motion } from 'irisout/motion'
export function App() {
  render(<motion.div layout layoutId="card" animate={{ opacity: 1 }}>hello</motion.div>)
}`
    const transformed = transformMotionSource(source)
    expect(transformed).not.toContain('<motion.div')
    expect(transformed).toContain('<div use=')
    expect(transformed).toContain('use={')
    expect(transformed).toContain('mountMotionElement')

    const directory = mkdtempSync(path.join(tmpdir(), 'irisout-motion-extension-'))
    const entry = path.join(directory, 'main.jsx')
    writeFileSync(entry, source)
    const result = compileProject(entry, { transformSource: transformMotionSource })
    expect(result.initialHtml).toContain('<div data-iris-id=')
    expect(result.initialHtml).not.toContain('layout')
    expect(result.code).toContain('layoutId: "card"')
    expect(result.code).toMatch(/from ["']irisout\/motion["']/)
  })

  it('uses official Motion controls and stops them on destroy', () => {
    const container = createContainer()
    const element = container.ownerDocument.createElement('div')
    const controller = mountMotionElement(element, { initial: { opacity: 0 } })
    controller.update({ opacity: 1 })
    expect(element.getAttribute('data-animated')).toBe('true')
    controller.destroy()
    expect(element.getAttribute('data-stopped')).toBe('true')
  })

  it('animates between elements with the same layoutId', () => {
    const container = createContainer()
    const previous = container.ownerDocument.createElement('div')
    container.append(previous)
    previous.getBoundingClientRect = vi.fn(() => ({
      left: 10,
      top: 20,
      width: 100,
      height: 50,
    })) as unknown as typeof previous.getBoundingClientRect
    const previousController = mountMotionElement(previous, { layoutId: 'card' })
    previousController.destroy()
    previous.remove()

    const next = container.ownerDocument.createElement('div')
    container.append(next)
    next.getBoundingClientRect = vi.fn(() => ({
      left: 110,
      top: 40,
      width: 200,
      height: 100,
    })) as unknown as typeof next.getBoundingClientRect
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    }
    const nextController = mountMotionElement(next, { layoutId: 'card' })

    expect(animateCalls.at(-1)).toEqual([
      expect.objectContaining({ x: [-100, 0], y: [-20, 0], scaleX: [0.5, 1] }),
      undefined,
    ])
    nextController.destroy()
    globalThis.requestAnimationFrame = originalRequestAnimationFrame
  })

  it('rejects unsupported Motion props before the irisout compiler', () => {
    expect(() =>
      transformMotionSource(`import { motion } from 'irisout/motion'
const view = <motion.div whileHover={{ scale: 1.1 }} />`),
    ).toThrow(/property whileHover is not supported/)
  })
})
