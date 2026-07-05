const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { wouldCreateCycle } = require('./graph');

const app = express();
app.use(express.json());

const ADMIN_PIN = process.env.ADMIN_PIN || '1234';
const PORT = process.env.PORT || 3000;
if (!process.env.ADMIN_PIN) {
  console.warn('AVISO: ADMIN_PIN no definido, usando PIN por defecto "1234"');
}

app.use('/api', (req, res, next) => {
  if (req.method === 'GET') return next();
  if (req.get('X-Admin-Pin') !== ADMIN_PIN) {
    return res.status(401).json({ error: 'PIN incorrecto' });
  }
  next();
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
  const taskAssignments = db.prepare('SELECT * FROM task_assignments').all();
  const capacityOverrides = db.prepare('SELECT * FROM capacity_overrides').all();

  for (const p of people) {
    p.skill_ids = personSkills.filter((x) => x.person_id === p.id).map((x) => x.skill_id);
  }
  for (const t of tasks) {
    t.skill_ids = taskSkills.filter((x) => x.task_id === t.id).map((x) => x.skill_id);
    t.dep_ids = taskDeps.filter((x) => x.task_id === t.id).map((x) => x.depends_on_task_id);
    t.assignments = taskAssignments.filter((x) => x.task_id === t.id);
  }
  return { people, skills, milestones, tasks, capacity_overrides: capacityOverrides };
}

const sendState = (res) => res.json(getState());

app.get('/api/state', (req, res) => sendState(res));
app.post('/api/login', (req, res) => res.json({ ok: true }));

// ---------- people ----------

app.post('/api/people', (req, res) => {
  const { name, notes = '', capacity = 10, skill_ids = [] } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Falta el nombre' });
  const tx = db.transaction(() => {
    const { lastInsertRowid: id } = db
      .prepare('INSERT INTO people (name, notes, capacity) VALUES (?, ?, ?)')
      .run(name.trim(), notes, capacity);
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
  const { name = person.name, notes = person.notes, capacity = person.capacity, skill_ids } = req.body;
  const tx = db.transaction(() => {
    db.prepare('UPDATE people SET name = ?, notes = ?, capacity = ? WHERE id = ?')
      .run(name, notes, capacity, id);
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

function setTaskRelations(taskId, skillIds, depIds) {
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
  const { skill_ids, dep_ids } = req.body;
  const tx = db.transaction(() => {
    const { lastInsertRowid: id } = db
      .prepare(`INSERT INTO tasks (title, description, milestone_id, estimate_hours, status, is_critical, location)
                VALUES (@title, @description, @milestone_id, @estimate_hours, @status, @is_critical, @location)`)
      .run(f);
    const err = validateDeps(Number(id), dep_ids);
    if (err) throw new Error(err);
    setTaskRelations(Number(id), skill_ids, dep_ids);
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
  const { skill_ids, dep_ids } = req.body;
  const err = validateDeps(id, dep_ids);
  if (err) return res.status(400).json({ error: err });
  const tx = db.transaction(() => {
    db.prepare(`UPDATE tasks SET title=@title, description=@description, milestone_id=@milestone_id,
                estimate_hours=@estimate_hours, status=@status, is_critical=@is_critical,
                location=@location, updated_at=datetime('now') WHERE id=@id`)
      .run({ ...f, id });
    setTaskRelations(id, skill_ids, dep_ids);
  });
  tx();
  sendState(res);
});

app.delete('/api/tasks/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(Number(req.params.id));
  sendState(res);
});

// ---------- assignment ----------

app.post('/api/assign', (req, res) => {
  const { task_id, person_id, date } = req.body;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task_id);
  if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });
  if (!db.prepare('SELECT 1 FROM people WHERE id = ?').get(person_id)) {
    return res.status(404).json({ error: 'Persona no encontrada' });
  }
  if (!date) return res.status(400).json({ error: 'Falta la fecha' });
  db.prepare(`INSERT OR REPLACE INTO task_assignments (task_id, person_id, assigned_date) VALUES (?, ?, ?)`)
    .run(task_id, person_id, date);
  if (task.status === 'backlog') {
    db.prepare(`UPDATE tasks SET status = 'assigned', updated_at = datetime('now') WHERE id = ?`).run(task_id);
  }
  sendState(res);
});

// Removes one person from a task. If no assignees remain and status was 'assigned', reverts to 'backlog'.
app.post('/api/unassign', (req, res) => {
  const { task_id, person_id } = req.body;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task_id);
  if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });
  db.prepare('DELETE FROM task_assignments WHERE task_id = ? AND person_id = ?').run(task_id, person_id);
  const remaining = db.prepare('SELECT COUNT(*) c FROM task_assignments WHERE task_id = ?').get(task_id).c;
  if (remaining === 0 && task.status === 'assigned') {
    db.prepare(`UPDATE tasks SET status = 'backlog', updated_at = datetime('now') WHERE id = ?`).run(task_id);
  }
  sendState(res);
});

app.put('/api/capacity', (req, res) => {
  const { person_id, date, hours } = req.body;
  if (!db.prepare('SELECT 1 FROM people WHERE id = ?').get(person_id)) {
    return res.status(404).json({ error: 'Persona no encontrada' });
  }
  if (!date) return res.status(400).json({ error: 'Falta la fecha' });
  if (hours === null || hours === undefined || hours === '') {
    db.prepare('DELETE FROM capacity_overrides WHERE person_id = ? AND date = ?').run(person_id, date);
  } else {
    db.prepare(`INSERT INTO capacity_overrides (person_id, date, hours) VALUES (?, ?, ?)
                ON CONFLICT(person_id, date) DO UPDATE SET hours = excluded.hours`)
      .run(person_id, date, Number(hours));
  }
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
