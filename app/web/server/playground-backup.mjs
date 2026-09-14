// ローカルSQLite復元時に削除記録を再適用する手順を提供する。
// 実運用のバックアップ先は未確定のため、公開済みの復旧機能とは扱わない。
import { readFile, writeFile } from 'node:fs/promises'
import { PlaygroundStore } from './playground-store.mjs'

export async function writeDeletionLog(store, filePath) {
  const records = store.listDeletionRecords()
  await writeFile(filePath, `${JSON.stringify(records, null, 2)}\n`, 'utf8')
  return records
}

export async function applyDeletionLog(store, filePath) {
  const records = JSON.parse(await readFile(filePath, 'utf8'))
  store.applyDeletionRecords(records)
  return records
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const operation = process.argv[2]
  const databasePath = process.env.IRISOUT_PLAYGROUND_DATABASE
  const journalPath = process.env.IRISOUT_PLAYGROUND_DELETION_LOG
  if (!databasePath || !journalPath || !['export', 'apply'].includes(operation)) {
    throw new Error(
      '使い方: IRISOUT_PLAYGROUND_DATABASE=... IRISOUT_PLAYGROUND_DELETION_LOG=... bun playground-backup.mjs export|apply',
    )
  }
  const store = new PlaygroundStore(databasePath)
  try {
    if (operation === 'export') await writeDeletionLog(store, journalPath)
    else await applyDeletionLog(store, journalPath)
  } finally {
    store.close()
  }
}
