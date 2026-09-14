// 共有Playgroundの保存値をSQLiteへ記録する。
// 投稿JSXは文字列として保存し、このモジュールからコンパイラを呼び出さない。

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { Database } from 'bun:sqlite'

const ID_BYTES = 16
const TOKEN_HASH_ALGORITHM = 'sha256'

export class PlaygroundStore {
  constructor(databasePath) {
    this.database = new Database(databasePath, { create: true })
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA secure_delete = ON;
      CREATE TABLE IF NOT EXISTS playgrounds (
        id TEXT PRIMARY KEY NOT NULL,
        request_id TEXT NOT NULL UNIQUE,
        request_digest TEXT NOT NULL,
        delete_token_hash TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        title TEXT,
        description TEXT,
        source TEXT,
        compiler_version TEXT,
        visibility TEXT NOT NULL,
        created_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX IF NOT EXISTS playgrounds_created_at_idx
        ON playgrounds (created_at);
    `)
  }

  close() {
    this.database.close()
  }

  save({ input, deleteToken, now = new Date() }) {
    const requestDigest = digestInput(input)
    const deleteTokenHash = hashToken(deleteToken)
    const existing = this.database
      .query(
        `SELECT id, request_digest, delete_token_hash, created_at, deleted_at
           FROM playgrounds
          WHERE request_id = ?`,
      )
      .get(input.requestId)

    if (existing) {
      if (!safeEqualHex(existing.delete_token_hash, deleteTokenHash)) {
        return { kind: 'not-found' }
      }
      if (existing.deleted_at !== null) {
        return { kind: 'deleted' }
      }
      if (existing.request_digest !== requestDigest) {
        return { kind: 'conflict' }
      }
      return {
        kind: 'existing',
        id: existing.id,
        createdAt: existing.created_at,
      }
    }

    const id = createId()
    const createdAt = now.toISOString()
    const insert = this.database.query(`
      INSERT INTO playgrounds (
        id,
        request_id,
        request_digest,
        delete_token_hash,
        schema_version,
        title,
        description,
        source,
        compiler_version,
        visibility,
        created_at,
        deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `)
    try {
      insert.run(
        id,
        input.requestId,
        requestDigest,
        deleteTokenHash,
        input.schemaVersion,
        input.title,
        input.description,
        input.source,
        input.compilerVersion,
        input.visibility,
        createdAt,
      )
    } catch (error) {
      // 同時再送は一意制約で一件にまとめ、勝者の値を読み直す。
      if (!String(error?.message ?? '').includes('UNIQUE constraint failed')) throw error
      return this.save({ input, deleteToken, now })
    }
    return { kind: 'created', id, createdAt }
  }

  findById(id) {
    const row = this.database
      .query(`
        SELECT id, schema_version, title, description, source, compiler_version,
               visibility, created_at, deleted_at
          FROM playgrounds
         WHERE id = ?
      `)
      .get(id)
    if (!row || row.deleted_at !== null || row.title === null) return null
    return {
      id: row.id,
      schemaVersion: row.schema_version,
      title: row.title,
      description: row.description,
      source: row.source,
      compilerVersion: row.compiler_version,
      visibility: row.visibility,
      createdAt: row.created_at,
    }
  }

  delete(id, deleteToken) {
    const deleteTokenHash = hashToken(deleteToken)
    const deleteTransaction = this.database.transaction((targetId, tokenHash) => {
      const row = this.database
        .query(
          `SELECT delete_token_hash, deleted_at
             FROM playgrounds
            WHERE id = ?`,
        )
        .get(targetId)
      if (!row || !safeEqualHex(row.delete_token_hash, tokenHash)) return 'not-found'
      if (row.deleted_at !== null) return 'deleted'

      this.database
        .query(`
          UPDATE playgrounds
             SET title = NULL,
                 description = NULL,
                 source = NULL,
                 compiler_version = NULL,
                 deleted_at = ?
           WHERE id = ? AND deleted_at IS NULL
        `)
        .run(new Date().toISOString(), targetId)
      return 'deleted'
    })
    return deleteTransaction(id, deleteTokenHash)
  }
}

export function hashToken(token) {
  return createHash(TOKEN_HASH_ALGORITHM).update(token, 'utf8').digest('hex')
}

export function digestInput(input) {
  return createHash(TOKEN_HASH_ALGORITHM)
    .update(
      JSON.stringify({
        schemaVersion: input.schemaVersion,
        title: input.title,
        description: input.description,
        source: input.source,
        compilerVersion: input.compilerVersion,
        visibility: input.visibility,
        requestId: input.requestId,
      }),
      'utf8',
    )
    .digest('hex')
}

function safeEqualHex(left, right) {
  const leftBytes = Buffer.from(left, 'hex')
  const rightBytes = Buffer.from(right, 'hex')
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

function createId() {
  return randomBytes(ID_BYTES).toString('base64url')
}
