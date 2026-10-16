// 修正前後の同期処理時間を同じChromiumで測る。描画を含む公式値とは分けて保存する。
import fs from 'node:fs'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { chromium } from 'playwright'
const urls = process.argv.slice(2)
if (urls.length !== 2) throw new Error('Usage: bun probe.mjs <before-url> <after-url>')
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  headless: true,
})
const scenarios = [
  'create',
  'replace',
  'partial',
  'select',
  'swap',
  'remove',
  'create10k',
  'append',
  'clear',
]
const samples = Object.fromEntries(scenarios.map((name) => [name, [[], []]]))
const artifacts = []
try {
  const pages = []
  for (const url of urls) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.addInitScript(() => {
      // DOM処理の比較へ開発用ログの転送費用を混ぜない。両方の実装へ同じ条件を適用する。
      console.log = () => {}
      let seed = 42
      Math.random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        return seed / 4294967296
      }
    })
    await page.goto(url)
    await page.waitForSelector('#run')
    const scripts = await page
      .locator('script[src]')
      .evaluateAll((nodes) => nodes.map((node) => node.src))
    const assets = []
    for (const script of scripts) {
      const response = await fetch(script)
      if (!response.ok) throw new Error(`Cannot read measured script: ${script}`)
      const code = new Uint8Array(await response.arrayBuffer())
      assets.push({
        url: script,
        sha256: createHash('sha256').update(code).digest('hex'),
        bytes: code.byteLength,
        gzipBytes: gzipSync(code).byteLength,
      })
    }
    artifacts.push(assets)
    pages.push(page)
  }
  for (const scenario of scenarios) {
    for (let repeat = -3; repeat < 15; repeat++) {
      for (const index of repeat % 2 ? [1, 0] : [0, 1]) {
        const result = await pages[index].evaluate(async (scenario) => {
          const click = (id) => document.getElementById(id).click()
          click('clear')
          if (!['create', 'create10k'].includes(scenario)) click('run')
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          )
          const buttons = {
            create: 'run',
            replace: 'run',
            partial: 'update',
            swap: 'swaprows',
            create10k: 'runlots',
            append: 'add',
            clear: 'clear',
          }
          const label1 = document.querySelector('tbody tr:first-child td:nth-child(2) a')
          const label2 = document.querySelector('tbody tr:nth-child(2) td:nth-child(2) a')
          const remove = document.querySelector('tbody tr:nth-child(2) td:nth-child(3) span')
          const button = document.getElementById(buttons[scenario])
          const iterations = scenario === 'select' ? 200 : scenario === 'swap' ? 20 : 1
          const start = performance.now()
          for (let i = 0; i < iterations; i++) {
            if (scenario === 'select') (i % 2 ? label2 : label1).click()
            else if (scenario === 'remove') remove.click()
            else button.click()
          }
          const elapsed = (performance.now() - start) / iterations
          const count = document.querySelectorAll('tbody tr').length
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
          if (count !== expected) throw new Error(`${scenario}: ${count}/${expected}`)
          if (scenario === 'select' && document.querySelectorAll('tbody tr.danger').length !== 1)
            throw new Error('Selection failed')
          if (scenario === 'partial' && !label1.textContent.endsWith(' !!!'))
            throw new Error('Partial update failed')
          return elapsed
        }, scenario)
        if (repeat >= 0) samples[scenario][index].push(result)
      }
    }
    const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
    const values = samples[scenario].map(median)
    console.log(`${scenario}: ${values[0].toFixed(4)} -> ${values[1].toFixed(4)} ms`)
  }
  fs.writeFileSync(
    process.env.JSFB_PROBE_OUTPUT ?? new URL('./optimization.json', import.meta.url),
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        browser: browser.version(),
        cpu: os.cpus()[0]?.model,
        urls,
        artifacts,
        method:
          'synchronous click handler and DOM writes; excludes layout and paint; 3 warmups and 15 samples; select averages 200 clicks, swap averages 20 clicks; alternating implementation order; console.log disabled in both pages',
        samples,
      },
      null,
      2,
    ) + '\n',
  )
} finally {
  await browser.close()
}
