import { useMemo, useState } from 'react';
import { STATUS_LABELS, byId, blockers, fmtHours } from '../lib';

export default function Backlog({ state, mutate }) {
  const { tasks, skills, milestones, people } = state;
  const [fMilestone, setFMilestone] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fSkill, setFSkill] = useState('');
  const [editing, setEditing] = useState(null);

  const tasksById = useMemo(() => byId(tasks), [tasks]);
  const milestonesById = useMemo(() => byId(milestones), [milestones]);
  const skillsById = useMemo(() => byId(skills), [skills]);

  const filtered = tasks.filter(
    (t) =>
      (!fMilestone || t.milestone_id === Number(fMilestone)) &&
      (!fStatus || t.status === fStatus) &&
      (!fSkill || t.skill_ids.includes(Number(fSkill)))
  );

  function deleteTask(t) {
    mutate('DELETE', `/api/tasks/${t.id}`);
  }

  function copyTask(t) {
    mutate('POST', `/api/tasks/${t.id}/copy`);
  }

  return (
    <div className="view">
      <div className="row gap wrap">
        <button className="primary" onClick={() => setEditing('new')}>+ Nueva tarea</button>
        <select value={fMilestone} onChange={(e) => setFMilestone(e.target.value)}>
          <option value="">Todos los hitos</option>
          {milestones.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select value={fSkill} onChange={(e) => setFSkill(e.target.value)}>
          <option value="">Todas las skills</option>
          {skills.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <span className="muted">{filtered.length} tareas</span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tarea</th>
              <th>Hito</th>
              <th>h</th>
              <th>Skills</th>
              <th>Estado</th>
              <th>Asignada a</th>
              <th>Bloqueada por</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => {
              const blk = blockers(t, tasksById);
              const m = t.milestone_id && milestonesById.get(t.milestone_id);
              return (
                <tr key={t.id} className={t.status === 'done' ? 'dim' : ''}>
                  <td>
                    {!!t.is_critical && <span className="crit" title="Crítica">● </span>}
                    <b>{t.title}</b>
                    {t.location && <span className="muted"> · {t.location}</span>}
                  </td>
                  <td>{m ? m.name : '—'}</td>
                  <td>{fmtHours(t.estimate_hours || 0)}</td>
                  <td className="skills-cell">
                    {t.skill_ids.map((id) => skillsById.get(id)?.name).filter(Boolean).join(', ') || '—'}
                  </td>
                  <td>
                    <span className={`badge st-${t.status}`}>{STATUS_LABELS[t.status]}</span>
                  </td>
                  <td className="skills-cell">
                    <select
                      value={t.assignee_id || ''}
                      onChange={(e) => mutate('PUT', `/api/tasks/${t.id}`, { assignee_id: e.target.value ? Number(e.target.value) : null })}
                    >
                      <option value="">Sin asignar</option>
                      {people.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {blk.length > 0 && (
                      <span className="blocked-tag" title={blk.map((b) => b.title).join(', ')}>
                        ⛔ {blk.map((b) => b.title).join(', ')}
                      </span>
                    )}
                  </td>
                  <td className="actions">
                    <button className="mini" onClick={() => setEditing(t)}>✎</button>
                    <button className="mini" onClick={() => copyTask(t)} title="Duplicar tarea">⧉</button>
                    <button className="mini danger" onClick={() => deleteTask(t)}>×</button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="empty">Sin tareas.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <TaskForm
          key={editing === 'new' ? 'new' : editing.id}
          task={editing === 'new' ? null : editing}
          state={state}
          mutate={mutate}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

export function TaskForm({ task, state, mutate, onClose }) {
  const { skills, milestones, tasks, people } = state;
  const [f, setF] = useState(() => ({
    title: task?.title || '',
    description: task?.description || '',
    milestone_id: task?.milestone_id || '',
    estimate_hours: task?.estimate_hours ?? 2,
    is_critical: !!task?.is_critical,
    location: task?.location || '',
    status: task?.status || 'backlog',
    assignee_id: task?.assignee_id || '',
    skill_ids: task?.skill_ids || [],
    dep_ids: task?.dep_ids || [],
  }));
  const [depSearch, setDepSearch] = useState('');

  const depCandidates = tasks.filter(
    (t) =>
      (!task || t.id !== task.id) &&
      (f.dep_ids.includes(t.id) ||
        (depSearch && t.title.toLowerCase().includes(depSearch.toLowerCase())))
  );

  function set(field, value) {
    setF((prev) => ({ ...prev, [field]: value }));
  }

  function toggle(field, id) {
    setF((prev) => ({
      ...prev,
      [field]: prev[field].includes(id)
        ? prev[field].filter((x) => x !== id)
        : [...prev[field], id],
    }));
  }

  async function save(e) {
    e.preventDefault();
    const body = {
      ...f,
      milestone_id: f.milestone_id ? Number(f.milestone_id) : null,
      estimate_hours: Number(f.estimate_hours) || 0,
      is_critical: f.is_critical ? 1 : 0,
      assignee_id: f.assignee_id ? Number(f.assignee_id) : null,
    };
    const ok = task
      ? await mutate('PUT', `/api/tasks/${task.id}`, body)
      : await mutate('POST', '/api/tasks', body);
    if (ok) onClose();
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={save}>
        <h2>{task ? 'Editar tarea' : 'Nueva tarea'}</h2>

        <label>
          Título
          <input value={f.title} onChange={(e) => set('title', e.target.value)} autoFocus required />
        </label>

        <label>
          Descripción
          <textarea rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} />
        </label>

        <div className="form-row">
          <label>
            Hito
            <select value={f.milestone_id} onChange={(e) => set('milestone_id', e.target.value)}>
              <option value="">—</option>
              {milestones.map((m) => (
                <option key={m.id} value={m.id}>{m.name} ({m.due_date})</option>
              ))}
            </select>
          </label>
          <label>
            Horas
            <input type="number" min="0" step="0.5" value={f.estimate_hours}
              onChange={(e) => set('estimate_hours', e.target.value)} />
          </label>
          <label>
            Lugar
            <input value={f.location} placeholder="boxes, taller, pista…"
              onChange={(e) => set('location', e.target.value)} />
          </label>
          <label>
            Asignada a
            <select value={f.assignee_id} onChange={(e) => set('assignee_id', e.target.value)}>
              <option value="">Sin asignar</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          {task && (
            <label>
              Estado
              <select value={f.status} onChange={(e) => set('status', e.target.value)}>
                {['backlog', 'assigned', 'in_progress', 'blocked', 'done'].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        <fieldset>
          <legend>Skills requeridas (todas)</legend>
          <div className="chip-list">
            {skills.map((s) => (
              <label key={s.id} className={f.skill_ids.includes(s.id) ? 'chip on' : 'chip'}>
                <input type="checkbox" checked={f.skill_ids.includes(s.id)}
                  onChange={() => toggle('skill_ids', s.id)} />
                {s.name}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>Dependencias (bloqueada por)</legend>
          <input placeholder="Buscar tarea…" value={depSearch}
            onChange={(e) => setDepSearch(e.target.value)} />
          <div className="chip-list">
            {depCandidates.map((t) => (
              <label key={t.id} className={f.dep_ids.includes(t.id) ? 'chip on' : 'chip'}>
                <input type="checkbox" checked={f.dep_ids.includes(t.id)}
                  onChange={() => toggle('dep_ids', t.id)} />
                {t.title}
              </label>
            ))}
            {depCandidates.length === 0 && <span className="muted">Escribe para buscar…</span>}
          </div>
        </fieldset>

        <div className="row gap right">
          <button type="button" onClick={onClose}>Cancelar</button>
          <button type="submit" className="primary">Guardar</button>
        </div>
      </form>
    </div>
  );
}
