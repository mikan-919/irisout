CREATE TABLE playgrounds (
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

CREATE INDEX playgrounds_created_at_idx ON playgrounds (created_at);
