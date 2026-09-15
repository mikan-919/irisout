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
  const environment = { ...process.env }
  if (controllerOrigin === undefined) {
    delete environment.VITE_IRISOUT_PLAYGROUND_CONTROLLER_ORIGIN
  } else {
    environment.VITE_IRISOUT_PLAYGROUND_CONTROLLER_ORIGIN = controllerOrigin
  }
  execFileSync('bun', ['run', 'build:web'], {
    cwd: projectRoot,
    env: environment,
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

async function fillSource(source, value) {
  await source.evaluate((element, next) => {
    element.value = next
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
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

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const site = createPlaygroundServer({
  root: distRoot,
  kind: 'site',
  host: '127.0.0.1',
  port: sitePort,
})
const siteAddress = await site.listen()
const controller = createPlaygroundServer({
  root: distRoot,
  kind: 'controller',
  host: 'localhost',
  port: controllerPort,
  officialOrigin: siteAddress.origin,
})
const controllerAddress = await controller.listen()
const attacker = createPlaygroundServer({
  root: distRoot,
  kind: 'site',
  host: 'localhost',
  port: 0,
})
const attackerAddress = await attacker.listen()

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
    const examplesRequest = deferred()
    const releaseExamples = deferred()
    const controllerRequest = deferred()
    const releaseController = deferred()
    await page.route(`${siteAddress.origin}/docs/examples.json`, async (route) => {
      examplesRequest.resolve()
      await releaseExamples.promise
      await route.continue()
    })
    await page.route(`${controllerAddress.origin}/playground-controller.html*`, async (route) => {
      controllerRequest.resolve()
      await releaseController.promise
      await route.continue()
    })
    await page.goto(siteAddress.origin, { waitUntil: 'domcontentloaded' })
    const source = page.locator('[data-playground-source]')
    const status = page.locator('[data-playground-status]')
    const run = page.locator('[data-playground-run]')
    const stop = page.locator('[data-playground-stop]')
    await Promise.all([examplesRequest.promise, controllerRequest.promise])
    assert.equal(await source.evaluate((element) => element.readOnly), true)
    assert.equal(await run.isDisabled(), true)
    await page.evaluate(() => {
      const element = document.querySelector('[data-playground-source]')
      if (!(element instanceof HTMLTextAreaElement)) throw new Error('source欄がありません')
      element.value = 'export function Preserved() { render(<p>遅延入力</p>) }'
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
    releaseExamples.resolve()
    releaseController.resolve()
    await waitForText(status, '実行できます')
    const editor = page.locator('[data-playground-monaco] .monaco-editor')
    await editor.waitFor()
    await source.waitFor({ state: 'hidden' })
    assert.equal(
      await source.inputValue(),
      'export function Preserved() { render(<p>遅延入力</p>) }',
    )
    assert.equal(await source.evaluate((element) => element.readOnly), false)
    await editor.click()
    await page.keyboard.press('Control+A')
    await page.keyboard.type('export function Edited() { render(<p>Monaco入力</p>) }')
    await page.waitForFunction(
      (expected) => document.querySelector('[data-playground-source]')?.value === expected,
      'export function Edited() { render(<p>Monaco入力</p>) }',
    )
    assert.equal(
      await source.inputValue(),
      'export function Edited() { render(<p>Monaco入力</p>) }',
    )
    await page.unroute(`${siteAddress.origin}/docs/examples.json`)
    await page.unroute(`${controllerAddress.origin}/playground-controller.html*`)
    await page.locator('[data-playground-example]').selectOption('counter')

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
    assert.match(
      csp,
      new RegExp(
        `frame-ancestors ${siteAddress.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:;|$)`,
      ),
    )
    assert.doesNotMatch(csp, /frame-ancestors .*localhost/)
    assert.equal(controllerHeaders.headers()['referrer-policy'], 'no-referrer')
    const controllerApi = await context.request.get(controllerAddress.origin + '/api/playgrounds')
    assert.equal(controllerApi.status(), 404)
    assert.equal(controllerHeaders.headers()['set-cookie'], undefined)

    const deniedPage = await context.newPage()
    await deniedPage.goto(attackerAddress.origin, { waitUntil: 'domcontentloaded' })
    await deniedPage.evaluate((origin) => {
      const iframe = document.createElement('iframe')
      iframe.src = `${origin}/playground-controller.html`
      document.body.append(iframe)
    }, controllerAddress.origin)
    await new Promise((resolve) => setTimeout(resolve, 500))
    assert.equal(
      deniedPage.frames().some((frame) => frame.url().startsWith(controllerAddress.origin)),
      false,
    )
    await deniedPage.close()

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
    await fillSource(source, blockedSource)
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
    await fillSource(source, oversizedResultSource)
    await run.click()
    await waitForText(status, '生成結果が1 MiBを超えています')
    assert.equal(await controllerFrame.locator('iframe').count(), 0)

    const exceptionSource = `export function App() {
  const value = signal((() => { throw new Error('playground exception') })())
  render(<div>{value()}</div>)
}`
    await fillSource(source, exceptionSource)
    await run.click()
    await waitForText(status, 'playground exception')
    assert.equal(await controllerFrame.locator('iframe').count(), 0)

    const infiniteSource = `export function App() {
  const value = signal((() => { while (true) {} })())
  render(<div>{value()}</div>)
}`
    await fillSource(source, infiniteSource)
    await run.click()
    await waitForText(status, '時間超過', 8_000)
    assert.equal(await controllerFrame.locator('iframe').count(), 0)

    await fillSource(source, `export function App() { render(<p>再実行</p>) }`)
    await run.click()
    await waitForText(status, '実行しました')
    assert.equal(await (await resultFrame(page)).locator('p').textContent(), '再実行')

    await fillSource(source, infiniteSource)
    await run.click()
    await new Promise((resolve) => setTimeout(resolve, 150))
    await stop.click()
    await waitForText(status, '停止しました')
    assert.equal(await controllerFrame.locator('iframe').count(), 0)

    await fillSource(source, `export function App() { render(<p>停止後の再実行</p>) }`)
    await run.click()
    await waitForText(status, '実行しました')
    assert.equal(await (await resultFrame(page)).locator('p').textContent(), '停止後の再実行')
    await page.close()

    // /playgroundのSSG編集画面で、登録済みCounter/List/SVGだけを初期選択する。
    for (const exampleId of ['counter', 'list', 'svg']) {
      const examplePage = await context.newPage()
      await examplePage.goto(`${siteAddress.origin}/playground?example=${exampleId}`, {
        waitUntil: 'networkidle',
      })
      await waitForText(examplePage.locator('[data-playground-status]'), '実行できます')
      assert.equal(await examplePage.locator('[data-playground-example]').inputValue(), exampleId)
      assert.match(
        await examplePage.locator('[data-playground-source]').inputValue(),
        new RegExp(
          `export function ${exampleId === 'svg' ? 'SvgExample' : exampleId[0].toUpperCase() + exampleId.slice(1)}`,
        ),
      )
      await examplePage.close()
    }
    for (const query of ['?example=unknown', '?example=list&example=list']) {
      const fallbackPage = await context.newPage()
      await fallbackPage.goto(`${siteAddress.origin}/playground${query}`, {
        waitUntil: 'networkidle',
      })
      await waitForText(fallbackPage.locator('[data-playground-status]'), '実行できます')
      assert.equal(await fallbackPage.locator('[data-playground-example]').inputValue(), 'counter')
      await fallbackPage.close()
    }

    const duplicateSource = 'export function Shared() { render(<p>共有からの複製</p>) }'
    const duplicatePage = await context.newPage()
    await duplicatePage.addInitScript((source) => {
      sessionStorage.setItem('irisout.playground.duplicate-source', source)
    }, duplicateSource)
    await duplicatePage.goto(siteAddress.origin, { waitUntil: 'networkidle' })
    await waitForText(duplicatePage.locator('[data-playground-status]'), '実行できます')
    assert.equal(
      await duplicatePage.locator('[data-playground-source]').inputValue(),
      duplicateSource,
    )
    assert.equal(
      await duplicatePage
        .locator('[data-playground-source]')
        .evaluate((element) => element.readOnly),
      false,
    )
    await duplicatePage.close()

    const editorFallbackPage = await context.newPage()
    await editorFallbackPage.route('**/assets/monaco-editor-*.js', (route) => route.abort())
    await editorFallbackPage.goto(siteAddress.origin, { waitUntil: 'networkidle' })
    await waitForText(editorFallbackPage.locator('[data-playground-status]'), '実行できます')
    assert.equal(await editorFallbackPage.locator('[data-playground-source]').isVisible(), true)
    assert.match(
      await editorFallbackPage.locator('[data-playground-source]').inputValue(),
      /export function/,
    )
    assert.equal(await editorFallbackPage.locator('.monaco-editor').count(), 0)
    await editorFallbackPage.close()

    buildSite(siteAddress.origin)
    const sameHostPage = await context.newPage()
    await sameHostPage.goto(siteAddress.origin, { waitUntil: 'networkidle' })
    const sameHostStatus = sameHostPage.locator('[data-playground-status]')
    await waitForText(sameHostStatus, '異なるhostname')
    assert.equal(await sameHostPage.locator('[data-playground-run]').isDisabled(), true)
    assert.match(
      await sameHostPage.locator('[data-playground-source]').inputValue(),
      /export function/,
    )
    assert.equal(
      await sameHostPage
        .locator('[data-playground-source]')
        .evaluate((element) => element.readOnly),
      false,
    )
    assert.equal(await sameHostPage.locator('.playground-controller').count(), 0)
    await sameHostPage.close()

    buildSite(undefined)
    const missingConfigPage = await context.newPage()
    await missingConfigPage.goto(siteAddress.origin, { waitUntil: 'networkidle' })
    await waitForText(missingConfigPage.locator('[data-playground-status]'), '未設定')
    assert.equal(await missingConfigPage.locator('[data-playground-run]').isDisabled(), true)
    assert.match(
      await missingConfigPage.locator('[data-playground-source]').inputValue(),
      /export function/,
    )
    assert.equal(
      await missingConfigPage
        .locator('[data-playground-source]')
        .evaluate((element) => element.readOnly),
      false,
    )
    assert.equal(await missingConfigPage.locator('.playground-controller').count(), 0)
    await missingConfigPage.close()

    await context.close()
  } finally {
    await browser.close()
  }
} finally {
  await site.close()
  await controller.close()
  await attacker.close()
}

console.log('playground isolated execution browser test passed')
