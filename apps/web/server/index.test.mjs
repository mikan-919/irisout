// 本番入口相当のBunサーバーを実接続し、配信元の境界と文書URLを確認する。
// 公式Originだけが保存APIを持ち、実行管理専用資産は公式静的経路から見えないことを検査する。

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import { createServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'bun:test'
import { createPlaygroundServer } from '../scripts/playground-server.mjs'
import { createManagementKey, createRequestId } from '../src/playground/shared.js'
import { decodeRequestPath } from './static-files.mjs'

const webRoot = path.resolve(import.meta.dirname, '..')
const distRoot = path.join(webRoot, 'dist')

test('本番Webサーバーの公式Originと実行管理Originを分離する', async () => {
  const port = await reservePort()
  const officialOrigin = `http://127.0.0.1:${port}`
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'irisout-web-server-'))
  const production = startProductionServer({ port, officialOrigin, dataDirectory })
  const controller = createPlaygroundServer({
    root: distRoot,
    kind: 'controller',
    host: 'localhost',
    port: 0,
    officialOrigin,
  })

  try {
    await production.ready
    const controllerAddress = await controller.listen()

    assert.equal((await fetch(`${officialOrigin}/playground-controller.html`)).status, 404)

    const controllerHtmlResponse = await fetch(
      `${controllerAddress.origin}/playground-controller.html`,
    )
    assert.equal(controllerHtmlResponse.status, 200)
    assertControllerHeaders(controllerHtmlResponse, officialOrigin)
    const controllerHtml = await controllerHtmlResponse.text()
    const controllerEntry = controllerHtml.match(/(?:src|href)="(\/assets\/controller\/[^"']+)"/g)
    assert.ok(controllerEntry?.length, 'controller固有資産の参照がありません')
    const controllerEntryPath = /(?:src|href)="([^"]+)"/.exec(controllerEntry[0])?.[1]
    assert.ok(controllerEntryPath)

    const controllerScript = await (
      await fetch(`${controllerAddress.origin}${controllerEntryPath}`)
    ).text()
    const workerPath = controllerScript.match(
      /\/assets\/controller\/compiler\.worker-[^"'`]+\.js/,
    )?.[0]
    assert.ok(workerPath, 'controllerからWorkerへの専用資産参照がありません')

    const dedicatedPaths = [
      ...new Set([
        ...controllerEntry.map((value) => /(?:src|href)="([^"]+)"/.exec(value)?.[1]),
        workerPath,
        ...(controllerScript.match(/\/assets\/controller\/[^"'`]+\.js/g) ?? []),
      ]),
    ].filter(Boolean)
    for (const assetPath of dedicatedPaths) {
      const officialResponse = await fetch(`${officialOrigin}${assetPath}`)
      assert.equal(officialResponse.status, 404, `公式Originで専用資産が取得できます: ${assetPath}`)
      const controllerResponse = await fetch(`${controllerAddress.origin}${assetPath}`)
      assert.equal(
        controllerResponse.status,
        200,
        `controller Originで取得できません: ${assetPath}`,
      )
      assertControllerHeaders(controllerResponse, officialOrigin)
    }

    // 経路を二重化・符号化しても、controller専用資産を公式Originへ漏らさない。
    for (const assetPath of [
      workerPath.replace('/assets/controller/', '/assets//controller/'),
      workerPath.replace('/assets/controller/', '/assets/%2fcontroller/'),
      workerPath.replace('/assets/controller/', '/assets/%2Fcontroller/'),
    ]) {
      assert.equal((await rawGet(officialOrigin, assetPath)).statusCode, 404, assetPath)
    }
    assert.equal((await rawGet(officialOrigin, '/assets/%ZZ')).statusCode, 400)
    assert.notEqual(
      (await rawGet(officialOrigin, '/assets/controller/%2e%2e/app.js')).statusCode,
      200,
    )

    const home = await fetch(officialOrigin)
    assert.equal(home.status, 200)
    const homeHtml = await home.text()
    assert.doesNotMatch(homeHtml, /data-playground-root/)
    assert.doesNotMatch(homeHtml, /irisout-html/)
    assert.match(homeHtml, /<main>/)
    assert.match(homeHtml, /href="\/playground"/)

    for (const [pathname, routeId] of [
      ['/playground', '/playground'],
      ['/examples', '/examples'],
      ['/examples/bcf-copy-button', '/examples/bcf-copy-button'],
      ['/examples/task-board', '/examples/task-board'],
      ['/examples/morph-bcf', '/examples/morph-bcf'],
    ]) {
      const navigation = await fetch(`${officialOrigin}${pathname}`, {
        headers: { 'X-Irisout-Navigation': '1', accept: 'application/json' },
      })
      assert.equal(navigation.status, 200, pathname)
      const body = await navigation.json()
      assert.equal(body.type, 'page', pathname)
      assert.equal(body.routeId, routeId, pathname)
      assert.match(body.html, /<(?:div|main)/, pathname)
    }

    const playground = await fetch(`${officialOrigin}/playground`)
    assert.equal(playground.status, 200)
    const playgroundHtml = await playground.text()
    assert.match(playgroundHtml, /data-playground-root/)
    assert.match(playgroundHtml, /<title>Playground — irisout<\/title>/)
    assert.doesNotMatch(playgroundHtml, /data-playground-page|irisout — compile the interface/)
    assert.match(playgroundHtml, /data-playground-run/)
    assert.match(playgroundHtml, /data-playground-save/)
    assert.match(playgroundHtml, /data-playground-export/)

    const playgroundExample = await fetch(`${officialOrigin}/playground?example=list`)
    assert.equal(playgroundExample.status, 200)
    assert.match(await playgroundExample.text(), /data-playground-root/)
    const playgroundRedirect = await fetch(`${officialOrigin}/playground/?example=list`, {
      redirect: 'manual',
    })
    assert.equal(playgroundRedirect.status, 308)
    assert.equal(playgroundRedirect.headers.get('location'), '/playground?example=list')

    const examples = await fetch(`${officialOrigin}/examples`)
    assert.equal(examples.status, 200)
    assert.match(await examples.text(), /BCF Copy Button/)
    const bcfExample = await fetch(`${officialOrigin}/examples/bcf-copy-button`)
    assert.equal(bcfExample.status, 200)
    const bcfHtml = await bcfExample.text()
    assert.match(bcfHtml, /id="app"/)
    assert.match(bcfHtml, /data-irisout-route-id="\/examples\/bcf-copy-button"/)
    const morphBcfExample = await fetch(`${officialOrigin}/examples/morph-bcf`)
    assert.equal(morphBcfExample.status, 200)
    assert.match(await morphBcfExample.text(), /data-irisout-route-id="\/examples\/morph-bcf"/)
    const taskBoardExample = await fetch(`${officialOrigin}/examples/task-board`)
    assert.equal(taskBoardExample.status, 200)
    assert.match(await taskBoardExample.text(), /data-irisout-route-id="\/examples\/task-board"/)
    const examplesRedirect = await fetch(`${officialOrigin}/examples/?q=1`, {
      redirect: 'manual',
    })
    assert.equal(examplesRedirect.status, 308)
    assert.equal(examplesRedirect.headers.get('location'), '/examples?q=1')

    const input = {
      schemaVersion: 1,
      title: '本番入口',
      description: '',
      source: 'export function App() { render(<p>ok</p>) }',
      compilerVersion: '0.2.2',
      visibility: 'unlisted',
      requestId: createRequestId(),
    }
    const managementKey = createManagementKey()
    const saveHeaders = {
      origin: officialOrigin,
      authorization: `Bearer ${managementKey}`,
      'content-type': 'application/json',
    }
    const officialSave = await fetch(`${officialOrigin}/api/playgrounds`, {
      method: 'POST',
      headers: saveHeaders,
      body: JSON.stringify(input),
    })
    assert.equal(officialSave.status, 201)
    assert.match((await officialSave.json()).url, /\/playground\/[A-Za-z0-9_-]{22}$/)

    const controllerApi = await fetch(`${controllerAddress.origin}/api/playgrounds`, {
      method: 'POST',
      headers: saveHeaders,
      body: JSON.stringify(input),
    })
    assert.equal(controllerApi.status, 404)

    const docs = await fetch(`${officialOrigin}/docs`)
    assert.equal(docs.status, 200)
    assert.match(await docs.text(), /<title>/)
    const detail = await fetch(`${officialOrigin}/docs/getting-started`)
    assert.equal(detail.status, 200)
    assert.match(await detail.text(), /getting-started|導入/)

    const docsRedirect = await fetch(`${officialOrigin}/docs/`, { redirect: 'manual' })
    assert.equal(docsRedirect.status, 308)
    assert.equal(docsRedirect.headers.get('location'), '/docs')
    const detailRedirect = await fetch(`${officialOrigin}/docs/getting-started/?q=1`, {
      redirect: 'manual',
    })
    assert.equal(detailRedirect.status, 308)
    assert.equal(detailRedirect.headers.get('location'), '/docs/getting-started?q=1')

    assert.equal((await fetch(`${officialOrigin}/docs/missing`)).status, 404)
    assert.equal((await fetch(`${officialOrigin}/docs/missing/`)).status, 404)
    assert.equal((await rawGet(officialOrigin, '/docs/%252e%252e/index.html')).statusCode, 404)
    assert.equal(
      (await rawGet(officialOrigin, '/docs/%2e%2e/server/playground-page.js')).statusCode,
      404,
    )
    assert.equal((await rawGet(officialOrigin, '/docs/%ZZ')).statusCode, 400)
    assert.throws(() => decodeRequestPath('/docs/%2e%2e/index.html'), /path traversal/)
  } finally {
    await controller.close()
    await stopProductionServer(production)
    await rm(dataDirectory, { recursive: true, force: true })
  }
})

function assertControllerHeaders(response, officialOrigin) {
  assert.match(
    response.headers.get('content-security-policy') ?? '',
    new RegExp(`frame-ancestors ${escapeRegExp(officialOrigin)}(?:;|$)`),
  )
  assert.equal(
    response.headers.get('permissions-policy'),
    'camera=(), geolocation=(), microphone=()',
  )
  assert.ok(response.headers.get('cross-origin-resource-policy'))
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function rawGet(origin, pathname) {
  const url = new URL(origin)
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: pathname,
        method: 'GET',
      },
      (response) => {
        response.resume()
        response.once('end', () => resolve(response))
      },
    )
    request.once('error', reject)
    request.end()
  })
}

async function reservePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('試験用ポートを取得できません')
  const port = address.port
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  return port
}

function startProductionServer({ port, officialOrigin, dataDirectory }) {
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: webRoot,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      IRISOUT_SITE_ORIGIN: officialOrigin,
      IRISOUT_PLAYGROUND_DATA: dataDirectory,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Bunサーバーの起動を待てませんでした: ${output}`)),
      10_000,
    )
    const onData = (chunk) => {
      output += chunk.toString()
      if (!output.includes(`irisout web server: ${officialOrigin}`)) return
      clearTimeout(timer)
      resolve()
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', (chunk) => {
      output += chunk.toString()
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      if (code !== null) {
        clearTimeout(timer)
        reject(new Error(`Bunサーバーが終了しました(${code}): ${output}`))
      }
    })
  })
  return { child, ready }
}

async function stopProductionServer(production) {
  if (production.child.exitCode !== null) return
  production.child.kill('SIGTERM')
  await new Promise((resolve) => production.child.once('exit', resolve))
}
