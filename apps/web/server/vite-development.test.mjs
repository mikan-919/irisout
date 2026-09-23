import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'bun:test'
import { compileProject } from 'irisout'
import * as irisoutRuntime from 'irisout/runtime'
import config, {
  playgroundDevelopmentProxy,
  playgroundDevelopmentRedirect,
  playgroundDevelopmentCsp,
  playgroundSaveApi,
} from '../vite.config.ts'
import * as playgroundRuntime from '../src/playground/runtime.js'

test('開発用Playgroundの経路と実行時処理を接続する', () => {
  const developmentCsp = playgroundDevelopmentCsp('http://127.0.0.1:5173', 'http://localhost:5174')
  assert.match(developmentCsp, /style-src 'self' 'unsafe-inline'/)
  assert.match(developmentCsp, /connect-src 'self' ws:\/\/localhost:5174/)
  assert.equal(
    playgroundDevelopmentRedirect(
      'site',
      'http://127.0.0.1:5173',
      'localhost:5173',
      '/playground?example=list',
    ),
    'http://127.0.0.1:5173/playground?example=list',
  )
  assert.equal(
    playgroundDevelopmentRedirect(
      'controller',
      'http://127.0.0.1:5173',
      'localhost:5174',
      '/playground-controller.html',
    ),
    null,
  )
  assert.deepEqual(playgroundDevelopmentProxy('controller', 'http://127.0.0.1:5173'), {
    '/docs': 'http://127.0.0.1:5173',
  })

  const plugin = config.plugins.find((candidate) => candidate.name === 'irisout-playground-headers')
  assert.ok(plugin)

  let middleware
  plugin.configureServer({
    middlewares: {
      use(candidate) {
        middleware = candidate
      },
    },
  })
  assert.equal(typeof middleware, 'function')

  const playgroundRequest = { url: '/playground?example=list' }
  let playgroundNext = false
  middleware(playgroundRequest, response(), () => {
    playgroundNext = true
  })
  assert.equal(playgroundRequest.url, '/playground?example=list')
  assert.equal(playgroundNext, true)

  const runtimePaths = [
    '/src/playground/runtime.js',
    `/@fs${path.resolve(import.meta.dirname, '../../../packages/irisout/dist/runtime.js')}`,
    '/node_modules/.vite-controller/deps/irisout_runtime.js',
  ]
  for (const runtimePath of runtimePaths) {
    const headers = new Map()
    middleware(
      { url: runtimePath },
      response((name, value) => headers.set(name.toLowerCase(), value)),
      () => {},
    )
    assert.equal(headers.get('access-control-allow-origin'), '*', runtimePath)
    assert.equal(headers.get('cross-origin-resource-policy'), 'cross-origin', runtimePath)
  }

  assert.deepEqual(
    Object.keys(playgroundRuntime)
      .filter((name) => name !== 'runtimeUrl')
      .sort(),
    Object.keys(irisoutRuntime).sort(),
  )
})

test('Playground生成moduleは開発時に未変換のimport.meta.envを実行しない', () => {
  const result = compileProject(path.resolve(import.meta.dirname, '../routes/playground/page.tsx'))
  assert.doesNotMatch(result.code, /import\.meta/)
})

test('開発用公式Originは保存APIを持ち、実行管理Originは持たない', async () => {
  const plugin = playgroundSaveApi()
  let middleware
  plugin.configResolved({
    root: path.resolve(import.meta.dirname, '..'),
    env: {},
  })
  plugin.configureServer({
    config: { server: { https: false } },
    middlewares: {
      use(candidate) {
        middleware = candidate
      },
    },
  })
  assert.equal(typeof middleware, 'function')

  const input = {
    schemaVersion: 1,
    title: '開発用',
    description: '',
    source: 'export function App() { render(<p />) }',
    compilerVersion: '0.2.2',
    visibility: 'unlisted',
    requestId: '123e4567-e89b-42d3-a456-426614174003',
  }
  const token = 'a'.repeat(43)
  const first = await callMiddleware(middleware, {
    method: 'POST',
    url: '/api/playgrounds',
    body: input,
    token,
  })
  assert.equal(first.statusCode, 201)
  const saved = JSON.parse(first.body)

  const retry = await callMiddleware(middleware, {
    method: 'POST',
    url: '/api/playgrounds',
    body: input,
    token,
  })
  assert.equal(retry.statusCode, 200)
  assert.equal(JSON.parse(retry.body).id, saved.id)

  const previousRole = process.env.IRISOUT_PLAYGROUND_DEV_ROLE
  process.env.IRISOUT_PLAYGROUND_DEV_ROLE = 'controller'
  try {
    const controllerPlugin = playgroundSaveApi()
    let controllerMiddleware
    controllerPlugin.configureServer({
      config: { server: { https: false } },
      middlewares: {
        use(candidate) {
          controllerMiddleware = candidate
        },
      },
    })
    assert.equal(controllerMiddleware, undefined)
  } finally {
    if (previousRole === undefined) delete process.env.IRISOUT_PLAYGROUND_DEV_ROLE
    else process.env.IRISOUT_PLAYGROUND_DEV_ROLE = previousRole
  }
})

function response(setHeader = () => {}) {
  return { setHeader, end() {}, statusCode: 200 }
}

async function callMiddleware(middleware, { method, url, body, token }) {
  const result = { statusCode: 200, headers: new Map(), body: '' }
  const request = {
    method,
    url,
    headers: {
      host: '127.0.0.1:5173',
      origin: 'http://127.0.0.1:5173',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body))
    },
  }
  const output = {
    get statusCode() {
      return result.statusCode
    },
    set statusCode(value) {
      result.statusCode = value
    },
    setHeader(name, value) {
      result.headers.set(name, value)
    },
    end(value) {
      result.body = Buffer.from(value ?? '').toString()
    },
  }
  await middleware(request, output, () => {
    throw new Error('保存APIが要求を処理しませんでした')
  })
  return result
}
