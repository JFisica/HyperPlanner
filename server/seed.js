// Idempotent seed: typical Hyperloop team skills + 4 milestones.
const db = require('./db');

const SKILLS = [];

const MILESTONES = [
  { name: 'Subsistemas listos', due_date: '2026-07-08', sort_order: 1 },
  { name: 'Integración completa', due_date: '2026-07-11', sort_order: 2 },
  { name: 'Pruebas en pista', due_date: '2026-07-15', sort_order: 3 },
  { name: 'Demo final', due_date: '2026-07-18', sort_order: 4 },
];

const insertSkill = db.prepare('INSERT OR IGNORE INTO skills (name) VALUES (?)');
for (const s of SKILLS) insertSkill.run(s);

const hasMilestone = db.prepare('SELECT 1 FROM milestones WHERE name = ?');
const insertMilestone = db.prepare(
  'INSERT INTO milestones (name, due_date, sort_order) VALUES (@name, @due_date, @sort_order)'
);
for (const m of MILESTONES) {
  if (!hasMilestone.get(m.name)) insertMilestone.run(m);
}

console.log('Seed OK:', {
  skills: db.prepare('SELECT COUNT(*) n FROM skills').get().n,
  milestones: db.prepare('SELECT COUNT(*) n FROM milestones').get().n,
});
