import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openDatabase(filename: string): Database.Database {
  mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS generations (
      id TEXT PRIMARY KEY, category TEXT NOT NULL, endpoint TEXT NOT NULL, model_id TEXT,
      request_hash TEXT NOT NULL, status TEXT NOT NULL, remote_id TEXT, cost_estimate REAL,
      cost_observed REAL, file_path TEXT, error_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS generations_created_at ON generations(created_at);
    CREATE TABLE IF NOT EXISTS generation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, generation_id TEXT NOT NULL REFERENCES generations(id),
      state TEXT NOT NULL, details_json TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS media_assets (
      id TEXT PRIMARY KEY, category TEXT NOT NULL, path TEXT NOT NULL UNIQUE, sha256 TEXT NOT NULL,
      mime_type TEXT NOT NULL, metadata_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS credit_reservations (
      id TEXT PRIMARY KEY, generation_id TEXT NOT NULL REFERENCES generations(id),
      amount REAL, state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS local_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS remote_jobs (
      id TEXT PRIMARY KEY, generation_id TEXT NOT NULL REFERENCES generations(id), remote_id TEXT,
      status TEXT NOT NULL, resource_type TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, datetime('now'));
  `);
  return db;
}
