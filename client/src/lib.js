export const DEMO_DATE = '2026-07-18';

export const STATUS_LABELS = {
  backlog: 'Backlog',
  assigned: 'Asignada',
  in_progress: 'En curso',
  blocked: 'Bloqueada',
  done: 'Hecha',
};

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const days = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  return `${days[date.getDay()]} ${d}/${m}`;
}

export function daysUntilDemo(fromISO) {
  const [y1, m1, d1] = fromISO.split('-').map(Number);
  const [y2, m2, d2] = DEMO_DATE.split('-').map(Number);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
}

export function byId(list) {
  const map = new Map();
  for (const x of list) map.set(x.id, x);
  return map;
}

export function hasSkills(person, task) {
  const set = new Set(person.skill_ids);
  return task.skill_ids.every((sid) => set.has(sid));
}

export function blockers(task, tasksById) {
  return task.dep_ids
    .map((id) => tasksById.get(id))
    .filter((t) => t && t.status !== 'done');
}

export function descendantHours(taskId, tasks) {
  const dependents = new Map();
  for (const t of tasks) {
    for (const did of t.dep_ids) {
      if (!dependents.has(did)) dependents.set(did, []);
      dependents.get(did).push(t);
    }
  }
  const seen = new Set();
  const stack = [taskId];
  let hours = 0;
  while (stack.length) {
    const id = stack.pop();
    for (const t of dependents.get(id) || []) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      hours += t.estimate_hours || 0;
      stack.push(t.id);
    }
  }
  return hours;
}

export function urgencySort(tasks, allTasks, milestonesById) {
  const descHours = new Map(tasks.map((t) => [t.id, descendantHours(t.id, allTasks)]));
  const due = (t) => {
    const m = t.milestone_id && milestonesById.get(t.milestone_id);
    return m && m.due_date ? m.due_date : '9999-12-31';
  };
  return [...tasks].sort((a, b) => {
    if (b.is_critical !== a.is_critical) return b.is_critical - a.is_critical;
    const dueDiff = due(a).localeCompare(due(b));
    if (dueDiff !== 0) return dueDiff;
    return descHours.get(b.id) - descHours.get(a.id);
  });
}

// Tasks where person has an assignment on that date.
export function tasksForPersonDay(tasks, personId, date) {
  return tasks.filter((t) =>
    t.assignments.some((a) => a.person_id === personId && a.assigned_date === date)
  );
}

export function loadForDay(tasks, personId, date) {
  return tasksForPersonDay(tasks, personId, date).reduce((s, t) => s + (t.estimate_hours || 0), 0);
}

export function fmtHours(h) {
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}
