// Cloudflare D1へ共有Playgroundを保存する。
// Bun版と同じ保存契約を保ち、投稿JSXは文字列としてだけ扱う。

const ID_BYTES = 16

export class D1PlaygroundStore {
  constructor(database) {
    this.database = database
  }

  async save({ input, deleteToken, now = new Date() }) {
    const requestDigest = await digestInput(input)
    const deleteTokenHash = await hashToken(deleteToken)
    const existing = await this.findByRequestId(input.requestId)
    if (existing) return compareExisting(existing, requestDigest, deleteTokenHash)

    const id = createId()
    const createdAt = now.toISOString()
    const result = await this.database
      .prepare(`
        INSERT INTO playgrounds (
          id, request_id, request_digest, delete_token_hash, schema_version,
          title, description, source, compiler_version, visibility, created_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(request_id) DO NOTHING
      `)
      .bind(
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
      .run()

    if (result.meta.changes === 1) return { kind: 'created', id, createdAt }
    const winner = await this.findByRequestId(input.requestId)
    if (!winner) throw new Error('D1保存結果を読み取れません')
    return compareExisting(winner, requestDigest, deleteTokenHash)
  }

  async findById(id) {
    const row = await this.database
      .prepare(`
        SELECT id, schema_version, title, description, source, compiler_version,
               visibility, created_at, deleted_at
          FROM playgrounds
         WHERE id = ?
      `)
      .bind(id)
      .first()
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

  async delete(id, deleteToken) {
    const tokenHash = await hashToken(deleteToken)
    const row = await this.database
      .prepare('SELECT delete_token_hash, deleted_at FROM playgrounds WHERE id = ?')
      .bind(id)
      .first()
    if (!row || !safeEqualHex(row.delete_token_hash, tokenHash)) return 'not-found'
    if (row.deleted_at !== null) return 'deleted'
    await this.database
      .prepare(`
        UPDATE playgrounds
           SET title = NULL,
               description = NULL,
               source = NULL,
               compiler_version = NULL,
               deleted_at = ?
         WHERE id = ? AND deleted_at IS NULL
      `)
      .bind(new Date().toISOString(), id)
      .run()
    return 'deleted'
  }

  findByRequestId(requestId) {
    return this.database
      .prepare(`
        SELECT id, request_digest, delete_token_hash, created_at, deleted_at
          FROM playgrounds
         WHERE request_id = ?
      `)
      .bind(requestId)
      .first()
  }
}

function compareExisting(existing, requestDigest, deleteTokenHash) {
  if (!safeEqualHex(existing.delete_token_hash, deleteTokenHash)) return { kind: 'not-found' }
  if (existing.deleted_at !== null) return { kind: 'deleted' }
  if (existing.request_digest !== requestDigest) return { kind: 'conflict' }
  return { kind: 'existing', id: existing.id, createdAt: existing.created_at }
}

async function hashToken(token) {
  return sha256Hex(new TextEncoder().encode(token))
}

async function digestInput(input) {
  return sha256Hex(
    new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: input.schemaVersion,
        title: input.title,
        description: input.description,
        source: input.source,
        compilerVersion: input.compilerVersion,
        visibility: input.visibility,
        requestId: input.requestId,
      }),
    ),
  )
}

async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function safeEqualHex(left, right) {
  if (typeof left !== 'string' || left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

function createId() {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_BYTES))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}
