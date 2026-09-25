import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vite-plus/test'
import { transformMotionSource } from '../../motion/src/vite.js'
import { mountMotionElement } from '../../motion/src/runtime.js'
import { registerProjectionElement } from '../../motion/src/projection.js'
import { beginDomUpdate, endDomUpdate, observeDomUpdates } from '../../runtime/src/index.js'
import { compile, compileProject } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

vi.mock('motion', () => ({
  animate(element: Element) {
    element.setAttribute('data-animated', 'true')
    return {
      complete() {},
      stop() {
        element.setAttribute('data-stopped', 'true')
      },
    }
  },
}))

vi.mock('../../motion/src/projection.js', () => ({
  registerProjectionElement: vi.fn(() => () => {}),
}))

describe('irisout/motion extension', () => {
  it('notifies projection observers once for a nested DOM update', () => {
    const calls: string[] = []
    const stop = observeDomUpdates({
      before: () => calls.push('before'),
      after: () => calls.push('after'),
    })
    beginDomUpdate()
    beginDomUpdate()
    endDomUpdate()
    endDomUpdate()
    stop()
    expect(calls).toEqual(['before', 'after'])
  })

  it('wraps generated reactive DOM writes in a DOM update transaction', async () => {
    const result = compile(`import { render, signal } from 'irisout'
export function App() {
  const wide = signal(false)
  render(<button style={wide() ? 'width:200px' : 'width:100px'} onClick={() => wide(!wide())}>resize</button>)
}`)
    const generated = await loadGenerated(result.code)
    const container = createContainer()
    const calls: string[] = []
    const stop = observeDomUpdates({
      before: () => calls.push('before'),
      after: () => calls.push('after'),
    })
    const instance = (generated.mountComponent as (element: Element) => { unmount(): void })(
      container,
    )
    calls.length = 0
    const EventConstructor = container.ownerDocument.defaultView!.Event
    container.querySelector('button')!.dispatchEvent(new EventConstructor('click'))
    stop()
    instance.unmount()
    expect(calls).toEqual(['before', 'after'])
  })

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

  it.each([
    ['layoutScroll', { layoutScroll: true }],
    ['layoutRoot', { layoutRoot: true }],
  ])('registers a %s parent without enabling layout', (_name, options) => {
    const register = vi.mocked(registerProjectionElement)
    register.mockClear()
    const element = createContainer().ownerDocument.createElement('div')

    const controller = mountMotionElement(element, options)

    expect(register).toHaveBeenCalledTimes(1)
    expect(register.mock.calls[0]?.[0]).toBe(element)
    expect(register.mock.calls[0]?.[1]).toBe(options)
    expect(options).not.toHaveProperty('layout')
    controller.destroy()
  })

  it('rejects unsupported Motion props before the irisout compiler', () => {
    expect(() =>
      transformMotionSource(`import { motion } from 'irisout/motion'
const view = <motion.div whileHover={{ scale: 1.1 }} />`),
    ).toThrow(/property whileHover is not supported/)
  })
})
