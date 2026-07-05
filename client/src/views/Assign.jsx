import { useMemo, useRef, useState } from 'react';
import {
  STATUS_LABELS,
  byId,
  blockers,
  hasSkills,
  urgencySort,
  tasksForPersonDay,
  loadForDay,
  capacityForDay,
  fmtHours,
  formatDate,
} from '../lib';

export default function Assign({ state, mutate, date, setDate, showToast }) {
  const { people, tasks, skills, milestones, capacity_overrides } = state;
  const [dragPersonId, setDragPersonId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [statusFilter, setStatusFilter] = useState('active'); // active | all

  const tasksById = useMemo(() => byId(tasks), [tasks]);
  const milestonesById = useMemo(() => byId(milestones), [milestones]);
  const skillsById = useMemo(() => byId(skills), [skills]);
  const peopleById = useMemo(() => byId(people), [people]);

  // All non-done tasks sorted by urgency, blocked go last.
  const sortedTasks = useMemo(() => {
    const pool = statusFilter === 'active'
      ? tasks.filter((t) => t.status !== 'done')
      : tasks;
    const free = urgencySort(
      pool.filter((t) => blockers(t, tasksById).length === 0),
      tasks,
      milestonesById
    );
    const blocked = urgencySort(
      pool.filter((t) => blockers(t, tasksById).length > 0),
      tasks,
      milestonesById
    );
    return [...free, ...blocked];
  }, [tasks, tasksById, milestonesById, statusFilter]);

  async function assign(task, personId) {
    const person = peopleById.get(Number(personId));
    if (!person) return;
    // Already assigned this person to this task for today?
    if (task.assignments.some((a) => a.person_id === person.id && a.assigned_date === date)) return;

    const warnings = [];
    if (!hasSkills(person, task)) {
      const missing = task.skill_ids
        .filter((id) => !person.skill_ids.includes(id))
        .map((id) => skillsById.get(id)?.name)
        .filter(Boolean);
      warnings.push(`${person.name} no tiene las skills: ${missing.join(', ')}`);
    }
    const blk = blockers(task, tasksById);
    if (blk.length) warnings.push(`Bloqueada por: ${blk.map((b) => b.title).join(', ')}`);
    const load = loadForDay(tasks, person.id, date) + (task.estimate_hours || 0);
    const cap = capacityForDay(person, date, capacity_overrides);
    if (load > cap) warnings.push(`Sobrecarga: ${fmtHours(load)}h de ${fmtHours(cap)}h disponibles`);

    if (warnings.length && showToast) {
      showToast('⚠ ' + warnings.join(' · '), 'warn');
    }
    await mutate('POST', '/api/assign', { task_id: task.id, person_id: person.id, date });
  }

  function editDayCapacity(person) {
    const current = capacityForDay(person, date, capacity_overrides);
    const v = prompt(
      `Horas de ${person.name} el ${formatDate(date)} (vacío = por defecto ${person.capacity}h):`,
      current
    );
    if (v === null) return;
    mutate('PUT', '/api/capacity', {
      person_id: person.id,
      date,
      hours: v.trim() === '' ? null : Number(v),
    });
  }

  // Drag handlers
  function onPersonDragStart(e, personId) {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('personId', String(personId));
    setDragPersonId(personId);
  }
  function onPersonDragEnd() {
    setDragPersonId(null);
    setDropTarget(null);
  }
  function onTaskDragOver(e, taskId) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropTarget(taskId);
  }
  function onTaskDragLeave() {
    setDropTarget(null);
  }
  async function onTaskDrop(e, task) {
    e.preventDefault();
    setDropTarget(null);
    setDragPersonId(null);
    const personId = e.dataTransfer.getData('personId');
    if (personId) await assign(task, Number(personId));
  }

  return (
    <div className="view">
      <div className="row gap">
        <label className="row gap">
          Día
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <span className="muted">{formatDate(date)}</span>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="active">Sin terminar</option>
          <option value="all">Todas</option>
        </select>
      </div>

      <div className="assign-layout">
        {/* ---- people column (drag sources) ---- */}
        <div className="people-col">
          <div className="col-label">
            Equipo <span className="muted">— arrastra a una tarea</span>
          </div>
          {people.map((p) => {
            const load = loadForDay(tasks, p.id, date);
            const cap = capacityForDay(p, date, capacity_overrides);
            const over = load > cap;
            const pct = cap > 0 ? Math.min(100, (load / cap) * 100) : 100;
            const hasOverride = capacity_overrides.some(
              (o) => o.person_id === p.id && o.date === date
            );
            const isDragging = dragPersonId === p.id;
            return (
              <div
                key={p.id}
                className={`person-row ${isDragging ? 'dragging' : ''}`}
                draggable
                onDragStart={(e) => onPersonDragStart(e, p.id)}
                onDragEnd={onPersonDragEnd}
                title="Arrastra hacia una tarea para asignar"
              >
                <div className="person-head">
                  <span className="drag-handle">⠿</span>
                  <b className="person-name">{p.name}</b>
                  <span
                    className={`load ${over ? 'over' : ''}`}
                    title="Clic para editar horas del día"
                    onClick={(e) => { e.stopPropagation(); editDayCapacity(p); }}
                  >
                    {fmtHours(load)}/{fmtHours(cap)}h{hasOverride ? '*' : ''} ✎
                  </span>
                </div>
                <div className="bar">
                  <div className={`bar-fill ${over ? 'over' : ''}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
          {people.length === 0 && <p className="empty">Añade personas en Equipo.</p>}
        </div>

        {/* ---- tasks column (drop targets) ---- */}
        <div className="tasks-col">
          <div className="col-label">
            Tareas <span className="muted">— suelta una persona encima para asignar</span>
          </div>
          {sortedTasks.length === 0 && <p className="empty">No hay tareas.</p>}
          {sortedTasks.map((t) => {
            const blk = blockers(t, tasksById);
            const m = t.milestone_id && milestonesById.get(t.milestone_id);
            const todayAssignees = t.assignments.filter((a) => a.assigned_date === date);
            const isDropTarget = dropTarget === t.id;

            return (
              <div
                key={t.id}
                className={`task-drop-card ${blk.length ? 'blocked' : ''} ${t.status === 'done' ? 'done' : ''} ${isDropTarget ? 'drop-active' : ''}`}
                onDragOver={(e) => onTaskDragOver(e, t.id)}
                onDragLeave={onTaskDragLeave}
                onDrop={(e) => onTaskDrop(e, t)}
              >
                <div className="task-drop-top">
                  <div className="task-drop-info">
                    {!!t.is_critical && <span className="crit" title="Crítica">●</span>}
                    <span className="task-drop-title">{t.title}</span>
                    <span className="task-drop-meta">
                      {fmtHours(t.estimate_hours || 0)}h
                      {m ? ` · ${m.name}` : ''}
                      {t.location ? ` · ${t.location}` : ''}
                    </span>
                  </div>
                  <span className={`badge st-${t.status}`}>{STATUS_LABELS[t.status]}</span>
                </div>

                {blk.length > 0 && (
                  <div className="task-drop-blockers">
                    ⛔ {blk.map((b) => b.title).join(', ')}
                  </div>
                )}

                {/* Assignees for today */}
                <div className="task-drop-assignees">
                  {todayAssignees.map((a) => {
                    const person = peopleById.get(a.person_id);
                    if (!person) return null;
                    return (
                      <span key={a.person_id} className="assignee-pill">
                        {person.name}
                        <button
                          className="pill-remove"
                          onClick={() => mutate('POST', '/api/unassign', { task_id: t.id, person_id: a.person_id })}
                          title="Quitar asignación"
                        >×</button>
                      </span>
                    );
                  })}
                  {isDropTarget && dragPersonId && (
                    <span className="assignee-pill ghost">
                      {peopleById.get(dragPersonId)?.name}
                    </span>
                  )}
                  {todayAssignees.length === 0 && !isDropTarget && (
                    <span className="drop-hint">Suelta aquí</span>
                  )}
                </div>

                {/* Status actions */}
                <div className="task-drop-actions">
                  {t.status === 'assigned' && (
                    <button className="mini" onClick={() => mutate('PUT', `/api/tasks/${t.id}`, { status: 'in_progress' })}>▶ Empezar</button>
                  )}
                  {t.status === 'in_progress' && (
                    <button className="mini ok" onClick={() => mutate('PUT', `/api/tasks/${t.id}`, { status: 'done' })}>✔ Hecha</button>
                  )}
                  {t.status === 'done' && (
                    <button className="mini" onClick={() => mutate('PUT', `/api/tasks/${t.id}`, { status: 'in_progress' })}>↩ Reabrir</button>
                  )}
                  {(t.status === 'assigned' || t.status === 'in_progress') && (
                    <button className="mini danger" onClick={() => mutate('PUT', `/api/tasks/${t.id}`, { status: 'blocked' })}>⛔ Bloquear</button>
                  )}
                  {t.status === 'blocked' && (
                    <button className="mini" onClick={() => mutate('PUT', `/api/tasks/${t.id}`, { status: 'in_progress' })}>▶ Reanudar</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
