import { useMemo, useState } from 'react';
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

export default function Assign({ state, mutate, date, setDate }) {
  const { people, tasks, skills, milestones, capacity_overrides } = state;
  const [selectedId, setSelectedId] = useState(null);
  const [showAll, setShowAll] = useState(false);

  const tasksById = useMemo(() => byId(tasks), [tasks]);
  const milestonesById = useMemo(() => byId(milestones), [milestones]);
  const skillsById = useMemo(() => byId(skills), [skills]);

  const selected = selectedId ? people.find((p) => p.id === selectedId) : null;

  // Candidate tasks: unassigned & not done. Eligible = skills match.
  const candidates = useMemo(() => {
    if (!selected) return [];
    const pool = tasks.filter(
      (t) => !t.assignee_id && t.status !== 'done' && (showAll || hasSkills(selected, t))
    );
    const sorted = urgencySort(pool, tasks, milestonesById);
    const free = sorted.filter((t) => blockers(t, tasksById).length === 0);
    const blocked = sorted.filter((t) => blockers(t, tasksById).length > 0);
    return [...free, ...blocked];
  }, [selected, tasks, showAll, tasksById, milestonesById]);

  async function assign(task) {
    const warnings = [];
    if (!hasSkills(selected, task)) {
      const missing = task.skill_ids
        .filter((id) => !selected.skill_ids.includes(id))
        .map((id) => skillsById.get(id)?.name)
        .filter(Boolean);
      warnings.push(`${selected.name} no tiene: ${missing.join(', ')}`);
    }
    const blk = blockers(task, tasksById);
    if (blk.length) {
      warnings.push(`Bloqueada por: ${blk.map((b) => b.title).join(', ')}`);
    }
    const cap = capacityForDay(selected, date, capacity_overrides);
    const load = loadForDay(tasks, selected.id, date) + (task.estimate_hours || 0);
    if (load > cap) {
      warnings.push(`Sobrecarga: ${fmtHours(load)}h de ${fmtHours(cap)}h disponibles`);
    }
    if (warnings.length && !confirm(`⚠ Avisos:\n\n${warnings.join('\n')}\n\n¿Asignar igualmente?`)) {
      return;
    }
    await mutate('POST', '/api/assign', { task_id: task.id, person_id: selected.id, date });
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

  return (
    <div className="view">
      <div className="row gap">
        <label className="row gap">
          Día
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <span className="muted">{formatDate(date)}</span>
      </div>

      <div className="assign-layout">
        <div className="people-col">
          {people.map((p) => {
            const load = loadForDay(tasks, p.id, date);
            const cap = capacityForDay(p, date, capacity_overrides);
            const over = load > cap;
            const pct = cap > 0 ? Math.min(100, (load / cap) * 100) : 100;
            const hasOverride = capacity_overrides.some(
              (o) => o.person_id === p.id && o.date === date
            );
            return (
              <div
                key={p.id}
                className={`person-row ${selectedId === p.id ? 'selected' : ''}`}
                onClick={() => setSelectedId(p.id)}
              >
                <div className="person-head">
                  <b>{p.name}</b>
                  <span
                    className={`load ${over ? 'over' : ''}`}
                    title="Clic para editar las horas de este día"
                    onClick={(e) => {
                      e.stopPropagation();
                      editDayCapacity(p);
                    }}
                  >
                    {fmtHours(load)} / {fmtHours(cap)}h{hasOverride ? '*' : ''} ✎
                  </span>
                </div>
                <div className="bar">
                  <div className={`bar-fill ${over ? 'over' : ''}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
          {people.length === 0 && <p className="empty">Añade personas en la pestaña Equipo.</p>}
        </div>

        <div className="detail-col">
          {!selected ? (
            <p className="empty">Selecciona una persona para ver sus tareas y las elegibles.</p>
          ) : (
            <>
              <h2>{selected.name} — {formatDate(date)}</h2>

              <h3>Asignadas este día</h3>
              <div className="task-list">
                {tasksForPersonDay(tasks, selected.id, date).map((t) => (
                  <AssignedTask
                    key={t.id}
                    task={t}
                    tasksById={tasksById}
                    milestonesById={milestonesById}
                    mutate={mutate}
                  />
                ))}
                {tasksForPersonDay(tasks, selected.id, date).length === 0 && (
                  <p className="muted">Nada asignado.</p>
                )}
              </div>

              <div className="row gap space-between">
                <h3>Elegibles (por urgencia)</h3>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={showAll}
                    onChange={(e) => setShowAll(e.target.checked)}
                  />
                  Mostrar también sin skills
                </label>
              </div>
              <div className="task-list">
                {candidates.map((t) => {
                  const blk = blockers(t, tasksById);
                  const compatible = hasSkills(selected, t);
                  const m = t.milestone_id && milestonesById.get(t.milestone_id);
                  return (
                    <div key={t.id} className={`task-card ${blk.length ? 'blocked' : ''}`}>
                      <div className="task-main">
                        <span>
                          {t.is_critical ? <span className="crit">● </span> : null}
                          <b>{t.title}</b>{' '}
                          <span className="muted">
                            {fmtHours(t.estimate_hours || 0)}h
                            {m ? ` · ${m.name}` : ''}
                            {t.location ? ` · ${t.location}` : ''}
                          </span>
                        </span>
                        <button className="mini primary" onClick={() => assign(t)}>
                          Asignar
                        </button>
                      </div>
                      <div className="task-tags">
                        {!compatible && <span className="warn-tag">⚠ sin skills</span>}
                        {blk.length > 0 && (
                          <span className="blocked-tag">
                            ⛔ {blk.map((b) => b.title).join(', ')}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {candidates.length === 0 && <p className="muted">No hay tareas elegibles.</p>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const NEXT_STATUS = { assigned: 'in_progress', in_progress: 'done', blocked: 'in_progress' };
const NEXT_LABEL = { assigned: '▶ Empezar', in_progress: '✔ Hecha', blocked: '▶ Reanudar' };

function AssignedTask({ task, tasksById, milestonesById, mutate }) {
  const blk = blockers(task, tasksById);
  const m = task.milestone_id && milestonesById.get(task.milestone_id);
  return (
    <div className={`task-card ${blk.length ? 'blocked' : ''}`}>
      <div className="task-main">
        <span>
          {task.is_critical ? <span className="crit">● </span> : null}
          <b>{task.title}</b>{' '}
          <span className="muted">
            {fmtHours(task.estimate_hours || 0)}h
            {m ? ` · ${m.name}` : ''}
            {task.location ? ` · ${task.location}` : ''}
          </span>
        </span>
        <span className={`badge st-${task.status}`}>{STATUS_LABELS[task.status]}</span>
      </div>
      {blk.length > 0 && (
        <div className="task-tags">
          <span className="blocked-tag">⛔ {blk.map((b) => b.title).join(', ')}</span>
        </div>
      )}
      <div className="task-tags">
        {NEXT_STATUS[task.status] && (
          <button
            className="mini"
            onClick={() => mutate('PUT', `/api/tasks/${task.id}`, { status: NEXT_STATUS[task.status] })}
          >
            {NEXT_LABEL[task.status]}
          </button>
        )}
        {task.status !== 'blocked' && task.status !== 'done' && (
          <button
            className="mini"
            onClick={() => mutate('PUT', `/api/tasks/${task.id}`, { status: 'blocked' })}
          >
            ⛔ Bloquear
          </button>
        )}
        {task.status === 'done' && (
          <button
            className="mini"
            onClick={() => mutate('PUT', `/api/tasks/${task.id}`, { status: 'in_progress' })}
          >
            ↩ Reabrir
          </button>
        )}
        <button className="mini danger" onClick={() => mutate('POST', '/api/unassign', { task_id: task.id })}>
          Quitar
        </button>
      </div>
    </div>
  );
}
