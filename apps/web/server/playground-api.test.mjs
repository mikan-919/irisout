// 共有保存APIの入力、再送、削除、障害境界を確認する。
// 投稿sourceをコンパイラへ渡していないため、副作用文字列もそのまま保存する。

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, test } from 'bun:test'
import { createPlaygroundApi, createPlaygroundOgp } from './playground-api.mjs'
import { PlaygroundStore } from './playground-store.mjs'
import { createManagementKey, createRequestId } from '../src/playground/shared.js'

const officialOrigin = 'https://irisout.example'
const openStores = []
const temporaryDirectories = []

afterEach(async () => {
  for (const store of openStores.splice(0)) store.close()
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

describe('playground save API', () => {
  test('保存、同一要求の再送、入力競合、管理鍵削除を扱う', async () => {
    const { api, store } = await createFixture()
    const deleteToken = createManagementKey()
    const input = makeInput({ title: '  Counter  ' })

    const first = await save(api, input, deleteToken)
    assert.equal(first.status, 201)
    const created = await first.json()
    assert.match(created.id, /^[A-Za-z0-9_-]{22}$/)
    assert.equal(created.url, `${officialOrigin}/playground/${created.id}`)
    assert.equal(JSON.stringify(created).includes(deleteToken), false)
    const ogp = createPlaygroundOgp(store.findById(created.id), officialOrigin)
    assert.deepEqual(Object.keys(ogp).sort(), ['description', 'image', 'title', 'url'])
    assert.equal(ogp.image, `${officialOrigin}/og-image.webp`)
    assert.equal(JSON.stringify(ogp).includes(deleteToken), false)

    const retry = await save(api, input, deleteToken)
    assert.equal(retry.status, 200)
    assert.deepEqual(await retry.json(), created)

    const conflict = await save(api, { ...input, title: '別の題名' }, deleteToken)
    assert.equal(conflict.status, 409)
    assert.equal(store.findById(created.id).title, 'Counter')

    const wrongRetry = await save(api, input, createManagementKey())
    assert.equal(wrongRetry.status, 404)

    const wrongDelete = await remove(api, created.id, createManagementKey())
    assert.equal(wrongDelete.status, 404)
    const deleted = await remove(api, created.id, deleteToken)
    assert.equal(deleted.status, 204)
    assert.equal(store.findById(created.id), null)
    const deletedRetry = await save(api, input, deleteToken)
    assert.equal(deletedRetry.status, 410)
    assert.equal((await remove(api, created.id, deleteToken)).status, 204)
  })

  test('サーバー再起動後も保存値を読み、削除後は表示値を消す', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'irisout-playground-'))
    temporaryDirectories.push(directory)
    const databasePath = path.join(directory, 'playgrounds.sqlite')
    const firstStore = new PlaygroundStore(databasePath)
    openStores.push(firstStore)
    const firstApi = createPlaygroundApi({ store: firstStore, officialOrigin })
    const token = createManagementKey()
    const input = makeInput()
    const created = await (await save(firstApi, input, token)).json()
    firstStore.close()
    openStores.splice(openStores.indexOf(firstStore), 1)

    const restarted = new PlaygroundStore(databasePath)
    openStores.push(restarted)
    assert.equal(restarted.findById(created.id).source, input.source)
    const deleted = await remove(
      createPlaygroundApi({ store: restarted, officialOrigin }),
      created.id,
      token,
    )
    assert.equal(deleted.status, 204)
    const rawDatabase = await readFile(databasePath)
    assert.ok(rawDatabase.byteLength > 0)
    assert.equal(restarted.findById(created.id), null)
  })

  test('未知項目、Origin、本文形式、上限、版を拒否する', async () => {
    const { api } = await createFixture()
    const token = createManagementKey()
    const input = makeInput()
    assert.equal((await save(api, { ...input, extra: true }, token)).status, 422)
    assert.equal((await save(api, input, token, { origin: 'https://evil.example' })).status, 403)
    assert.equal(
      (
        await api.handle(
          new Request('https://irisout.example/api/playgrounds', {
            method: 'POST',
            headers: {
              origin: officialOrigin,
              authorization: `Bearer ${token}`,
              'content-type': 'text/plain',
            },
            body: '{}',
          }),
        )
      ).status,
      415,
    )
    assert.equal((await save(api, { ...input, source: 'あ'.repeat(65_537) }, token)).status, 413)
    assert.equal(
      (await save(api, { ...input, description: 'あ'.repeat(1_001) }, token)).status,
      422,
    )
    assert.equal(
      (await save(api, { ...input, compilerVersion: 'https://evil.example/compiler' }, token))
        .status,
      422,
    )
    assert.equal((await save(api, { ...input, schemaVersion: 2 }, token)).status, 422)
  })

  test('本文128 KiB、UTF-8文字数、頻度制限、保存先停止を扱う', async () => {
    const { api, store } = await createFixture({
      limits: { savePerMinute: 1, savePerDay: 1 },
    })
    const token = createManagementKey()
    const input = makeInput({ title: 'あ'.repeat(120), description: 'い'.repeat(1_000) })
    const first = await save(api, input, token)
    assert.equal(first.status, 201)
    const limited = await save(api, makeInput(), createManagementKey())
    assert.equal(limited.status, 429)
    assert.ok(Number(limited.headers.get('retry-after')) >= 1)

    api.resetRateLimits()
    const oversized = 'x'.repeat(130_000)
    const oversizedResponse = await save(
      api,
      makeInput({ source: oversized }),
      createManagementKey(),
    )
    assert.equal(oversizedResponse.status, 413)

    api.resetRateLimits()
    store.close()
    openStores.splice(openStores.indexOf(store), 1)
    const unavailable = await save(api, makeInput(), createManagementKey())
    assert.equal(unavailable.status, 503)
  })

  test('利用者入力のX-Forwarded-Forで頻度制限を回避できない', async () => {
    const { api } = await createFixture({
      limits: { savePerMinute: 1, savePerDay: 1 },
    })
    const first = await save(api, makeInput(), createManagementKey(), {
      clientAddress: '192.0.2.10',
      forwardedFor: '198.51.100.10',
    })
    assert.equal(first.status, 201)
    const second = await save(api, makeInput(), createManagementKey(), {
      clientAddress: '192.0.2.10',
      forwardedFor: '203.0.113.10',
    })
    assert.equal(second.status, 429)
  })

  test('接続元が未取得でも全利用者をunknownへ集約しない', async () => {
    const { api } = await createFixture({
      limits: { savePerMinute: 1, savePerDay: 1 },
    })
    assert.equal(
      (await save(api, makeInput(), createManagementKey(), { clientAddress: null })).status,
      201,
    )
    assert.equal(
      (await save(api, makeInput(), createManagementKey(), { clientAddress: null })).status,
      201,
    )
  })

  test('副作用を含むsourceをサーバーで実行しない', async () => {
    const { api, store } = await createFixture()
    const marker = path.join(await mkdtemp(path.join(os.tmpdir(), 'irisout-side-effect-')), 'ran')
    const source = `export function App() { signal((globalThis.__sideEffect = ${JSON.stringify(marker)})); render(<p>保存</p>) }`
    const token = createManagementKey()
    const response = await save(api, makeInput({ source }), token)
    assert.equal(response.status, 201)
    const created = await response.json()
    assert.equal(store.findById(created.id).source, source)
    await assert.rejects(readFile(marker))
    assert.equal(
      JSON.stringify(createPlaygroundOgp(store.findById(created.id), officialOrigin)).includes(
        source,
      ),
      false,
    )
  })
})

async function createFixture(options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'irisout-playground-'))
  temporaryDirectories.push(directory)
  const store = new PlaygroundStore(path.join(directory, 'playgrounds.sqlite'))
  openStores.push(store)
  return {
    store,
    api: createPlaygroundApi({ store, officialOrigin, ...options }),
  }
}

function makeInput(overrides = {}) {
  return {
    schemaVersion: 1,
    title: 'Counter',
    description: '例',
    source: 'export function App() { render(<p>ok</p>) }',
    compilerVersion: '0.3.0',
    visibility: 'unlisted',
    requestId: createRequestId(),
    ...overrides,
  }
}

function save(api, input, token, options = {}) {
  const headers = {
    origin: options.origin ?? officialOrigin,
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  }
  if (options.forwardedFor) headers['x-forwarded-for'] = options.forwardedFor
  return api.handle(
    new Request(`${officialOrigin}/api/playgrounds`, {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    }),
    {
      clientAddress: Object.hasOwn(options, 'clientAddress') ? options.clientAddress : '192.0.2.1',
    },
  )
}

function remove(api, id, token) {
  return api.handle(
    new Request(`${officialOrigin}/api/playgrounds/${id}`, {
      method: 'DELETE',
      headers: {
        origin: officialOrigin,
        authorization: `Bearer ${token}`,
      },
    }),
  )
}
