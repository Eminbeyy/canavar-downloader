'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL,
  created_at TEXT NOT NULL, tz TEXT NOT NULL DEFAULT 'UTC', settings TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS profiles(
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  answers TEXT NOT NULL DEFAULT '{}', summary TEXT, onboarded INTEGER NOT NULL DEFAULT 0, updated_at TEXT);
CREATE TABLE IF NOT EXISTS goals(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL, target TEXT, priority INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'active');
CREATE TABLE IF NOT EXISTS plans(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL, end_date TEXT NOT NULL, plan_version INTEGER NOT NULL DEFAULT 1,
  level INTEGER NOT NULL DEFAULT 3, meta TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'active',
  last_adapt_date TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS daily_tasks(
  id INTEGER PRIMARY KEY, plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, date TEXT NOT NULL, key TEXT NOT NULL,
  title TEXT NOT NULL, category TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'habit', priority TEXT NOT NULL DEFAULT 'med',
  minutes INTEGER, optional INTEGER NOT NULL DEFAULT 0, is_min INTEGER NOT NULL DEFAULT 0,
  minimum_version TEXT, note TEXT, completed INTEGER NOT NULL DEFAULT 0, completed_at TEXT,
  UNIQUE(plan_id, date, key));
CREATE INDEX IF NOT EXISTS idx_tasks_user_date ON daily_tasks(user_id, date);
CREATE TABLE IF NOT EXISTS day_state(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, date TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'normal',
  PRIMARY KEY(user_id, date));
CREATE TABLE IF NOT EXISTS checkins(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, date TEXT NOT NULL,
  sleep REAL, energy INTEGER, stress INTEGER, hunger INTEGER, completion REAL, difficulty INTEGER,
  steps INTEGER, weight REAL, note TEXT, created_at TEXT NOT NULL, UNIQUE(user_id, date));
CREATE TABLE IF NOT EXISTS progress_snapshots(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, date TEXT NOT NULL,
  progress INTEGER NOT NULL, category_scores TEXT NOT NULL, UNIQUE(user_id, date));
CREATE TABLE IF NOT EXISTS ai_events(
  id INTEGER PRIMARY KEY, user_id INTEGER, event_type TEXT NOT NULL, model TEXT, source TEXT NOT NULL,
  input_token_estimate INTEGER, output_token_estimate INTEGER, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai_cache(key TEXT PRIMARY KEY, type TEXT NOT NULL, value TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS coach_messages(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reports(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, ref TEXT NOT NULL,
  content TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id, kind, ref));
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY, uid_hash TEXT NOT NULL, name TEXT NOT NULL, day INTEGER, ts TEXT NOT NULL);
`;

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  db.exec(SCHEMA);
  if (file !== ':memory:') { try { fs.chmodSync(file, 0o600); } catch { /* ignore */ } }
  return db;
}

// node:sqlite için küçük yardımcılar
const q = {
  get: (db, sql, ...p) => db.prepare(sql).get(...p),
  all: (db, sql, ...p) => db.prepare(sql).all(...p),
  run: (db, sql, ...p) => db.prepare(sql).run(...p),
  tx(db, fn) {
    db.exec('BEGIN');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  },
};
module.exports = { open, q };
