// 隔離Playgroundを実Chromiumで確認する試験。
// 配信元、Cookie境界、Worker停止、結果iframeのsandbox・CSP・復旧を同じ操作で確認する。

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { createPlaygroundServer } from './playground-server.mjs'

const projectRoot = path.resolve(import.meta.dirname, '../../..')
const distRoot = path.join(projectRoot, 'app/web/dist')
const sitePort = Number(process.env.IRISOUT_PLAYGROUND_SITE_PORT ?? 4173)
const controllerPort = Number(process.env.IRISOUT_PLAYGROUND_CONTROLLER_PORT ?? 4174)

function chromiumPath() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  }
  if (!existsSync('/etc/NIXOS')) return undefined
  const output = execFileSync(
    'nix',
    ['build', '--no-link', '--print-out-paths', 'nixpkgs#chromium'],
    {
      encoding: 'utf8',
    },
  )
    .trim()
    .split('\n')
    .at(-1)
  const executablePath = output ? path.join(output, 'bin/chromium') : ''
  if (!existsSync(executablePath)) throw new Error(`Chromiumがありません: ${executablePath}`)
  return executablePath
}

function buildSite(controllerOrigin) {
  execFileSync('bun', ['run', 'build:web'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      VITE_IRISOUT_PLAYGROUND_CONTROLLER_ORIGIN: controllerOrigin,
    },
    stdio: 'inherit',
  })
}

async function waitForText(locator, expected, timeout = 10_000) {
  const deadline = Date.now() + timeout
  let lastText = ''
  while (Date.now() < deadline) {
    lastText = (await locator.textContent()) ?? ''
    if (lastText.includes(expected)) return lastText
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`表示を待てませんでした: ${expected}; actual=${lastText}`)
}

async function resultFrame(page) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const controllerFrame = page
      .frames()
      .find((candidate) => candidate.url().includes('playground-controller.html'))
    const frame = controllerFrame?.childFrames()[0]
    if (frame) return frame
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('結果iframeがありません')
}

const controller = createPlaygroundServer({
  root: distRoot,
  kind: 'controller',
  host: 'localhost',
  port: controllerPort,
})
const controllerAddress = await controller.listen()
const site = createPlaygroundServer({
  root: distRoot,
  kind: 'site',
  host: '127.0.0.1',
  port: sitePort,
})
const siteAddress = await site.listen()

try {
  buildSite(controllerAddress.origin)
  const browser = await chromium.launch({ headless: true, executablePath: chromiumPath() })
  try {
    const context = await browser.newContext()
    await context.addCookies([
      {
        name: 'irisout-admin',
        value: 'must-not-cross-origin',
        url: siteAddress.origin,
      },
    ])
    const page = await context.newPage()
    await page.goto(siteAddress.origin, { waitUntil: 'networkidle' })
    const source = page.locator('[data-playground-source]')
    const status = page.locator('[data-playground-status]')
    const run = page.locator('[data-playground-run]')
    const stop = page.locator('[data-playground-stop]')
    await waitForText(status, '実行できます')

    const controllerFrame = page
      .frames()
      .find((frame) => frame.url().startsWith(controllerAddress.origin))
    assert.ok(controllerFrame, '実行管理iframeがありません')
    assert.equal(await controllerFrame.evaluate(() => document.cookie), '')

    const controllerHeaders = await context.request.get(
      `${controllerAddress.origin}/playground-controller.html`,
    )
    assert.equal(controllerHeaders.status(), 200)
    const csp = controllerHeaders.headers()['content-security-policy'] ?? ''
    assert.match(csp, /default-src 'none'/)
    assert.match(csp, /worker-src 'self' blob:/)
    assert.match(csp, /connect-src 'none'/)
    assert.equal(controllerHeaders.headers()['referrer-policy'], 'no-referrer')

    await run.click()
    await waitForText(status, '実行しました')
    const firstResult = await resultFrame(page)
    assert.equal(await controllerFrame.locator('iframe').getAttribute('sandbox'), 'allow-scripts')
    assert.match(
      await firstResult
        .locator('meta[http-equiv="Content-Security-Policy"]')
        .getAttribute('content'),
      /connect-src 'none'/,
    )
    assert.equal(await firstResult.locator('output').textContent(), '0')
    await firstResult.getByRole('button', { name: '増加' }).click()
    assert.equal(await firstResult.locator('output').textContent(), '1')

    const malformedRunId = await page.evaluate(() => {
      const frame = document.querySelector('.playground-controller')
      frame?.contentWindow?.postMessage(
        {
          type: 'irisout-playground/status',
          version: 1,
          runId: 'run-1',
          status: 'success',
          unexpected: 'ignored',
        },
        '*',
      )
      return document.querySelector('[data-playground-status]')?.textContent
    })
    assert.equal(malformedRunId, '実行しました')

    const blockedSource = `export function App() {
  render(
    <main>
      <form action="https://example.com/submit"><button type="submit">送信</button></form>
      <a href="https://example.com/" target="_top">上位遷移</a>
      <a href="data:text/plain,download" download="result.txt">ダウンロード</a>
      <button type="button" onClick={attempt}>外部通信</button>
      <button type="button" onClick={popup}>ポップアップ</button>
      <button type="button" onClick={attemptDom}>親DOM</button>
    </main>,
  )
  function attempt() { fetch('https://example.com/blocked') }
  function popup() { window.open('https://example.com/') }
  function attemptDom() { parent.parent.document.body.dataset.playgroundPwned = 'yes' }
}`
    await source.fill(blockedSource)
    const blockedRequests = []
    const requestListener = (request) => {
      if (request.url().includes('example.com')) blockedRequests.push(request.url())
    }
    page.on('request', requestListener)
    await run.click()
    await waitForText(status, '実行しました')
    const blockedResult = await resultFrame(page)
    await blockedResult.getByRole('button', { name: '外部通信' }).click()
    await blockedResult.getByRole('button', { name: 'ポップアップ' }).click()
    await blockedResult.getByRole('button', { name: '親DOM' }).click()
    await blockedResult.getByRole('button', { name: '送信' }).click()
    await blockedResult.getByRole('link', { name: '上位遷移' }).click()
    await blockedResult.getByRole('link', { name: 'ダウンロード' }).click()
    await new Promise((resolve) => setTimeout(resolve, 300))
    page.off('request', requestListener)
    assert.deepEqual(blockedRequests, [])
    assert.equal(page.url(), siteAddress.origin + '/')
    assert.equal(await page.locator('.playground-controller').count(), 1)
    assert.equal(await page.locator('body').getAttribute('data-playground-pwned'), null)

    const oversizedResultSource = `export function App() {
  render(<div>{'x'.repeat(1_100_000)}</div>)
}`
    await source.fill(oversizedResultSource)
    await run.click()
    await waitForText(status, '生成結果が1 MiBを超えています')
    assert.equal(await controllerFrame.locator('iframe').count(), 0)

    const exceptionSource = `export function App() {
  const value = signal((() => { throw new Error('playground exception') })())
  render(<div>{value()}</div>)
}`
    await source.fill(exceptionSource)
    await run.click()
    await waitForText(status, 'playground exception')
    assert.equal(await controllerFrame.locator('iframe').count(), 0)

    const infiniteSource = `export function App() {
  const value = signal((() => { while (true) {} })())
  render(<div>{value()}</div>)
}`
    await source.fill(infiniteSource)
    await run.click()
    await waitForText(status, '時間超過', 8_000)
    assert.equal(await controllerFrame.locator('iframe').count(), 0)

    await source.fill(`export function App() { render(<p>再実行</p>) }`)
    await run.click()
    await waitForText(status, '実行しました')
    assert.equal(await (await resultFrame(page)).locator('p').textContent(), '再実行')

    await source.fill(infiniteSource)
    await run.click()
    await new Promise((resolve) => setTimeout(resolve, 150))
    await stop.click()
    await waitForText(status, '停止しました')
    assert.equal(await controllerFrame.locator('iframe').count(), 0)

    await source.fill(`export function App() { render(<p>停止後の再実行</p>) }`)
    await run.click()
    await waitForText(status, '実行しました')
    assert.equal(await (await resultFrame(page)).locator('p').textContent(), '停止後の再実行')
    await page.close()
    await context.close()
  } finally {
    await browser.close()
  }
} finally {
  await site.close()
  await controller.close()
}

console.log('playground isolated execution browser test passed')
