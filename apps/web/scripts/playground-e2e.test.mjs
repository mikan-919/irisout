// 隔離Playgroundを実Chromiumで確認する試験。
// 配信元、Cookie境界、Worker停止、結果iframeのsandbox・CSP・復旧を同じ操作で確認する。

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { createPlaygroundServer } from './playground-server.mjs'

const projectRoot = path.resolve(import.meta.dirname, '../../..')
const distRoot = path.join(projectRoot, 'apps/web/dist')
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

async function readEditorTokens(page) {
  return page
    .locator('[data-playground-monaco] .view-line span[class*="mtk"]')
    .evaluateAll((elements) =>
      elements.map((element) => ({
        text: (element.textContent ?? '').replaceAll('\u00a0', ' '),
        color: getComputedStyle(element).color,
      })),
    )
}

async function waitForEditorToken(page, expected) {
  await page.waitForFunction((text) => {
    const normalize = (value) => value.replaceAll('\u00a0', ' ')
    return [
      ...document.querySelectorAll('[data-playground-monaco] .view-line span[class*="mtk"]'),
    ].some((element) => normalize(element.textContent ?? '') === text)
  }, expected)
}

function assertSyntaxHighlight(tokens, { plain = 'Counter' } = {}) {
  const comment = '// 公式文書とPlaygroundが共有するCounter入力。'
  const token = (text) =>
    tokens.find((candidate) => candidate.text === text) ??
    (text === comment ? tokens.find((candidate) => candidate.text.startsWith('//')) : undefined)
  const plainToken = token(plain)
  assert.ok(token('export'), 'キーワードが構文トークンになっていません')
  assert.ok(token(comment), 'コメントが構文トークンになっていません')
  assert.ok(token('main'), 'JSXタグが構文トークンになっていません')
  assert.ok(token('type'), 'JSX属性が構文トークンになっていません')
  assert.ok(token('"button"'), '文字列が構文トークンになっていません')
  assert.ok(plainToken, '通常のJSXテキストがありません')
  for (const syntax of ['export', comment, 'main', 'type', '"button"']) {
    assert.notEqual(token(syntax)?.color, plainToken.color, `${syntax}が通常テキストと同じ色です`)
  }
}

function assertTypeScriptHighlight(tokens, { plain = 'plain' } = {}) {
  assertSyntaxHighlight(tokens, { plain })
  const token = (text) => tokens.find((candidate) => candidate.text === text)
  const plainToken = token(plain)
  for (const syntax of ['type', 'interface', 'string', 'number', 'T']) {
    assert.ok(token(syntax), `${syntax}がTypeScriptの構文トークンになっていません`)
    assert.notEqual(token(syntax).color, plainToken.color, `${syntax}が通常テキストと同じ色です`)
  }
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
    const homePage = await context.newPage()
    await homePage.goto(siteAddress.origin, { waitUntil: 'networkidle' })
    assert.equal(await homePage.locator('[data-playground-root]').count(), 0)
    assert.equal(
      await homePage.locator('.site-header nav > a[href="/playground"]').getAttribute('href'),
      '/playground',
    )
    await homePage.close()

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
    await page.goto(`${siteAddress.origin}/playground`, { waitUntil: 'domcontentloaded' })
    const source = page.locator('[data-playground-source]')
    const status = page.locator('[data-playground-status]')
    const run = page.locator('[data-playground-run]')
    const stop = page.locator('[data-playground-stop]')
    await Promise.all([examplesRequest.promise, controllerRequest.promise])
    assert.equal(await source.evaluate((element) => element.readOnly), true)
    assert.equal(await run.isDisabled(), true)
    const initialTsxSource = `// 公式文書とPlaygroundが共有するCounter入力。
type CounterLabel = string
interface CounterProps {
  label: CounterLabel
}
function identity<T>(value: T): T {
  return value
}
export function Preserved(props: CounterProps) {
  const count: number = 0
  render(
    <main>
      <button type="button">{identity<string>(props.label)}</button>
      <p>plain</p>
    </main>,
  )
}`
    await page.evaluate((value) => {
      const element = document.querySelector('[data-playground-source]')
      if (!(element instanceof HTMLTextAreaElement)) throw new Error('source欄がありません')
      element.value = value
      element.dispatchEvent(new Event('input', { bubbles: true }))
    }, initialTsxSource)
    releaseExamples.resolve()
    releaseController.resolve()
    await waitForText(status, '実行できます')
    const editor = page.locator('[data-playground-monaco] .monaco-editor')
    await editor.waitFor()
    await source.waitFor({ state: 'hidden' })
    assert.equal(await source.inputValue(), initialTsxSource)
    await waitForEditorToken(page, 'interface')
    await waitForEditorToken(page, 'export')
    assertTypeScriptHighlight(await readEditorTokens(page))
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

    const replacedSource = `// 公式文書とPlaygroundが共有するCounter入力。
type ButtonLabel = string
interface ButtonProps {
  label: ButtonLabel
}
function identity<T>(value: T): T {
  return value
}
export function Edited(props: ButtonProps) {
  const count: number = 0
  render(
    <main type="button">
      <button>{identity<string>(props.label)}</button>
      <p>plain</p>
      <p>置換後</p>
    </main>,
  )
    }`
    await fillSource(source, replacedSource)
    await waitForEditorToken(page, 'interface')
    assertTypeScriptHighlight(await readEditorTokens(page))

    const syntaxPage = await context.newPage()
    await syntaxPage.goto(`${siteAddress.origin}/playground`, { waitUntil: 'networkidle' })
    await waitForText(syntaxPage.locator('[data-playground-status]'), '実行できます')
    await syntaxPage.locator('[data-playground-monaco] .monaco-editor').waitFor()
    await syntaxPage.locator('[data-playground-source]').waitFor({ state: 'hidden' })
    const syntaxTokens = await readEditorTokens(syntaxPage)
    console.log(JSON.stringify(syntaxTokens))
    assertSyntaxHighlight(syntaxTokens)
    await syntaxPage.close()
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
    assert.equal(await controllerFrame.locator('#controller-status').isHidden(), true)
    assert.deepEqual(
      await controllerFrame.locator('#result-root').evaluate((element) => {
        const style = getComputedStyle(element)
        return { borderWidth: style.borderWidth, borderRadius: style.borderRadius }
      }),
      { borderWidth: '0px', borderRadius: '0px' },
    )
    assert.deepEqual(
      await controllerFrame.locator('#result-root > iframe').evaluate((element) => ({
        display: element.style.display,
        width: element.style.width,
        minHeight: element.style.minHeight,
        border: element.style.border,
        background: element.style.background,
      })),
      {
        display: 'block',
        width: '100%',
        minHeight: '16rem',
        border: '0px',
        background: 'transparent',
      },
    )
    assert.equal(
      await firstResult
        .locator('html')
        .evaluate((element) => getComputedStyle(element).backgroundColor),
      'rgba(0, 0, 0, 0)',
    )
    assert.equal(
      await firstResult
        .locator('body')
        .evaluate((element) => getComputedStyle(element).backgroundColor),
      'rgba(0, 0, 0, 0)',
    )
    await page.setViewportSize({ width: 900, height: 900 })
    const horizontalSourceBox = await page.locator('[data-playground-monaco]').boundingBox()
    const horizontalResultBox = await page.locator('[data-playground-result]').boundingBox()
    assert.ok(horizontalSourceBox && horizontalResultBox)
    assert.ok(horizontalResultBox.x > horizontalSourceBox.x)
    assert.ok(Math.abs(horizontalResultBox.y - horizontalSourceBox.y) < 2)
    await page.setViewportSize({ width: 700, height: 900 })
    const verticalSourceBox = await page.locator('[data-playground-monaco]').boundingBox()
    const verticalResultBox = await page.locator('[data-playground-result]').boundingBox()
    assert.ok(verticalSourceBox && verticalResultBox)
    assert.ok(verticalResultBox.y > verticalSourceBox.y)
    await page.setViewportSize({ width: 1280, height: 720 })
    const desktopSectionBox = await page.locator('.playground-section').boundingBox()
    const desktopIntroBox = await page.locator('.playground-intro').boundingBox()
    const desktopEditorBox = await page.locator('.playground-editor').boundingBox()
    assert.ok(desktopSectionBox && desktopIntroBox && desktopEditorBox)
    assert.ok(desktopEditorBox.y >= desktopIntroBox.y + desktopIntroBox.height)
    assert.ok(Math.abs(desktopEditorBox.x - desktopSectionBox.x) < 2)
    assert.ok(Math.abs(desktopEditorBox.width - desktopSectionBox.width) < 2)
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
    assert.equal(page.url(), siteAddress.origin + '/playground')
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
      await examplePage.locator('[data-playground-monaco] .monaco-editor').waitFor()
      await examplePage.locator('[data-playground-source]').waitFor({ state: 'hidden' })
      assert.equal(await examplePage.locator('[data-playground-example]').inputValue(), exampleId)
      const exampleSource = await examplePage.locator('[data-playground-source]').inputValue()
      assert.match(
        exampleSource,
        new RegExp(
          `export function ${exampleId === 'svg' ? 'SvgExample' : exampleId[0].toUpperCase() + exampleId.slice(1)}`,
        ),
      )
      await waitForEditorToken(examplePage, 'export')
      const exampleTokens = await readEditorTokens(examplePage)
      assert.ok(exampleTokens.some((token) => token.text === 'export'))
      assert.ok(
        exampleTokens.some((token) => token.text.startsWith('// 公式文書とPlaygroundが共有する')),
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
    await duplicatePage.goto(`${siteAddress.origin}/playground`, { waitUntil: 'networkidle' })
    await waitForText(duplicatePage.locator('[data-playground-status]'), '実行できます')
    await duplicatePage.locator('[data-playground-monaco] .monaco-editor').waitFor()
    await duplicatePage.locator('[data-playground-source]').waitFor({ state: 'hidden' })
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
    await waitForEditorToken(duplicatePage, 'export')
    const duplicateTokens = await readEditorTokens(duplicatePage)
    assert.ok(duplicateTokens.some((token) => token.text === 'export'))
    assert.ok(duplicateTokens.some((token) => token.text === 'p'))
    await duplicatePage.close()

    const editorFallbackPage = await context.newPage()
    await editorFallbackPage.route('**/assets/monaco-editor-*.js', (route) => route.abort())
    await editorFallbackPage.goto(`${siteAddress.origin}/playground`, { waitUntil: 'networkidle' })
    await waitForText(editorFallbackPage.locator('[data-playground-status]'), '実行できます')
    const fallbackSource = 'export function Fallback() { render(<p>退避入力</p>) }'
    const fallbackSourceElement = editorFallbackPage.locator('[data-playground-source]')
    assert.equal(await fallbackSourceElement.isVisible(), true)
    assert.match(await fallbackSourceElement.inputValue(), /export function/)
    assert.equal(await editorFallbackPage.locator('.monaco-editor').count(), 0)
    await fillSource(fallbackSourceElement, fallbackSource)
    assert.equal(await fallbackSourceElement.inputValue(), fallbackSource)
    let saveRequests = 0
    await editorFallbackPage.route('**/api/playgrounds', async (route) => {
      saveRequests++
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'fallback-playground',
          url: '/playground/fallback-playground',
          createdAt: '2026-09-15T00:00:00.000Z',
        }),
      })
    })
    await editorFallbackPage.locator('[data-playground-save]').scrollIntoViewIfNeeded()
    await editorFallbackPage.locator('[data-playground-save]').click()
    await waitForText(editorFallbackPage.locator('[data-playground-status]'), '保存しました')
    assert.equal(saveRequests, 1)
    assert.equal(await fallbackSourceElement.inputValue(), fallbackSource)
    const downloadPromise = editorFallbackPage.waitForEvent('download')
    await editorFallbackPage.locator('[data-playground-export]').scrollIntoViewIfNeeded()
    await editorFallbackPage.locator('[data-playground-export]').click()
    const download = await downloadPromise
    assert.equal(download.suggestedFilename(), 'irisout-playground-share.json')
    const downloadPath = await download.path()
    assert.ok(downloadPath)
    const exported = JSON.parse(await readFile(downloadPath, 'utf8'))
    assert.equal(exported.source, fallbackSource)
    await editorFallbackPage.unroute('**/api/playgrounds')
    await editorFallbackPage.close()

    const languageFallbackPage = await context.newPage()
    await languageFallbackPage.route('**/assets/tsMode-*.js', (route) => route.abort())
    await languageFallbackPage.goto(`${siteAddress.origin}/playground`, {
      waitUntil: 'networkidle',
    })
    await waitForText(languageFallbackPage.locator('[data-playground-status]'), '実行できます')
    const languageFallbackSource = languageFallbackPage.locator('[data-playground-source]')
    assert.equal(await languageFallbackSource.isVisible(), true)
    assert.match(await languageFallbackSource.inputValue(), /export function/)
    assert.equal(await languageFallbackPage.locator('.monaco-editor').count(), 0)
    await languageFallbackPage.close()

    buildSite(siteAddress.origin)
    const sameHostPage = await context.newPage()
    await sameHostPage.goto(`${siteAddress.origin}/playground`, { waitUntil: 'networkidle' })
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
    await missingConfigPage.goto(`${siteAddress.origin}/playground`, { waitUntil: 'networkidle' })
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
