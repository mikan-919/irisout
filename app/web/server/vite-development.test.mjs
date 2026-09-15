import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'bun:test'
import * as irisoutRuntime from 'irisout/runtime'
import config, { playgroundDevelopmentRedirect } from '../vite.config.ts'
import * as playgroundRuntime from '../src/playground/runtime.js'

test('開発用Playgroundの経路と実行時処理を接続する', () => {
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
  assert.equal(playgroundRequest.url, '/?example=list')
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

function response(setHeader = () => {}) {
  return { setHeader, end() {}, statusCode: 200 }
}
