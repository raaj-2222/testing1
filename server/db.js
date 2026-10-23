import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// Use DB_PATH=/data/cabshare.sqlite on a hosting volume; local runs use ./data.
// Keep the SQLite database outside the container's temporary filesystem in production.
const dbPath = path.resolve(process.env.DB_PATH || path.join(process.cwd(), 'data', 'cabshare.sqlite'));
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
export const db = new DatabaseSync(dbPath, { timeout: 5000 });

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS verification_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ride_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_date TEXT NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('to_vjti','to_dadar')),
    anchor_minutes INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'Open' CHECK(status IN ('Open', 'Full', 'Completed')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS trips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id INTEGER REFERENCES ride_groups(id) ON DELETE SET NULL,
    trip_date TEXT NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('to_vjti','to_dadar')),
    time_minutes INTEGER NOT NULL CHECK(time_minutes >= 0 AND time_minutes < 1440),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, trip_date, direction, time_minutes)
  );
  CREATE INDEX IF NOT EXISTS idx_trips_date_direction ON trips(trip_date, direction, time_minutes);
  CREATE INDEX IF NOT EXISTS idx_trips_group ON trips(group_id);
  CREATE INDEX IF NOT EXISTS idx_groups_route ON ride_groups(trip_date, direction, anchor_minutes);
`);

// DatabaseSync is synchronous: wrap related writes in a transaction so another
// request cannot insert a fifth passenger partway through a join operation.
export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = fn();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function refreshGroup(groupId) {
  const row = db.prepare('SELECT status FROM ride_groups WHERE id=?').get(groupId);
  if (!row || row.status === 'Completed') return;
  const count = db.prepare('SELECT COUNT(*) AS n FROM trips WHERE group_id=?').get(groupId).n;
  if (!count) db.prepare('DELETE FROM ride_groups WHERE id=?').run(groupId);
  else db.prepare('UPDATE ride_groups SET status=? WHERE id=?')
    .run(count === 4 ? 'Full' : 'Open', groupId);
}
