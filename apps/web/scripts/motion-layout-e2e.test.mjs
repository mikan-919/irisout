// irisout/motionの配置投影を実Chromiumで確認する。
// 単体試験では得られない実レイアウトとAnimationFrameの結果を検査する。

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const projectRoot = path.resolve(import.meta.dirname, '../../..')
const demoRoot = path.join(projectRoot, 'apps/demos')
const distRoot = path.join(demoRoot, 'dist-motion')

function chromiumPath() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  }
  if (!existsSync('/etc/NIXOS')) return undefined
  const output = execFileSync(
    'nix',
    ['build', '--no-link', '--print-out-paths', 'nixpkgs#chromium'],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .at(-1)
  const executablePath = output ? path.join(output, 'bin/chromium') : ''
  if (!existsSync(executablePath)) throw new Error(`Chromiumがありません: ${executablePath}`)
  return executablePath
}

if (process.env.IRISOUT_SKIP_MOTION_BUILD !== 'true') {
  execFileSync('bun', ['run', 'build:packages'], { cwd: projectRoot, stdio: 'inherit' })
  execFileSync('bunx', ['vp', 'build'], {
    cwd: demoRoot,
    env: {
      ...process.env,
      IRISOUT_MOTION: 'true',
      IRISOUT_ENTRY: 'motion-layout.jsx',
      IRISOUT_OUT_DIR: 'dist-motion',
    },
    stdio: 'inherit',
  })
}

const server = createServer(async (request, response) => {
  const requestPath = request.url === '/' ? '/index.html' : request.url
  const filePath = path.join(distRoot, requestPath)
  try {
    const body = await readFile(filePath)
    response.setHeader('content-type', filePath.endsWith('.js') ? 'text/javascript' : 'text/html')
    response.end(body)
  } catch {
    response.statusCode = 404
    response.end('not found')
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
if (!address || typeof address === 'string') throw new Error('試験サーバーを開始できません')

const browser = await chromium.launch({ headless: true, executablePath: chromiumPath() })
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: 'networkidle' })

  await page.locator('#resize').click()
  await page.waitForFunction(() =>
    document.querySelector('#parent')?.style.transform.includes('translate'),
  )
  await page.waitForTimeout(50)
  const parentStyle = await page.locator('#parent').getAttribute('style')
  const childTransform = await page
    .locator('#child')
    .evaluate((element) => getComputedStyle(element).transform)
  assert.match(parentStyle, /transform:/)
  assert.notEqual(childTransform, 'none', `parent=${parentStyle}`)

  await page.locator('#resize').click()
  await page.locator('#resize').click()
  await page.waitForTimeout(50)
  assert.equal(await page.locator('#parent').evaluate((element) => element.style.width), '420px')
  assert.match(await page.locator('#parent').getAttribute('style'), /transform:/)

  await page.locator('#scroll-region').evaluate((element) => {
    element.scrollLeft = 30
  })
  await page.locator('#reorder').click()
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-item]')].some((element) =>
      element.style.transform.includes('translate'),
    ),
  )
  assert.equal(await page.locator('#scroll-region').evaluate((element) => element.scrollLeft), 30)

  await page.locator('#shared').click()
  await page.waitForFunction(() =>
    document.querySelector('#detail-card')?.style.transform.includes('translate'),
  )
  assert.equal(await page.locator('#summary-card').count(), 0)

  await page.locator('#exit-conditional').click()
  assert.equal(await page.locator('#exit-card').count(), 1)
  await page.waitForFunction(() => {
    const element = document.querySelector('#exit-card')
    return element && Number(getComputedStyle(element).opacity) < 1
  })
  await page.locator('#exit-card').waitFor({ state: 'detached' })

  await page.locator('#presence-reorder').click()
  assert.deepEqual(
    await page
      .locator('[data-presence-item]')
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('data-presence-item')),
      ),
    ['y', 'x'],
  )

  await page.locator('#exit-list').click()
  assert.equal(await page.locator('[data-presence-item="x"]').count(), 1)
  assert.equal(await page.locator('[data-presence-item="y"]').count(), 1)
  assert.equal(await page.locator('[data-presence-item="z"]').count(), 1)
  await page.locator('[data-presence-item="x"]').waitFor({ state: 'detached' })
  assert.equal(await page.locator('[data-presence-item="y"]').count(), 1)
  assert.equal(await page.locator('[data-presence-item="z"]').count(), 1)
  assert.equal(errors.length, 0, errors.join('\n'))
  console.log('motion layout browser test passed')
} finally {
  await browser.close()
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}
