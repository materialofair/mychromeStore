import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";

export function openDatabase(path: string) {
  if (path !== ":memory:")
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  if (path !== ":memory:") chmodSync(path, 0o600);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('viewer','developer','reviewer','admin')),
      disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      csrf TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS extensions (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), key TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY, extension_id TEXT NOT NULL REFERENCES extensions(id),
      name TEXT NOT NULL, version TEXT NOT NULL, description TEXT NOT NULL,
      submitter_id TEXT NOT NULL REFERENCES users(id), reviewer_id TEXT REFERENCES users(id),
      status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','unpublished')),
      created_at TEXT NOT NULL, reviewed_at TEXT, reason TEXT,
      permissions TEXT NOT NULL, release TEXT NOT NULL, zip BLOB NOT NULL,
      UNIQUE(extension_id,version)
    );
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT REFERENCES users(id),
      action TEXT NOT NULL, target_id TEXT NOT NULL, created_at TEXT NOT NULL, detail TEXT NOT NULL
    );
  `);
  return db;
}
export function transaction<T>(db: DatabaseSync, callback: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function audit(
  db: DatabaseSync,
  actor: string | null,
  action: string,
  target: string,
  detail = "",
) {
  db.prepare(
    "INSERT INTO audit(actor_id,action,target_id,created_at,detail) VALUES(?,?,?,?,?)",
  ).run(actor, action, target, new Date().toISOString(), detail);
}
