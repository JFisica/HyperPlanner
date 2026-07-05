const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  notes TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
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
-- A task can have several responsible people (set from the backlog or the
-- assignment page). Independent of scheduling: it says nothing about when.
CREATE TABLE IF NOT EXISTS task_assignees (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, person_id)
);
-- Legacy (pre-slots) tables. No longer written to; kept so no history is lost.
CREATE TABLE IF NOT EXISTS task_assignments (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  assigned_date TEXT NOT NULL,
  PRIMARY KEY (task_id, person_id)
);
CREATE TABLE IF NOT EXISTS task_schedule (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  PRIMARY KEY (task_id, date)
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'coordinator',
  created_at TEXT DEFAULT (datetime('now'))
);
-- A slot is a plain (date, start, end) block on the shared calendar; it can
-- optionally hold a task. There is no person_id here: the responsible
-- people are whoever the attached task's task_assignees say they are.
CREATE TABLE IF NOT EXISTS time_slots (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
`);

// ---------- migrations on existing DBs ----------

function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

if (!columnExists('tasks', 'assignee_id')) {
  db.exec('ALTER TABLE tasks ADD COLUMN assignee_id INTEGER REFERENCES people(id) ON DELETE SET NULL');
}

function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
}
function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
}

// One-time backfill: legacy per-task (person, date) assignments + (task, date)
// schedules become standalone time_slots rows (person's calendar, task attached).
function migrateTimeSlots() {
  if (getSetting('migrated_time_slots_v1')) return;
  const assignments = db.prepare('SELECT * FROM task_assignments').all();
  const scheduleByTaskDate = new Map();
  for (const s of db.prepare('SELECT * FROM task_schedule').all()) {
    scheduleByTaskDate.set(`${s.task_id}|${s.date}`, s);
  }
  const insertSlot = db.prepare(
    'INSERT INTO time_slots (date, start_time, end_time, task_id) VALUES (?, ?, ?, ?)'
  );
  const setAssignee = db.prepare('UPDATE tasks SET assignee_id = ? WHERE id = ? AND assignee_id IS NULL');
  const getTask = db.prepare('SELECT estimate_hours FROM tasks WHERE id = ?');

  const tx = db.transaction(() => {
    for (const a of assignments) {
      const sched = scheduleByTaskDate.get(`${a.task_id}|${a.assigned_date}`);
      let startTime = sched ? sched.start_time : '09:00';
      let endTime = sched ? sched.end_time : null;
      if (!endTime) {
        const task = getTask.get(a.task_id);
        const hours = task?.estimate_hours || 1;
        const [h, m] = startTime.split(':').map(Number);
        const total = h * 60 + m + Math.round(hours * 60);
        endTime = `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
      }
      insertSlot.run(a.assigned_date, startTime, endTime, a.task_id);
      setAssignee.run(a.person_id, a.task_id);
    }
    setSetting('migrated_time_slots_v1', '1');
  });
  tx();
  if (assignments.length) {
    console.log(`Migración: ${assignments.length} asignaciones antiguas convertidas a horarios.`);
  }
}
migrateTimeSlots();

// v2 upgrade: time_slots used to belong to a person directly; now the
// responsible person comes from the attached task's assignee_id instead, so
// the calendar is a single shared timeline rather than one column per person.
function migrateDropSlotPersonId() {
  if (!columnExists('time_slots', 'person_id')) return;
  const tx = db.transaction(() => {
    db.exec('ALTER TABLE time_slots RENAME TO time_slots_v1_person');
    db.exec(`
      CREATE TABLE time_slots (
        id INTEGER PRIMARY KEY,
        date TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
    db.exec(`
      INSERT INTO time_slots (id, date, start_time, end_time, task_id, created_at, updated_at)
      SELECT id, date, start_time, end_time, task_id, created_at, updated_at FROM time_slots_v1_person;
    `);
    // A slot's old person_id becomes the task's assignee if the task doesn't have one yet.
    db.exec(`
      UPDATE tasks SET assignee_id = (
        SELECT ts.person_id FROM time_slots_v1_person ts
        WHERE ts.task_id = tasks.id AND ts.person_id IS NOT NULL
        LIMIT 1
      )
      WHERE assignee_id IS NULL AND EXISTS (
        SELECT 1 FROM time_slots_v1_person ts WHERE ts.task_id = tasks.id
      );
    `);
    db.exec('DROP TABLE time_slots_v1_person');
  });
  tx();
  console.log('Migración: los horarios dejan de pertenecer a una persona; el responsable viene de la tarea asignada.');
}
migrateDropSlotPersonId();

// v3 upgrade: a task used to have a single assignee_id column; now it can
// have several people via task_assignees, so a task can be shared by more
// than one person. Fold whatever was in assignee_id into the new table,
// then drop the column.
function migrateAssigneeIdToTaskAssignees() {
  if (!columnExists('tasks', 'assignee_id')) return;
  const tx = db.transaction(() => {
    db.exec(`
      INSERT OR IGNORE INTO task_assignees (task_id, person_id)
      SELECT id, assignee_id FROM tasks WHERE assignee_id IS NOT NULL;
    `);
    db.exec('ALTER TABLE tasks DROP COLUMN assignee_id');
  });
  tx();
  console.log('Migración: una tarea puede tener varias personas asignadas (antes solo una).');
}
migrateAssigneeIdToTaskAssignees();

// Ensure a default admin user always exists.
function ensureDefaultAdmin() {
  const count = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (count > 0) return;
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(username, bcrypt.hashSync(password, 10), 'admin');
  console.log(`Usuario admin por defecto creado: ${username} / ${password} (cámbialo cuanto antes).`);
}
ensureDefaultAdmin();

module.exports = db;
