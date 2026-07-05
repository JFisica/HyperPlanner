const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  notes TEXT DEFAULT '',
  capacity REAL DEFAULT 10
);
CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS person_skills (
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (person_id, skill_id)
);
CREATE TABLE IF NOT EXISTS milestones (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  due_date TEXT,
  sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  milestone_id INTEGER REFERENCES milestones(id) ON DELETE SET NULL,
  estimate_hours REAL DEFAULT 1,
  status TEXT DEFAULT 'backlog',
  assignee_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  assigned_date TEXT,
  is_critical INTEGER DEFAULT 0,
  location TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS task_skills (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, skill_id)
);
CREATE TABLE IF NOT EXISTS task_deps (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_task_id)
);
CREATE TABLE IF NOT EXISTS capacity_overrides (
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  hours REAL NOT NULL,
  PRIMARY KEY (person_id, date)
);
`);

module.exports = db;
