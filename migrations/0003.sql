CREATE TABLE gemini_post_cache (
  source_hash TEXT PRIMARY KEY,
  rows_json TEXT NOT NULL,
  cached_at INTEGER NOT NULL DEFAULT (unixepoch())
);
