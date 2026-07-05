const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { wouldCreateCycle } = require('./graph');

const app = express();
app.use(express.json());
app.set('trust proxy', 1);

app.use(session({
  secret: process.env.SESSION_SECRET || 'ehw-2026-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === '1',
    maxAge: 1000 * 60 * 60 * 24 * 21, // 21 days, comfortably covers the event
  },
}));

const PORT = process.env.PORT || 3000;

// ---------- auth ----------

function currentUser(req) {
  if (!req.session.userId) return null;
  return db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(req.session.userId) || null;
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Error de sesión' });
    req.session.userId = user.id;
    res.json({ id: user.id, username: user.username, role: user.role });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'No autenticado' });
  res.json(user);
});

// Everything below requires a logged-in user.
app.use('/api', (req, res, next) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'No autenticado' });
  req.user = user;
  next();
});

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede hacer esto' });
  next();
}

// ---------- users (admin only) ----------

const publicUser = (u) => ({ id: u.id, username: u.username, role: u.role, created_at: u.created_at });
const listUsers = () => db.prepare('SELECT * FROM users ORDER BY username').all().map(publicUser);

app.get('/api/users', requireAdmin, (req, res) => res.json(listUsers()));

app.post('/api/users', requireAdmin, (req, res) => {
  const { username, password, role = 'coordinator' } = req.body;
  if (!username || !username.trim()) return res.status(400).json({ error: 'Falta el usuario' });
  if (!password || password.length < 4) return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
  if (!['admin', 'coordinator'].includes(role)) return res.status(400).json({ error: 'Rol inválido' });
  try {
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run(username.trim(), bcrypt.hashSync(password, 10), role);
  } catch {
    return res.status(400).json({ error: 'Ese usuario ya existe' });
  }
  res.json(listUsers());
});

app.put('/api/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  const { password, role } = req.body;
  if (role !== undefined && !['admin', 'coordinator'].includes(role)) {
    return res.status(400).json({ error: 'Rol inválido' });
  }
  if (role === 'coordinator' && user.role === 'admin') {
    const admins = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'admin'").get().c;
    if (admins <= 1) return res.status(400).json({ error: 'Debe quedar al menos un administrador' });
  }
  if (password !== undefined && password.length < 4) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
  }
  db.prepare('UPDATE users SET password_hash = ?, role = ? WHERE id = ?').run(
    password ? bcrypt.hashSync(password, 10) : user.password_hash,
    role !== undefined ? role : user.role,
    id
  );
  res.json(listUsers());
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (user?.role === 'admin') {
    const admins = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'admin'").get().c;
    if (admins <= 1) return res.status(400).json({ error: 'Debe quedar al menos un administrador' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json(listUsers());
});

// ---------- state ----------

function getState() {
  const people = db.prepare('SELECT * FROM people ORDER BY name').all();
  const skills = db.prepare('SELECT * FROM skills ORDER BY name').all();
  const milestones = db.prepare('SELECT * FROM milestones ORDER BY sort_order, due_date').all();
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY id').all();
  const personSkills = db.prepare('SELECT * FROM person_skills').all();
  const taskSkills = db.prepare('SELECT * FROM task_skills').all();
  const taskDeps = db.prepare('SELECT * FROM task_deps').all();
  const taskAssignees = db.prepare('SELECT * FROM task_assignees').all();
  const timeSlots = db.prepare('SELECT * FROM time_slots ORDER BY date, start_time').all();
  const settingsRows = db.prepare('SELECT * FROM settings').all();
  const settings = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));

  for (const p of people) {
    p.skill_ids = personSkills.filter((x) => x.person_id === p.id).map((x) => x.skill_id);
  }
  for (const t of tasks) {
    t.skill_ids = taskSkills.filter((x) => x.task_id === t.id).map((x) => x.skill_id);
    t.dep_ids = taskDeps.filter((x) => x.task_id === t.id).map((x) => x.depends_on_task_id);
    t.assignee_ids = taskAssignees.filter((x) => x.task_id === t.id).map((x) => x.person_id);
  }
  return { people, skills, milestones, tasks, time_slots: timeSlots, settings };
}

const sendState = (res) => res.json(getState());

app.get('/api/state', (req, res) => sendState(res));

// ---------- settings ----------

app.put('/api/settings', (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'Falta la clave' });
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
  sendState(res);
});

// ---------- people ----------

app.post('/api/people', (req, res) => {
  const { name, notes = '', skill_ids = [] } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Falta el nombre' });
  const tx = db.transaction(() => {
    const { lastInsertRowid: id } = db
      .prepare('INSERT INTO people (name, notes) VALUES (?, ?)')
      .run(name.trim(), notes);
    const ins = db.prepare('INSERT INTO person_skills (person_id, skill_id) VALUES (?, ?)');
    for (const sid of skill_ids) ins.run(id, sid);
  });
  tx();
  sendState(res);
});

app.put('/api/people/:id', (req, res) => {
  const id = Number(req.params.id);
  const person = db.prepare('SELECT * FROM people WHERE id = ?').get(id);
  if (!person) return res.status(404).json({ error: 'Persona no encontrada' });
  const { name = person.name, notes = person.notes, skill_ids } = req.body;
  const tx = db.transaction(() => {
    db.prepare('UPDATE people SET name = ?, notes = ? WHERE id = ?')
      .run(name, notes, id);
    if (Array.isArray(skill_ids)) {
      db.prepare('DELETE FROM person_skills WHERE person_id = ?').run(id);
      const ins = db.prepare('INSERT INTO person_skills (person_id, skill_id) VALUES (?, ?)');
      for (const sid of skill_ids) ins.run(id, sid);
    }
  });
  tx();
  sendState(res);
});

app.delete('/api/people/:id', (req, res) => {
  db.prepare('DELETE FROM people WHERE id = ?').run(Number(req.params.id));
  sendState(res);
});

// ---------- skills ----------

app.post('/api/skills', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Falta el nombre' });
  try {
    db.prepare('INSERT INTO skills (name) VALUES (?)').run(name.trim());
  } catch {
    return res.status(400).json({ error: 'Ya existe esa skill' });
  }
  sendState(res);
});

app.delete('/api/skills/:id', (req, res) => {
  db.prepare('DELETE FROM skills WHERE id = ?').run(Number(req.params.id));
  sendState(res);
});

// ---------- milestones ----------

app.post('/api/milestones', (req, res) => {
  const { name, due_date = null, sort_order = 0 } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Falta el nombre' });
  db.prepare('INSERT INTO milestones (name, due_date, sort_order) VALUES (?, ?, ?)')
    .run(name.trim(), due_date, sort_order);
  sendState(res);
});

app.put('/api/milestones/:id', (req, res) => {
  const id = Number(req.params.id);
  const m = db.prepare('SELECT * FROM milestones WHERE id = ?').get(id);
  if (!m) return res.status(404).json({ error: 'Hito no encontrado' });
  const { name = m.name, due_date = m.due_date, sort_order = m.sort_order } = req.body;
  db.prepare('UPDATE milestones SET name = ?, due_date = ?, sort_order = ? WHERE id = ?')
    .run(name, due_date, sort_order, id);
  sendState(res);
});

app.delete('/api/milestones/:id', (req, res) => {
  db.prepare('DELETE FROM milestones WHERE id = ?').run(Number(req.params.id));
  sendState(res);
});

// ---------- tasks ----------

const STATUSES = ['backlog', 'assigned', 'in_progress', 'blocked', 'done'];

function taskFields(body, current = {}) {
  return {
    title: body.title !== undefined ? String(body.title).trim() : current.title,
    description: body.description !== undefined ? body.description : (current.description || ''),
    milestone_id: body.milestone_id !== undefined ? (body.milestone_id || null) : (current.milestone_id ?? null),
    estimate_hours: body.estimate_hours !== undefined ? Number(body.estimate_hours) || 0 : (current.estimate_hours ?? 1),
    status: body.status !== undefined ? body.status : (current.status || 'backlog'),
    is_critical: body.is_critical !== undefined ? (body.is_critical ? 1 : 0) : (current.is_critical || 0),
    location: body.location !== undefined ? body.location : (current.location || ''),
  };
}

function setTaskRelations(taskId, skillIds, depIds, assigneeIds) {
  if (Array.isArray(skillIds)) {
    db.prepare('DELETE FROM task_skills WHERE task_id = ?').run(taskId);
    const ins = db.prepare('INSERT INTO task_skills (task_id, skill_id) VALUES (?, ?)');
    for (const sid of skillIds) ins.run(taskId, sid);
  }
  if (Array.isArray(depIds)) {
    db.prepare('DELETE FROM task_deps WHERE task_id = ?').run(taskId);
    const ins = db.prepare('INSERT INTO task_deps (task_id, depends_on_task_id) VALUES (?, ?)');
    for (const did of depIds) ins.run(taskId, did);
  }
  if (Array.isArray(assigneeIds)) {
    db.prepare('DELETE FROM task_assignees WHERE task_id = ?').run(taskId);
    const ins = db.prepare('INSERT INTO task_assignees (task_id, person_id) VALUES (?, ?)');
    for (const pid of assigneeIds) ins.run(taskId, pid);
  }
}

function cloneTask(task, suffix = ' (copia)') {
  const { id, created_at, updated_at, ...rest } = task;
  return {
    ...rest,
    title: `${task.title}${suffix}`,
    status: 'backlog',
  };
}

function validateDeps(taskId, depIds) {
  if (!Array.isArray(depIds)) return null;
  if (depIds.includes(taskId)) return 'Una tarea no puede depender de sí misma';
  const exists = db.prepare('SELECT 1 FROM tasks WHERE id = ?');
  for (const did of depIds) {
    if (!exists.get(did)) return `La dependencia ${did} no existe`;
  }
  const allDeps = db.prepare('SELECT task_id, depends_on_task_id FROM task_deps').all();
  if (wouldCreateCycle(taskId, depIds, allDeps)) {
    return 'Esas dependencias crearían un ciclo';
  }
  return null;
}

app.post('/api/tasks', (req, res) => {
  const f = taskFields(req.body);
  if (!f.title) return res.status(400).json({ error: 'Falta el título' });
  if (!STATUSES.includes(f.status)) return res.status(400).json({ error: 'Estado inválido' });
  const { skill_ids, dep_ids, assignee_ids } = req.body;
  const tx = db.transaction(() => {
    const { lastInsertRowid: id } = db
      .prepare(`INSERT INTO tasks (title, description, milestone_id, estimate_hours, status, is_critical, location)
                VALUES (@title, @description, @milestone_id, @estimate_hours, @status, @is_critical, @location)`)
      .run(f);
    const err = validateDeps(Number(id), dep_ids);
    if (err) throw new Error(err);
    setTaskRelations(Number(id), skill_ids, dep_ids, assignee_ids);
  });
  try {
    tx();
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  sendState(res);
});

app.put('/api/tasks/:id', (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ error: 'Tarea no encontrada' });
  const f = taskFields(req.body, current);
  if (!f.title) return res.status(400).json({ error: 'Falta el título' });
  if (!STATUSES.includes(f.status)) return res.status(400).json({ error: 'Estado inválido' });
  const { skill_ids, dep_ids, assignee_ids } = req.body;
  const err = validateDeps(id, dep_ids);
  if (err) return res.status(400).json({ error: err });
  const tx = db.transaction(() => {
    db.prepare(`UPDATE tasks SET title=@title, description=@description, milestone_id=@milestone_id,
                estimate_hours=@estimate_hours, status=@status, is_critical=@is_critical,
                location=@location, updated_at=datetime('now') WHERE id=@id`)
      .run({ ...f, id });
    setTaskRelations(id, skill_ids, dep_ids, assignee_ids);
  });
  tx();
  sendState(res);
});

app.delete('/api/tasks/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(Number(req.params.id));
  sendState(res);
});

app.post('/api/tasks/:id/copy', (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ error: 'Tarea no encontrada' });
  const skillIds = db.prepare('SELECT skill_id FROM task_skills WHERE task_id = ?').all(id).map((r) => r.skill_id);
  const depIds = db.prepare('SELECT depends_on_task_id FROM task_deps WHERE task_id = ?').all(id).map((r) => r.depends_on_task_id);
  const assigneeIds = db.prepare('SELECT person_id FROM task_assignees WHERE task_id = ?').all(id).map((r) => r.person_id);
  const tx = db.transaction(() => {
    const copy = cloneTask(current);
    const { lastInsertRowid: copyId } = db
      .prepare(`INSERT INTO tasks (title, description, milestone_id, estimate_hours, status, is_critical, location)
                VALUES (@title, @description, @milestone_id, @estimate_hours, @status, @is_critical, @location)`)
      .run(copy);
    setTaskRelations(Number(copyId), skillIds, depIds, assigneeIds);
  });
  tx();
  sendState(res);
});

// ---------- time slots ----------
// A slot is a standalone (date, start, end) block on the shared calendar.
// A task can be attached to it (task_id) or it can sit empty; the
// responsible people are whoever the attached task's task_assignees say.
// Overlapping slots are allowed (the coordinator decides).

function syncTaskStatusForSlot(taskId) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) return;
  const count = db.prepare('SELECT COUNT(*) c FROM time_slots WHERE task_id = ?').get(taskId).c;
  if (count > 0 && task.status === 'backlog') {
    db.prepare("UPDATE tasks SET status = 'assigned', updated_at = datetime('now') WHERE id = ?").run(taskId);
  } else if (count === 0 && task.status === 'assigned') {
    db.prepare("UPDATE tasks SET status = 'backlog', updated_at = datetime('now') WHERE id = ?").run(taskId);
  }
}

app.post('/api/slots', (req, res) => {
  const { date, start_time, end_time, task_id = null } = req.body;
  if (!date || !start_time || !end_time) return res.status(400).json({ error: 'Faltan datos del horario' });
  if (task_id && !db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(task_id)) {
    return res.status(404).json({ error: 'Tarea no encontrada' });
  }
  const { lastInsertRowid: id } = db
    .prepare('INSERT INTO time_slots (date, start_time, end_time, task_id) VALUES (?, ?, ?, ?)')
    .run(date, start_time, end_time, task_id || null);
  if (task_id) syncTaskStatusForSlot(task_id);
  sendState(res);
});

app.put('/api/slots/:id', (req, res) => {
  const id = Number(req.params.id);
  const slot = db.prepare('SELECT * FROM time_slots WHERE id = ?').get(id);
  if (!slot) return res.status(404).json({ error: 'Horario no encontrado' });
  const start_time = req.body.start_time !== undefined ? req.body.start_time : slot.start_time;
  const end_time = req.body.end_time !== undefined ? req.body.end_time : slot.end_time;
  const newTaskId = req.body.task_id !== undefined ? (req.body.task_id || null) : slot.task_id;
  if (newTaskId && !db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(newTaskId)) {
    return res.status(404).json({ error: 'Tarea no encontrada' });
  }
  db.prepare("UPDATE time_slots SET start_time = ?, end_time = ?, task_id = ?, updated_at = datetime('now') WHERE id = ?")
    .run(start_time, end_time, newTaskId, id);
  const prevTaskId = slot.task_id;
  if (newTaskId) syncTaskStatusForSlot(newTaskId);
  if (prevTaskId && prevTaskId !== newTaskId) syncTaskStatusForSlot(prevTaskId);
  sendState(res);
});

app.delete('/api/slots/:id', (req, res) => {
  const id = Number(req.params.id);
  const slot = db.prepare('SELECT * FROM time_slots WHERE id = ?').get(id);
  db.prepare('DELETE FROM time_slots WHERE id = ?').run(id);
  if (slot?.task_id) syncTaskStatusForSlot(slot.task_id);
  sendState(res);
});

// ---------- static (production build) ----------

const DIST = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get('*', (req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

if (require.main === module) {
  app.listen(PORT, () => console.log(`EHW Task Command en http://localhost:${PORT}`));
}

module.exports = app;
