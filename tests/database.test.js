// SQLite integration smoke checks: no external packages are required.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cabshare-db-test-'));
process.env.DB_PATH = path.join(workdir, 'db', 'test.sqlite');
const { db, transaction, refreshGroup } = await import('../server/db.js');

test('Creates an SQLite database at the configured persistent path', () => {
  assert.equal(fs.existsSync(process.env.DB_PATH), true);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ride_groups'").get());
});

test('Four riders produce Full status, then leaving reopens the group', () => {
  transaction(() => {
    for (let i = 1; i <= 4; i++) {
      db.prepare('INSERT INTO users(name,email,password_salt,password_hash,verified) VALUES(?,?,?,?,1)')
        .run(`Student ${i}`, `student${i}@vjti.ac.in`, 'salt', 'hash');
    }
    db.prepare('INSERT INTO ride_groups(trip_date,direction,anchor_minutes) VALUES(?,?,?)')
      .run('2026-12-01', 'to_vjti', 540);
    for (let i = 1; i <= 4; i++) {
      db.prepare('INSERT INTO trips(user_id,group_id,trip_date,direction,time_minutes) VALUES(?,?,?,?,?)')
        .run(i, 1, '2026-12-01', 'to_vjti', 539 + i);
    }
    refreshGroup(1);
  });
  assert.equal(db.prepare('SELECT status FROM ride_groups WHERE id=1').get().status, 'Full');
  transaction(() => {
    db.prepare('UPDATE trips SET group_id=NULL WHERE user_id=4').run();
    refreshGroup(1);
  });
  assert.equal(db.prepare('SELECT status FROM ride_groups WHERE id=1').get().status, 'Open');
});

test('Failed transaction rolls back its insert', () => {
  const before = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  assert.throws(() => transaction(() => {
    db.prepare('INSERT INTO users(name,email,password_salt,password_hash) VALUES(?,?,?,?)')
      .run('Temporary', 'temp@vjti.ac.in', 'salt', 'hash');
    throw new Error('Test rollback');
  }), /Test rollback/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, before);
});

test('Delete last member removes empty group', () => {
  transaction(() => {
    db.prepare('DELETE FROM trips WHERE group_id=1').run();
    refreshGroup(1);
  });
  assert.equal(db.prepare('SELECT * FROM ride_groups WHERE id=1').get(), undefined);
});

test.after(() => {
  db.close();
  fs.rmSync(workdir, { recursive: true, force: true });
});
