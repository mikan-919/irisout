import assert from 'node:assert/strict'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'bun:test'
import { applyDeletionLog, writeDeletionLog } from './playground-backup.mjs'
import { PlaygroundStore } from './playground-store.mjs'

test('ローカルSQLite復元後に削除記録を再適用する', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'irisout-playground-backup-'))
  const databasePath = path.join(directory, 'playgrounds.sqlite')
  const backupPath = path.join(directory, 'backup.sqlite')
  const restoredPath = path.join(directory, 'restored.sqlite')
  const journalPath = path.join(directory, 'deletions.json')
  const deleteToken = 'a'.repeat(43)
  const input = {
    schemaVersion: 1,
    title: '復元確認',
    description: '',
    source: 'export function App() {}',
    compilerVersion: '0.2.2',
    visibility: 'unlisted',
    requestId: '123e4567-e89b-42d3-a456-426614174000',
  }

  let store = new PlaygroundStore(databasePath)
  const saved = store.save({ input, deleteToken })
  assert.equal(saved.kind, 'created')
  const savedId = saved.id
  store.close()
  await copyFile(databasePath, backupPath)

  store = new PlaygroundStore(databasePath)
  assert.equal(store.delete(savedId, deleteToken), 'deleted')
  await writeDeletionLog(store, journalPath)
  store.close()

  await copyFile(backupPath, restoredPath)
  const restored = new PlaygroundStore(restoredPath)
  assert.ok(restored.findById(savedId))
  const records = await applyDeletionLog(restored, journalPath)
  assert.equal(records.length, 1)
  assert.equal(restored.findById(savedId), null)
  assert.deepEqual(JSON.parse(await readFile(journalPath, 'utf8')), records)
  restored.close()

  await rm(directory, { recursive: true, force: true })
})
