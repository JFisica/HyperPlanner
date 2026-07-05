import { useMemo, useRef, useState } from 'react';
import {
  STATUS_LABELS,
  byId,
  blockers,
  urgencySort,
  loadForDay,
  capacityForDay,
  defaultCapacity,
  fmtHours,
  formatDate,
} from '../lib';

const PX_PER_HOUR = 80;
const START_HOUR = 7;
const END_HOUR = 22;
const TOTAL_HOURS = END_HOUR - START_HOUR;
const TRACK_WIDTH = TOTAL_HOURS * PX_PER_HOUR;

function timeToX(time) {
  const [h, m] = time.split(':').map(Number);
  return (h - START_HOUR + m / 60) * PX_PER_HOUR;
}

function xToTime(rawX, durationHours = 1) {
  const snapped = Math.round((rawX / PX_PER_HOUR) * 2) / 2;
  const clamped = Math.max(0, Math.min(snapped, TOTAL_HOURS - durationHours));
  const absHour = START_HOUR + clamped;
  const h = Math.floor(absHour);
  const m = absHour % 1 >= 0.5 ? 30 : 0;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function addHoursToTime(time, hours) {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + Math.round(hours * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function timeToMinutes(time) {
  if (!time) return END_HOUR * 60;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function computeLanes(blocks) {
  const occupied = []; // each lane: end minute of last block in that lane
  const result = blocks.map((b) => {
    const startMin = timeToMinutes(b.assignment.start_time);
    const endMin = timeToMinutes(b.assignment.end_time);
    let lane = occupied.findIndex((endM) => endM <= startMin);
    if (lane === -1) { lane = occupied.length; occupied.push(endMin); }
    else occupied[lane] = endMin;
    return { ...b, lane };
  });
  return { blocks: result, laneCount: Math.max(1, occupied.length) };
}

const LANE_H = 44;
const LANE_PAD = 6;

export default function Assign({ state, mutate, date, setDate, showToast }) {
  const { people, tasks, milestones, capacity_overrides, settings } = state;
  const [preview, setPreview] = useState(null); // {personId, startTime, durationHours}
  const dragRef = useRef(null);

  const tasksById = useMemo(() => byId(tasks), [tasks]);
  const milestonesById = useMemo(() => byId(milestones), [milestones]);

  // Tasks that have no assignment for today
  const assignedTaskIds = useMemo(() => {
    const ids = new Set();
    for (const t of tasks) {
      if (t.assignments.some((a) => a.assigned_date === date)) ids.add(t.id);
    }
    return ids;
  }, [tasks, date]);

  const unassigned = useMemo(() => {
    const pool = tasks.filter((t) => !assignedTaskIds.has(t.id) && t.status !== 'done');
    const free = pool.filter((t) => blockers(t, tasksById).length === 0);
    const blk  = pool.filter((t) => blockers(t, tasksById).length > 0);
    return [
      ...urgencySort(free, tasks, milestonesById),
      ...urgencySort(blk,  tasks, milestonesById),
    ];
  }, [tasks, assignedTaskIds, tasksById, milestonesById]);

  function personBlocks(personId) {
    const blocks = [];
    for (const task of tasks) {
      const a = task.assignments.find(
        (x) => x.person_id === personId && x.assigned_date === date && x.start_time
      );
      if (a) {
        const end_time = a.end_time || addHoursToTime(a.start_time, task.estimate_hours || 1);
        blocks.push({ task, assignment: { ...a, end_time } });
      }
    }
    return blocks.sort((a, b) =>
      a.assignment.start_time.localeCompare(b.assignment.start_time)
    );
  }

  // ---- drag handlers ----

  function onSidebarDragStart(e, task) {
    dragRef.current = {
      type: 'sidebar',
      taskId: task.id,
      durationHours: task.estimate_hours || 1,
      offsetPx: 0,
    };
    e.dataTransfer.effectAllowed = 'copy';
  }

  function onBlockDragStart(e, task, personId) {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = {
      type: 'block',
      taskId: task.id,
      fromPersonId: personId,
      durationHours: task.estimate_hours || 1,
      offsetPx: e.clientX - rect.left,
    };
    e.dataTransfer.effectAllowed = 'move';
  }

  function onTrackDragOver(e, personId) {
    e.preventDefault();
    const drag = dragRef.current;
    if (!drag) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const rawX = e.clientX - rect.left - drag.offsetPx;
    const startTime = xToTime(rawX, drag.durationHours);
    setPreview({ personId, startTime, durationHours: drag.durationHours, taskId: drag.taskId });
  }

  function onTrackDragLeave(e) {
    // Only clear if leaving the track entirely (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget)) setPreview(null);
  }

  async function onTrackDrop(e, personId) {
    e.preventDefault();
    setPreview(null);
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const rawX = e.clientX - rect.left - drag.offsetPx;
    const startTime = xToTime(rawX, drag.durationHours);
    const endTime = addHoursToTime(startTime, drag.durationHours);

    if (drag.type === 'sidebar' || drag.fromPersonId === personId) {
      await mutate('POST', '/api/assign', {
        task_id: drag.taskId, person_id: personId, date, start_time: startTime, end_time: endTime,
      });
    } else {
      await mutate('POST', '/api/assign/move', {
        task_id: drag.taskId, from_person_id: drag.fromPersonId, to_person_id: personId,
        date, start_time: startTime, end_time: endTime,
      });
    }
  }

  function editDayCapacity(person) {
    const current = capacityForDay(person, date, capacity_overrides, settings);
    const v = prompt(
      `Horas de ${person.name} el ${formatDate(date)} (vacío = estándar ${defaultCapacity(settings)}h):`,
      current
    );
    if (v === null) return;
    mutate('PUT', '/api/capacity', {
      person_id: person.id, date,
      hours: v.trim() === '' ? null : Number(v),
    });
  }

  const hours = Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => START_HOUR + i);

  return (
    <div className="view schedule-page">
      {/* Top bar */}
      <div className="row gap">
        <label className="row gap">
          Día <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <span className="muted">{formatDate(date)}</span>
        <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
          Arrastra tareas al horario · mueve bloques para reorganizar
        </span>
      </div>

      <div className="schedule-layout">
        {/* ---- Sidebar ---- */}
        <div className="schedule-sidebar">
          <div className="col-label">Equipo</div>
          {people.map((p) => {
            const load = loadForDay(tasks, p.id, date);
            const cap  = capacityForDay(p, date, capacity_overrides, settings);
            const over = load > cap;
            const pct  = cap > 0 ? Math.min(100, (load / cap) * 100) : 100;
            const hasOverride = capacity_overrides.some((o) => o.person_id === p.id && o.date === date);
            return (
              <div key={p.id} className="sidebar-person">
                <div className="person-head">
                  <b className="person-name">{p.name}</b>
                  <span
                    className={`load ${over ? 'over' : ''}`}
                    title="Clic para editar horas del día"
                    onClick={() => editDayCapacity(p)}
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

          <div className="col-label" style={{ marginTop: 14 }}>Sin asignar</div>
          <div className="sidebar-tasks">
            {unassigned.map((t) => {
              const blk = blockers(t, tasksById);
              const m   = t.milestone_id && milestonesById.get(t.milestone_id);
              return (
                <div
                  key={t.id}
                  className={`sidebar-task ${blk.length ? 'blocked' : ''}`}
                  draggable
                  onDragStart={(e) => onSidebarDragStart(e, t)}
                  title="Arrastra al horario para asignar"
                >
                  <div className="sidebar-task-name">
                    {!!t.is_critical && <span className="crit">● </span>}
                    {t.title}
                  </div>
                  <div className="sidebar-task-meta">
                    {fmtHours(t.estimate_hours || 0)}h
                    {m ? ` · ${m.name}` : ''}
                    {blk.length ? ' · ⛔ bloqueada' : ''}
                  </div>
                </div>
              );
            })}
            {unassigned.length === 0 && (
              <p className="empty" style={{ fontSize: 12, margin: '4px 0' }}>Todo asignado.</p>
            )}
          </div>

          {/* Tasks assigned but without time slot */}
          {(() => {
            const unscheduled = tasks.filter((t) => {
              if (t.status === 'done') return false;
              return t.assignments.some(
                (a) => a.assigned_date === date && !a.start_time
              );
            });
            if (unscheduled.length === 0) return null;
            return (
              <>
                <div className="col-label" style={{ marginTop: 14 }}>Sin horario</div>
                <div className="sidebar-tasks">
                  {unscheduled.map((t) => (
                    <div key={t.id} className="sidebar-task">
                      <div className="sidebar-task-name">{t.title}</div>
                      <div className="sidebar-task-meta">
                        {fmtHours(t.estimate_hours || 0)}h · <span className={`badge st-${t.status}`}>{STATUS_LABELS[t.status]}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </div>

        {/* ---- Schedule grid ---- */}
        <div className="schedule-main">
          {/* Sticky time header */}
          <div className="schedule-header">
            <div className="row-name-col" />
            <div className="time-header" style={{ width: TRACK_WIDTH }}>
              {hours.map((h) => (
                <div
                  key={h}
                  className="hour-label"
                  style={{ left: (h - START_HOUR) * PX_PER_HOUR }}
                >
                  {String(h).padStart(2, '0')}:00
                </div>
              ))}
            </div>
          </div>

          {/* Person rows */}
          <div className="schedule-body">
            {people.map((p) => {
              const rawBlocks = personBlocks(p.id);
              const { blocks: laned, laneCount } = computeLanes(rawBlocks);
              const rowH = LANE_PAD * 2 + laneCount * LANE_H;

              return (
                <div key={p.id} className="schedule-row" style={{ height: rowH }}>
                  <div className="row-name-col">
                    <span className="row-name-text">{p.name}</span>
                  </div>
                  <div
                    className="row-track"
                    style={{ width: TRACK_WIDTH }}
                    onDragOver={(e) => onTrackDragOver(e, p.id)}
                    onDragLeave={onTrackDragLeave}
                    onDrop={(e) => onTrackDrop(e, p.id)}
                  >
                    {/* Grid lines every hour */}
                    {hours.map((h) => (
                      <div
                        key={h}
                        className={`grid-line ${h === 12 ? 'midday' : ''}`}
                        style={{ left: (h - START_HOUR) * PX_PER_HOUR }}
                      />
                    ))}

                    {/* Task blocks */}
                    {laned.map(({ task, assignment, lane }) => {
                      const x = timeToX(assignment.start_time);
                      const w = Math.max((task.estimate_hours || 1) * PX_PER_HOUR - 2, 32);
                      const top = LANE_PAD + lane * LANE_H;
                      const height = LANE_H - 4;
                      const blk = blockers(task, tasksById);

                      return (
                        <div
                          key={task.id}
                          className={`task-block st-${task.status}${!!task.is_critical ? ' critical' : ''}`}
                          style={{ left: x, width: w, top, height }}
                          draggable
                          onDragStart={(e) => onBlockDragStart(e, task, p.id)}
                          title={`${task.title} · ${assignment.start_time}–${assignment.end_time}`}
                        >
                          <span className="block-title">{task.title}</span>
                          <span className="block-time">{assignment.start_time}</span>
                          {blk.length > 0 && <span title={blk.map((b) => b.title).join(', ')}>⛔</span>}
                          <div className="block-actions">
                            {task.status === 'assigned' && (
                              <button className="block-btn" title="Empezar"
                                onClick={() => mutate('PUT', `/api/tasks/${task.id}`, { status: 'in_progress' })}>▶</button>
                            )}
                            {task.status === 'in_progress' && (
                              <button className="block-btn ok" title="Marcar hecha"
                                onClick={() => mutate('PUT', `/api/tasks/${task.id}`, { status: 'done' })}>✔</button>
                            )}
                            {task.status === 'done' && (
                              <button className="block-btn" title="Reabrir"
                                onClick={() => mutate('PUT', `/api/tasks/${task.id}`, { status: 'in_progress' })}>↩</button>
                            )}
                            {(task.status === 'assigned' || task.status === 'in_progress') && (
                              <button className="block-btn warn" title="Bloquear"
                                onClick={() => mutate('PUT', `/api/tasks/${task.id}`, { status: 'blocked' })}>⛔</button>
                            )}
                            {task.status === 'blocked' && (
                              <button className="block-btn" title="Reanudar"
                                onClick={() => mutate('PUT', `/api/tasks/${task.id}`, { status: 'in_progress' })}>▶</button>
                            )}
                            <button className="block-btn danger" title="Quitar asignación"
                              onClick={() => mutate('POST', '/api/unassign', { task_id: task.id, person_id: p.id })}>×</button>
                          </div>
                        </div>
                      );
                    })}

                    {/* Drop preview ghost */}
                    {preview?.personId === p.id && (
                      <div
                        className="task-block preview"
                        style={{
                          left: timeToX(preview.startTime),
                          width: Math.max(preview.durationHours * PX_PER_HOUR - 2, 32),
                          top: LANE_PAD,
                          height: LANE_H - 4,
                        }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
            {people.length === 0 && (
              <p className="empty" style={{ padding: 20 }}>Añade personas en la pestaña Equipo.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
