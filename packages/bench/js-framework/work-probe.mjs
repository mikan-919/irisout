// 時間測定とは別のページで、操作中の検索・DOM操作・配列複製の回数を数える。
// 計装による時間を性能値へ混ぜず、Vanillaとの差を生成コードと照合する。
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright'

const urls = process.argv.slice(2)
if (urls.length !== 2) throw new Error('Usage: bun work-probe.mjs <vanilla-url> <irisout-url>')
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  headless: true,
})
const scenarios = {
  create: 'run',
  replace: 'run',
  partial: 'update',
  select: null,
  swap: 'swaprows',
  remove: null,
  create10k: 'runlots',
  append: 'add',
  clear: 'clear',
}
const measurements = []
try {
  for (const url of urls) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.addInitScript(() => {
      console.log = () => {}
      let active = false
      let counts = {}
      const record = (name, amount = 1) => {
        if (active) counts[name] = (counts[name] ?? 0) + amount
      }
      const method = (prototype, name, label = name) => {
        const original = prototype[name]
        prototype[name] = function (...args) {
          record(label)
          return Reflect.apply(original, this, args)
        }
      }
      for (const name of ['get', 'set', 'has', 'delete']) {
        const original = Map.prototype[name]
        Map.prototype[name] = function (...args) {
          if (typeof args[0] === 'number') record('numericMap.' + name)
          return Reflect.apply(original, this, args)
        }
      }
      for (const name of ['map', 'filter', 'slice', 'concat', 'findIndex', 'splice']) {
        const original = Array.prototype[name]
        Array.prototype[name] = function (...args) {
          // 行数に相当する配列だけを対象にし、マーカー位置などの小配列を除く。
          if (this.length >= 100) {
            record('array.' + name)
            record('array.' + name + '.inputItems', this.length)
          }
          return Reflect.apply(original, this, args)
        }
      }
      method(DocumentFragment.prototype, 'append', 'fragment.append')
      method(Document.prototype, 'createDocumentFragment')
      method(Node.prototype, 'cloneNode')
      method(Node.prototype, 'insertBefore')
      method(Node.prototype, 'appendChild')
      method(Element.prototype, 'remove')
      method(Element.prototype, 'replaceChildren')
      method(Element.prototype, 'setAttribute')
      method(EventTarget.prototype, 'addEventListener')
      method(Object, 'is', 'Object.is')
      method(Map.prototype, 'clear', 'map.clear')
      for (const [prototype, names] of [
        [
          Node.prototype,
          ['firstChild', 'lastChild', 'nextSibling', 'parentNode', 'nodeType', 'childNodes'],
        ],
        [Element.prototype, ['firstElementChild', 'nextElementSibling']],
        [DocumentFragment.prototype, ['firstElementChild']],
        [HTMLTemplateElement.prototype, ['content']],
      ]) {
        for (const name of names) {
          const descriptor = Object.getOwnPropertyDescriptor(prototype, name)
          Object.defineProperty(prototype, name, {
            ...descriptor,
            get() {
              record('get.' + name)
              return descriptor.get.call(this)
            },
          })
        }
      }
      for (const [prototype, name] of [
        [Node.prototype, 'textContent'],
        [Node.prototype, 'nodeValue'],
        [Element.prototype, 'className'],
      ]) {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, name)
        Object.defineProperty(prototype, name, {
          ...descriptor,
          set(value) {
            record(name)
            return descriptor.set.call(this, value)
          },
        })
      }
      window.__startWorkProbe__ = () => {
        counts = {}
        active = true
      }
      window.__stopWorkProbe__ = () => {
        active = false
        return counts
      }
    })
    await page.goto(url)
    await page.waitForSelector('#run')
    const assets = []
    for (const script of await page
      .locator('script[src]')
      .evaluateAll((nodes) => nodes.map((node) => node.src))) {
      const response = await fetch(script)
      if (!response.ok) throw new Error('Cannot read measured script: ' + script)
      assets.push({
        url: script,
        sha256: createHash('sha256')
          .update(new Uint8Array(await response.arrayBuffer()))
          .digest('hex'),
      })
    }
    const results = {}
    for (const [scenario, button] of Object.entries(scenarios)) {
      results[scenario] = await page.evaluate(
        ({ scenario, button }) => {
          document.getElementById('clear').click()
          if (!['create', 'create10k'].includes(scenario)) document.getElementById('run').click()
          const target =
            scenario === 'select'
              ? document.querySelector('tbody tr:nth-child(2) td:nth-child(2) a')
              : scenario === 'remove'
                ? document.querySelector('tbody tr:nth-child(2) td:nth-child(3) span')
                : document.getElementById(button)
          const before = [...document.querySelectorAll('tbody tr')]
          window.__startWorkProbe__()
          target.click()
          const counts = window.__stopWorkProbe__()
          const after = [...document.querySelectorAll('tbody tr')]
          const expected =
            scenario === 'create10k'
              ? 10000
              : scenario === 'append'
                ? 2000
                : scenario === 'clear'
                  ? 0
                  : scenario === 'remove'
                    ? 999
                    : 1000
          if (after.length !== expected) throw new Error('Row count mismatch: ' + scenario)
          if (scenario === 'swap' && (after[1] !== before[998] || after[998] !== before[1]))
            throw new Error('Swap failed')
          if (scenario === 'partial' && !after[0].children[1].textContent.endsWith(' !!!'))
            throw new Error('Update failed')
          if (
            scenario === 'select' &&
            (after[1].className !== 'danger' ||
              after.filter((row) => row.className === 'danger').length !== 1)
          )
            throw new Error('Selection failed')
          return { counts, rows: after.length }
        },
        { scenario, button },
      )
    }
    measurements.push({ url, assets, results })
    await page.close()
  }
  fs.writeFileSync(
    process.env.JSFB_WORK_PROBE_OUTPUT ?? new URL('./vanilla-work.json', import.meta.url),
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        browser: browser.version(),
        method:
          'one click from a fresh 1000-row state, or empty state for create; instrumented calls only, no timing; includes DocumentFragment.append, createDocumentFragment and Node.childNodes; console.log disabled; numeric Map keys; array operations counted only for length >= 100',
        measurements,
      },
      null,
      2,
    ) + '\n',
  )
} finally {
  await browser.close()
}
