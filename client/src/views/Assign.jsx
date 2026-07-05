import { useMemo, useRef, useState } from 'react';
import {
  byId,
  blockers,
  urgencySort,
  loadForDay,
  fmtHours,
  formatDate,
} from '../lib';

const PX_PER_HOUR = 80;
const START_HOUR = 6;
const END_HOUR = 26;   // 02:00 siguiente día
const TOTAL_H = END_HOUR - START_HOUR; // 20
const CAL_HEIGHT = TOTAL_H * PX_PER_HOUR; // 1600

// Hours 00-05 are post-midnight; treat them as 24-29 internally.
function normalizeH(h) { return h < START_HOUR ? h + 24 : h; }

function fmtHour(h) {
  const d = h >= 24 ? h - 24 : h;
  return `${String(d).padStart(2, '0')}:00`;
}

function timeToY(time) {
  let [h, m] = time.split(':').map(Number);
  h = normalizeH(h);
  return (h - START_HOUR + m / 60) * PX_PER_HOUR;
}

function yToTime(y, durationH = 1) {
  const snapped = Math.round((y / PX_PER_HOUR) * 2) / 2;
  const clamped = Math.max(0, Math.min(snapped, TOTAL_H - durationH));
  const absH = START_HOUR + clamped;
  let h = Math.floor(absH);
  const m = absH % 1 >= 0.5 ? 30 : 0;
  if (h >= 24) h -= 24;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function addHoursToTime(time, hours) {
  let [h, m] = time.split(':').map(Number);
  h = normalizeH(h);
  const total = h * 60 + m + Math.round(hours * 60);
  let newH = Math.floor(total / 60);
  if (newH >= 24) newH -= 24;
  return `${String(newH).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function timeToMin(t) {
  let [h, m] = t.split(':').map(Number);
  return normalizeH(h) * 60 + m;
}

// Google Calendar-style column layout for overlapping blocks.
function layoutBlocks(blocks) {
  if (!blocks.length) return [];
  const sorted = [...blocks].sort((a, b) => timeToMin(a.startTime) - timeToMin(b.startTime));
  const cols = []; // cols[i] = endMin of last block in column i
  const withCol = sorted.map((b) => {
    const startMin = timeToMin(b.startTime);
    const endMin   = timeToMin(b.endTime);
    let col = cols.findIndex((end) => end <= startMin);
    if (col === -1) { col = cols.length; cols.push(endMin); }
    else cols[col] = endMin;
    return { ...b, col };
  });
  // For each block, count how many columns are active during its span.
  return withCol.map((b) => {
    const startMin = timeToMin(b.startTime);
    const endMin   = timeToMin(b.endTime);
    const concurrent = withCol.filter(
      (o) => timeToMin(o.startTime) < endMin && timeToMin(o.endTime) > startMin
    );
    const localCols = Math.max(...concurrent.map((o) => o.col + 1));
    return { ...b, localCols };
  });
}

export default function Assign({ state, mutate, date, setDate, showToast }) {
  const { people, tasks, milestones } = state;
  const [dragOverTask, setDragOverTask] = useState(null);
  const [preview, setPreview] = useState(null); // {startTime, durationHours}
  const dragRef = useRef(null);

  const tasksById     = useMemo(() => byId(tasks), [tasks]);
  const milestonesById = useMemo(() => byId(milestones), [milestones]);
  const peopleById    = useMemo(() => byId(people), [people]);

  // Tasks that have a time slot today.
  const scheduledToday = useMemo(
    () => tasks.filter((t) => t.schedule?.some((s) => s.date === date)),
    [tasks, date]
  );

  // Tasks with no time slot today and not done → sidebar list.
  const unscheduled = useMemo(() => {
    const pool = tasks.filter(
      (t) => t.status !== 'done' && !t.schedule?.some((s) => s.date === date)
    );
    const free = pool.filter((t) => blockers(t, tasksById).length === 0);
    const blk  = pool.filter((t) => blockers(t, tasksById).length > 0);
    return [
      ...urgencySort(free, tasks, milestonesById),
      ...urgencySort(blk,  tasks, milestonesById),
    ];
  }, [tasks, date, tasksById, milestonesById]);

  // Build positioned blocks for the calendar.
  const layoutedBlocks = useMemo(() => {
    const blocks = scheduledToday.map((task) => {
      const sched = task.schedule.find((s) => s.date === date);
      return { task, sched, startTime: sched.start_time, endTime: sched.end_time };
    });
    return layoutBlocks(blocks);
  }, [scheduledToday, date]);

  // ---- drag handlers ----

  function onPersonDragStart(e, person) {
    dragRef.current = { type: 'person', personId: person.id };
    e.dataTransfer.effectAllowed = 'copy';
  }

  function onUnscheduledDragStart(e, task) {
    dragRef.current = {
      type: 'new-task',
      taskId: task.id,
      durationHours: task.estimate_hours || 1,
      offsetY: 0,
    };
    e.dataTransfer.effectAllowed = 'copy';
  }

  function onBlockDragStart(e, task) {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = {
      type: 'task',
      taskId: task.id,
      durationHours: task.estimate_hours || 1,
      offsetY: e.clientY - rect.top,
    };
    e.dataTransfer.effectAllowed = 'move';
  }

  function onCalDragOver(e) {
    e.preventDefault();
    const drag = dragRef.current;
    if (!drag || drag.type === 'person') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const rawY = e.clientY - rect.top - (drag.offsetY || 0);
    setPreview({ startTime: yToTime(rawY, drag.durationHours), durationHours: drag.durationHours });
  }

  function onCalDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) setPreview(null);
  }

  async function onCalDrop(e) {
    e.preventDefault();
    setPreview(null);
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.type === 'person') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const rawY = e.clientY - rect.top - (drag.offsetY || 0);
    const startTime = yToTime(rawY, drag.durationHours);
    const endTime   = addHoursToTime(startTime, drag.durationHours);
    await mutate('PUT', '/api/schedule', { task_id: drag.taskId, date, start_time: startTime, end_time: endTime });
  }

  function onTaskDragOver(e, taskId) {
    e.preventDefault();
    const drag = dragRef.current;
    if (drag?.type === 'person') {
      e.stopPropagation(); // keep the person-drop on task, not calendar
      setDragOverTask(taskId);
    }
    // task/new-task drags bubble up to cal for preview
  }

  function onTaskDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) setDragOverTask(null);
  }

  async function onTaskDrop(e, task) {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.type === 'person') {
      e.preventDefault();
      e.stopPropagation();
      setDragOverTask(null);
      dragRef.current = null;
      if (task.assignments.some((a) => a.person_id === drag.personId && a.assigned_date === date)) return;
      const warnings = [];
      if (blockers(task, tasksById).length)
        warnings.push(`Bloqueada por: ${blockers(task, tasksById).map((b) => b.title).join(', ')}`);
      if (warnings.length) showToast?.('⚠ ' + warnings.join(' · '), 'warn');
      await mutate('POST', '/api/assign', { task_id: task.id, person_id: drag.personId, date });
    }
    // task-type drags bubble to cal drop handler
  }

  const hours     = Array.from({ length: TOTAL_H + 1 }, (_, i) => START_HOUR + i); // 6..26
  const halfHours = Array.from({ length: TOTAL_H },     (_, i) => START_HOUR + i);

  return (
    <div className="view schedule-page">
      <div className="row gap">
        <label className="row gap">
          Día <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <span className="muted">{formatDate(date)}</span>
        <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
          Arrastra tareas al horario · arrastra personas a las tareas
        </span>
      </div>

      <div className="schedule-layout">
        {/* ---- Sidebar ---- */}
        <div className="schedule-sidebar">
          <div className="col-label">Personas</div>
          {people.map((p) => {
            const load = loadForDay(tasks, p.id, date);
            return (
              <div
                key={p.id}
                className="sidebar-person"
                draggable
                onDragStart={(e) => onPersonDragStart(e, p)}
                title="Arrastra a una tarea del horario para asignar"
              >
                <div className="person-head">
                  <span className="drag-handle">⠿</span>
                  <b className="person-name">{p.name}</b>
                  <span className="load" title="Horas asignadas hoy">
                    {fmtHours(load)}h
                  </span>
                </div>
              </div>
            );
          })}
          {people.length === 0 && <p className="empty" style={{ fontSize: 12 }}>Añade personas en Equipo.</p>}

          <div className="col-label" style={{ marginTop: 14 }}>Sin horario</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {unscheduled.map((t) => {
              const blk = blockers(t, tasksById);
              const m   = t.milestone_id && milestonesById.get(t.milestone_id);
              return (
                <div
                  key={t.id}
                  className={`sidebar-task${blk.length ? ' blocked' : ''}`}
                  draggable
                  onDragStart={(e) => onUnscheduledDragStart(e, t)}
                  title={`Arrastra al horario · ${fmtHours(t.estimate_hours || 0)}h estimadas`}
                >
                  <div className="sidebar-task-name">
                    {!!t.is_critical && <span className="crit">● </span>}
                    {t.title}
                  </div>
                  <div className="sidebar-task-meta">
                    {fmtHours(t.estimate_hours || 0)}h
                    {m ? ` · ${m.name}` : ''}
                    {blk.length ? ' · ⛔' : ''}
                  </div>
                </div>
              );
            })}
            {unscheduled.length === 0 && (
              <p className="empty" style={{ fontSize: 12 }}>Todo planificado.</p>
            )}
          </div>
        </div>

        {/* ---- Vertical calendar ---- */}
        <div className="cal-wrap">
          <div className="cal-inner" style={{ height: CAL_HEIGHT + 40 }}>
            {/* Time labels */}
            <div className="cal-time-col">
              {hours.map((h) => (
                <div
                  key={h}
                  className="cal-hour-label"
                  style={{ top: (h - START_HOUR) * PX_PER_HOUR }}
                >
                  {fmtHour(h)}
                </div>
              ))}
            </div>

            {/* Events area — drop target for scheduling tasks */}
            <div
              className="cal-events"
              onDragOver={onCalDragOver}
              onDragLeave={onCalDragLeave}
              onDrop={onCalDrop}
            >
              {/* Hour lines */}
              {hours.map((h) => (
                <div
                  key={`hl${h}`}
                  className={`cal-hline${h === 12 ? ' midday' : h === 24 ? ' midnight' : ''}`}
                  style={{ top: (h - START_HOUR) * PX_PER_HOUR }}
                />
              ))}
              {/* Half-hour lines */}
              {halfHours.map((h) => (
                <div
                  key={`hh${h}`}
                  className="cal-hline half"
                  style={{ top: (h - START_HOUR + 0.5) * PX_PER_HOUR }}
                />
              ))}

              {/* Task blocks */}
              {layoutedBlocks.map(({ task, sched, startTime, endTime, col, localCols }) => {
                const top    = timeToY(startTime);
                const height = Math.max(
                  (timeToMin(endTime) - timeToMin(startTime)) / 60 * PX_PER_HOUR - 2,
                  24
                );
                const leftPct  = (col / localCols) * 100;
                const widthPct = (1 / localCols) * 100 - 0.5;
                const todayAssignees = task.assignments.filter((a) => a.assigned_date === date);
                const blk = blockers(task, tasksById);
                const isDropTarget = dragOverTask === task.id;

                return (
                  <div
                    key={task.id}
                    className={`cal-block st-${task.status}${!!task.is_critical ? ' critical' : ''}${isDropTarget ? ' drop-active' : ''}`}
                    style={{ top, height, left: `${leftPct}%`, width: `${widthPct}%` }}
                    draggable
                    onDragStart={(e) => onBlockDragStart(e, task)}
                    onDragOver={(e) => onTaskDragOver(e, task.id)}
                    onDragLeave={onTaskDragLeave}
                    onDrop={(e) => onTaskDrop(e, task)}
                  >
                    <div className="cal-block-header">
                      <span className="cal-block-title">
                        {!!task.is_critical && <span className="crit">●</span>} {task.title}
                      </span>
                      <span className="cal-block-time">{startTime}–{endTime}</span>
                    </div>

                    {height >= 44 && (
                      <div className="cal-block-assignees">
                        {todayAssignees.map((a) => {
                          const person = peopleById.get(a.person_id);
                          if (!person) return null;
                          return (
                            <span key={a.person_id} className="assignee-pill">
                              {person.name}
                              <button
                                className="pill-remove"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  mutate('POST', '/api/unassign', { task_id: task.id, person_id: a.person_id });
                                }}
                              >×</button>
                            </span>
                          );
                        })}
                        {isDropTarget && dragRef.current?.type === 'person' && (
                          <span className="assignee-pill ghost">
                            {peopleById.get(dragRef.current.personId)?.name}
                          </span>
                        )}
                        {todayAssignees.length === 0 && !isDropTarget && (
                          <span className="cal-drop-hint">Suelta persona aquí</span>
                        )}
                      </div>
                    )}

                    {blk.length > 0 && (
                      <div className="cal-block-blocked">⛔ {blk.map((b) => b.title).join(', ')}</div>
                    )}

                    <div className="cal-block-actions">
                      {task.status === 'assigned' && (
                        <button className="mini" onClick={(e) => { e.stopPropagation(); mutate('PUT', `/api/tasks/${task.id}`, { status: 'in_progress' }); }}>▶ Empezar</button>
                      )}
                      {task.status === 'in_progress' && (
                        <button className="mini ok" onClick={(e) => { e.stopPropagation(); mutate('PUT', `/api/tasks/${task.id}`, { status: 'done' }); }}>✔ Hecha</button>
                      )}
                      {task.status === 'done' && (
                        <button className="mini" onClick={(e) => { e.stopPropagation(); mutate('PUT', `/api/tasks/${task.id}`, { status: 'in_progress' }); }}>↩ Reabrir</button>
                      )}
                      {(task.status === 'assigned' || task.status === 'in_progress') && (
                        <button className="mini danger" onClick={(e) => { e.stopPropagation(); mutate('PUT', `/api/tasks/${task.id}`, { status: 'blocked' }); }}>⛔ Bloquear</button>
                      )}
                      <button
                        className="mini"
                        onClick={(e) => { e.stopPropagation(); mutate('PUT', '/api/schedule', { task_id: task.id, date, start_time: null }); }}
                        title="Quitar del horario"
                      >↑ Sin hora</button>
                    </div>
                  </div>
                );
              })}

              {/* Drop preview ghost */}
              {preview && (
                <div
                  className="cal-block preview"
                  style={{
                    top: timeToY(preview.startTime),
                    height: Math.max(preview.durationHours * PX_PER_HOUR - 2, 24),
                    left: 0,
                    right: 4,
                  }}
                />
              )}

              {scheduledToday.length === 0 && (
                <div className="cal-empty-hint">
                  Arrastra tareas del panel izquierdo para planificar el día
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
