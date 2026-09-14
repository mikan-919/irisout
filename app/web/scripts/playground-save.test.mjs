// 編集画面の保存再送と管理鍵保持を確認する。
// 通信断でも下書きが残り、同じ入力だけが同じ要求として再送される。

import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { exportSaveBundle, readPendingSave, savePlayground } from '../src/playground/save-share.js'

test('通信断後の再送はrequestIdと管理鍵を保持する', async () => {
  const values = new Map()
  const storage = {
    getItem(key) {
      return values.get(key) ?? null
    },
    setItem(key, value) {
      values.set(key, value)
    },
    removeItem(key) {
      values.delete(key)
    },
  }
  const requests = []
  let attempts = 0
  const fetchImpl = async (_url, options) => {
    requests.push(options)
    attempts += 1
    if (attempts === 1) throw new Error('offline')
    return new Response(
      JSON.stringify({
        id: '1234567890abcdefghijkl',
        url: '/playground/1234567890abcdefghijkl',
        createdAt: '2026-09-14T00:00:00.000Z',
      }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    )
  }
  const input = {
    title: '例',
    description: '説明',
    source: 'export function App() { render(<p />) }',
  }

  await assert.rejects(savePlayground({ ...input, fetchImpl, storage }))
  const pending = readPendingSave(storage)
  assert.equal(typeof pending.managementKey, 'string')
  assert.equal(pending.managementKey.length, 43)
  assert.equal(requests.length, 1)
  const saved = await savePlayground({ ...input, fetchImpl, storage })
  assert.equal(saved.managementKey, pending.managementKey)
  assert.equal(saved.input.requestId, pending.input.requestId)
  assert.equal(requests[1].headers.authorization, `Bearer ${pending.managementKey}`)

  const exported = exportSaveBundle({
    managementKey: saved.managementKey,
    result: saved,
    source: input.source,
  })
  assert.match(exported, new RegExp(saved.managementKey))
  assert.match(exported, /1234567890abcdefghijkl/)
})
