import { useMemo, useRef, useState, useEffect } from 'react';
import {
  byId,
  blockers,
  urgencySort,
  loadForDay,
  fmtHours,
  formatDate,
} from '../lib';
import { TaskForm, AssigneeMenu } from './Backlog';

const PX_PER_HOUR = 80;
const START_HOUR = 6;
const END_HOUR = 26;   // 02:00 siguiente día
const TOTAL_H = END_HOUR - START_HOUR; // 20
const CAL_HEIGHT = TOTAL_H * PX_PER_HOUR; // 1600
const MIN_DURATION_H = 0.5;
// Small gap kept at the outer edges of the timeline (solo blocks) and an
// even smaller one between two parallel (concurrent) blocks. Creating an
// overlapping slot no longer relies on clicking a background sliver — see
// the "+ paralelo" button on each block — so these can stay tight.
const OUTER_GUTTER_PX = 6;
const INNER_GUTTER_PX = 4;

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

function yToTime(y) {
  const snapped = Math.round((y / PX_PER_HOUR) * 2) / 2; // snap to 30 min
  const clamped = Math.max(0, Math.min(snapped, TOTAL_H));
  const absH = START_HOUR + clamped;
  let h = Math.floor(absH);
  const m = absH % 1 >= 0.5 ? 30 : 0;
  if (h >= 24) h -= 24;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function minutesToTime(totalMin) {
  let m = ((totalMin % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// Like a plain HH:MM→minutes conversion, but normalizes post-midnight hours
// (00-05 → 24-29) so they sort/compare correctly in this 6am-2am day window.
function timeToMinNorm(t) {
  const [h, m] = t.split(':').map(Number);
  return normalizeH(h) * 60 + m;
}

// Google Calendar-style column layout for overlapping blocks on the shared timeline.
function layoutBlocks(blocks) {
  if (!blocks.length) return [];
  const sorted = [...blocks].sort((a, b) => timeToMinNorm(a.start_time) - timeToMinNorm(b.start_time));
  const cols = []; // cols[i] = endMin of last block in column i
  const withCol = sorted.map((b) => {
    const startMin = timeToMinNorm(b.start_time);
    const endMin   = timeToMinNorm(b.end_time);
    let col = cols.findIndex((end) => end <= startMin);
    if (col === -1) { col = cols.length; cols.push(endMin); }
    else cols[col] = endMin;
    return { ...b, col };
  });
  return withCol.map((b) => {
    const startMin = timeToMinNorm(b.start_time);
    const endMin   = timeToMinNorm(b.end_time);
    const concurrent = withCol.filter(
      (o) => timeToMinNorm(o.start_time) < endMin && timeToMinNorm(o.end_time) > startMin
    );
    const localCols = Math.max(...concurrent.map((o) => o.col + 1));
    return { ...b, localCols };
  });
}

export default function Assign({ state, mutate, date, setDate, showToast }) {
  const { people, tasks, milestones, time_slots } = state;
  const dragRef = useRef(null);
  const eventsRef = useRef(null);
  const [creatingTask, setCreatingTask] = useState(false);
  const [openAssigneeMenu, setOpenAssigneeMenu] = useState(null); // task id
  const [personDropTarget, setPersonDropTarget] = useState(null); // task id currently hovered by a dragged person

  const tasksById      = useMemo(() => byId(tasks), [tasks]);
  const peopleById     = useMemo(() => byId(people), [people]);
  const milestonesById = useMemo(() => byId(milestones), [milestones]);

  const slotsToday = useMemo(() => time_slots.filter((s) => s.date === date), [time_slots, date]);

  // Tasks with no slot at all today and not done → sidebar pool.
  const unscheduled = useMemo(() => {
    const scheduledTaskIds = new Set(slotsToday.filter((s) => s.task_id).map((s) => s.task_id));
    const pool = tasks.filter((t) => t.status !== 'done' && !scheduledTaskIds.has(t.id));
    const free = pool.filter((t) => blockers(t, tasksById).length === 0);
    const blk  = pool.filter((t) => blockers(t, tasksById).length > 0);
    return [
      ...urgencySort(free, tasks, milestonesById),
      ...urgencySort(blk,  tasks, milestonesById),
    ];
  }, [tasks, slotsToday, tasksById, milestonesById]);

  // ---- live drag preview (create / move / resize) ----
  // `live[slotId]` or `live.__draft` overrides {start_time, end_time} while dragging.
  const [live, setLive] = useState({});

  useEffect(() => {
    function onMove(e) {
      const d = dragRef.current;
      if (!d) return;
      const rect = eventsRef.current.getBoundingClientRect();
      const y = e.clientY - rect.top;

      if (d.mode === 'create') {
        const a = timeToMinNorm(yToTime(Math.min(y, d.anchorY)));
        let b = timeToMinNorm(yToTime(Math.max(y, d.anchorY)));
        if (b - a < MIN_DURATION_H * 60) b = a + MIN_DURATION_H * 60;
        setLive({ __draft: { start_time: minutesToTime(a), end_time: minutesToTime(b) } });
      } else if (d.mode === 'move') {
        const deltaMin = Math.round(((y - d.anchorY) / PX_PER_HOUR) * 60 / 30) * 30;
        const dur = timeToMinNorm(d.originEnd) - timeToMinNorm(d.originStart);
        let newStartOffset = (timeToMinNorm(d.originStart) - START_HOUR * 60) + deltaMin;
        newStartOffset = Math.max(0, Math.min(newStartOffset, TOTAL_H * 60 - dur));
        setLive({ [d.slotId]: { start_time: minutesToTime(START_HOUR * 60 + newStartOffset), end_time: minutesToTime(START_HOUR * 60 + newStartOffset + dur) } });
      } else if (d.mode === 'resize-top') {
        const newStartMin = Math.max(0, Math.min(timeToMinNorm(yToTime(y)) - START_HOUR * 60, timeToMinNorm(d.originEnd) - START_HOUR * 60 - MIN_DURATION_H * 60));
        setLive({ [d.slotId]: { start_time: minutesToTime(START_HOUR * 60 + newStartMin), end_time: d.originEnd } });
      } else if (d.mode === 'resize-bottom') {
        const newEndMin = Math.max(timeToMinNorm(d.originStart) - START_HOUR * 60 + MIN_DURATION_H * 60, Math.min(timeToMinNorm(yToTime(y)) - START_HOUR * 60, TOTAL_H * 60));
        setLive({ [d.slotId]: { start_time: d.originStart, end_time: minutesToTime(START_HOUR * 60 + newEndMin) } });
      }
    }

    async function onUp() {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      if (d.mode === 'create') {
        const draft = live.__draft;
        setLive({});
        if (draft && timeToMinNorm(draft.end_time) - timeToMinNorm(draft.start_time) >= MIN_DURATION_H * 60 - 1) {
          await mutate('POST', '/api/slots', { date, start_time: draft.start_time, end_time: draft.end_time, task_id: null });
        }
      } else if (d.slotId) {
        const l = live[d.slotId];
        setLive({});
        if (l) await mutate('PUT', `/api/slots/${d.slotId}`, { start_time: l.start_time, end_time: l.end_time });
      }
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, date, mutate]);

  // Adds a fresh 1h empty slot after the last slot today (or at 09:00 if
  // there are none). Exists so a coordinator can deliberately create a slot
  // that overlaps another: dragging on the background can't start a new
  // slot on top of an existing one, so this button is the way in. The new
  // slot can then be dragged/resized into the exact overlapping time desired.
  async function addDefaultSlot() {
    const calStart = START_HOUR * 60;
    const calEnd = (START_HOUR + TOTAL_H) * 60;
    const defaultStart = calStart + 3 * 60; // 09:00
    let start = slotsToday.length
      ? Math.max(...slotsToday.map((s) => timeToMinNorm(s.end_time)))
      : defaultStart;
    start = Math.min(start, calEnd - 60);
    await mutate('POST', '/api/slots', {
      date, start_time: minutesToTime(start), end_time: minutesToTime(start + 60), task_id: null,
    });
  }

  // Adds an empty slot at the exact same start/end as an existing one, so it
  // renders side by side with it. This is the explicit way to double-book a
  // time slot — no need to find a sliver of empty background to drag from.
  async function addParallelSlot(slot) {
    await mutate('POST', '/api/slots', {
      date, start_time: slot.start_time, end_time: slot.end_time, task_id: null,
    });
  }

  function startCreate(e) {
    if (e.target.closest('.slot-block')) return; // clicks on an existing slot don't start a new one
    const rect = eventsRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    dragRef.current = { mode: 'create', anchorY: y };
    const t0 = timeToMinNorm(yToTime(y));
    setLive({ __draft: { start_time: minutesToTime(t0), end_time: minutesToTime(t0 + 30) } });
  }

  function startMove(e, slot) {
    e.stopPropagation();
    const rect = eventsRef.current.getBoundingClientRect();
    dragRef.current = {
      mode: 'move', slotId: slot.id,
      anchorY: e.clientY - rect.top, originStart: slot.start_time, originEnd: slot.end_time,
    };
  }

  function startResize(e, slot, edge) {
    e.stopPropagation();
    dragRef.current = {
      mode: edge === 'top' ? 'resize-top' : 'resize-bottom',
      slotId: slot.id, originStart: slot.start_time, originEnd: slot.end_time,
    };
  }

  function toggleAssignee(task, personId) {
    const has = task.assignee_ids.includes(personId);
    const assignee_ids = has
      ? task.assignee_ids.filter((id) => id !== personId)
      : [...task.assignee_ids, personId];
    mutate('PUT', `/api/tasks/${task.id}`, { assignee_ids });
  }

  function addAssignee(task, personId) {
    if (task.assignee_ids.includes(personId)) return;
    mutate('PUT', `/api/tasks/${task.id}`, { assignee_ids: [...task.assignee_ids, personId] });
  }

  // ---- drag & drop ----
  // Two kinds of things get dragged onto the calendar: a task (from the "sin
  // horario" list, to schedule it) and a person (to assign them to a task,
  // like in the very first version of this page). They use distinct
  // dataTransfer types so a drop handler can tell them apart.
  function onSidebarTaskDragStart(e, task) {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/x-task', String(task.id));
  }

  function onPersonDragStart(e, person) {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/x-person', String(person.id));
  }

  function isPersonDrag(e) {
    return e.dataTransfer.types.includes('application/x-person');
  }

  async function onCalendarDrop(e) {
    e.preventDefault();
    if (isPersonDrag(e)) return; // dropping a person on empty background has no task to attach to
    const taskId = Number(e.dataTransfer.getData('application/x-task'));
    if (!taskId) return;
    const task = tasksById.get(taskId);
    if (!task) return;
    const rect = eventsRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const durationH = Math.max(task.estimate_hours || 1, MIN_DURATION_H);
    const start = timeToMinNorm(yToTime(y));
    const end = start + Math.round(durationH * 2) * 30;
    await mutate('POST', '/api/slots', {
      date, start_time: minutesToTime(start), end_time: minutesToTime(end), task_id: taskId,
    });
  }

  function onSlotDragOver(e, slot) {
    if (isPersonDrag(e)) {
      if (slot.task_id) { e.preventDefault(); setPersonDropTarget(slot.task_id); }
    } else if (!slot.task_id) {
      e.preventDefault();
    }
  }

  async function onSlotDrop(e, slot) {
    e.preventDefault();
    e.stopPropagation();
    setPersonDropTarget(null);
    if (isPersonDrag(e)) {
      if (!slot.task_id) return;
      const personId = Number(e.dataTransfer.getData('application/x-person'));
      const task = tasksById.get(slot.task_id);
      if (personId && task) addAssignee(task, personId);
      return;
    }
    if (slot.task_id) return; // don't clobber an already-assigned slot
    const taskId = Number(e.dataTransfer.getData('application/x-task'));
    if (!taskId) return;
    await mutate('PUT', `/api/slots/${slot.id}`, { task_id: taskId });
  }

  function onSidebarTaskDrop(e, task) {
    e.preventDefault();
    setPersonDropTarget(null);
    if (!isPersonDrag(e)) return;
    const personId = Number(e.dataTransfer.getData('application/x-person'));
    if (personId) addAssignee(task, personId);
  }

  const hours     = Array.from({ length: TOTAL_H + 1 }, (_, i) => START_HOUR + i); // 6..26
  const halfHours = Array.from({ length: TOTAL_H },     (_, i) => START_HOUR + i);
  const candidateTasks = tasks.filter((t) => t.status !== 'done');

  const layouted = useMemo(() => {
    const slots = slotsToday.map((s) => ({ ...s, ...(live[s.id] || {}) }));
    return layoutBlocks(slots);
  }, [slotsToday, live]);
  const draft = live.__draft || null;

  return (
    <div className="view schedule-page">
      <div className="row gap">
        <label className="row gap">
          Día <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <span className="muted">{formatDate(date)}</span>
        <button className="primary" onClick={() => setCreatingTask(true)}>+ Nueva tarea</button>
        <button className="mini" onClick={addDefaultSlot} title="Añade un horario nuevo (útil para solapar con otro arrastrándolo después)">+ horario</button>
        <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
          Arrastra en el calendario para crear un horario · arrastra tareas para asignarlas · arrastra personas a una tarea para asignarlas
        </span>
      </div>

      {creatingTask && (
        <TaskForm task={null} state={state} mutate={mutate} onClose={() => setCreatingTask(false)} />
      )}

      <div className="schedule-layout">
        {/* ---- Sidebar: unscheduled tasks + per-person load today ---- */}
        <div className="schedule-sidebar">
          <div className="col-label">Sin horario hoy</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {unscheduled.map((t) => {
              const blk = blockers(t, tasksById);
              const m   = t.milestone_id && milestonesById.get(t.milestone_id);
              return (
                <div
                  key={t.id}
                  className={`sidebar-task${blk.length ? ' blocked' : ''}${personDropTarget === t.id ? ' drop-active' : ''}`}
                  draggable
                  onDragStart={(e) => onSidebarTaskDragStart(e, t)}
                  onDragOver={(e) => { if (isPersonDrag(e)) { e.preventDefault(); setPersonDropTarget(t.id); } }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setPersonDropTarget(null); }}
                  onDrop={(e) => onSidebarTaskDrop(e, t)}
                  title={`Arrastra al calendario · ${fmtHours(t.estimate_hours || 0)}h estimadas`}
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
                  <div className="sidebar-task-assignees" onMouseDown={(e) => e.stopPropagation()}>
                    {t.assignee_ids.map((pid) => {
                      const p = peopleById.get(pid);
                      if (!p) return null;
                      return (
                        <span key={pid} className="skill-pill">
                          {p.name}
                          <button className="pill-remove" onClick={() => toggleAssignee(t, pid)} title="Quitar">×</button>
                        </span>
                      );
                    })}
                    <div className="skill-add-wrap">
                      <button className="mini" onClick={() => setOpenAssigneeMenu(openAssigneeMenu === t.id ? null : t.id)}>+ persona</button>
                      {openAssigneeMenu === t.id && (
                        <AssigneeMenu
                          task={t}
                          people={people}
                          onToggle={(pid) => toggleAssignee(t, pid)}
                          onClose={() => setOpenAssigneeMenu(null)}
                        />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {unscheduled.length === 0 && (
              <p className="empty" style={{ fontSize: 12 }}>Todo planificado.</p>
            )}
          </div>

          {people.length > 0 && (
            <>
              <div className="col-label" style={{ marginTop: 14 }}>Personas</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {people.map((p) => {
                  const load = loadForDay(slotsToday, tasksById, p.id, date);
                  return (
                    <div
                      key={p.id}
                      className="sidebar-person"
                      draggable
                      onDragStart={(e) => onPersonDragStart(e, p)}
                      title="Arrastra a una tarea del calendario o de la lista para asignarla"
                    >
                      <div className="person-head">
                        <span className="drag-handle">⠿</span>
                        <span className="person-name">{p.name}</span>
                        <span className={load > 10 ? 'load over' : 'load'}>{fmtHours(load)}h</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* ---- Shared calendar timeline ---- */}
        <div className="cal-wrap">
          <div className="cal-inner" style={{ height: CAL_HEIGHT + 40 }}>
            <div className="cal-time-col">
              {hours.map((h) => (
                <div key={h} className="cal-hour-label" style={{ top: (h - START_HOUR) * PX_PER_HOUR }}>
                  {fmtHour(h)}
                </div>
              ))}
            </div>

            <div
              className="cal-events"
              ref={eventsRef}
              onMouseDown={startCreate}
              onDragOver={(e) => e.preventDefault()}
              onDrop={onCalendarDrop}
            >
              {hours.map((h) => (
                <div key={`hl${h}`} className={`cal-hline${h === 12 ? ' midday' : h === 24 ? ' midnight' : ''}`} style={{ top: (h - START_HOUR) * PX_PER_HOUR }} />
              ))}
              {halfHours.map((h) => (
                <div key={`hh${h}`} className="cal-hline half" style={{ top: (h - START_HOUR + 0.5) * PX_PER_HOUR }} />
              ))}

              {layouted.map((slot) => {
                const top = timeToY(slot.start_time);
                const height = Math.max((timeToMinNorm(slot.end_time) - timeToMinNorm(slot.start_time)) / 60 * PX_PER_HOUR - 2, 22);
                // Expressed as left+right (not left+width): the browser derives the
                // width itself from a single subtraction, so the two margins can't
                // drift apart from independent calc() rounding. The outer edges of
                // the timeline get the full gutter; between two parallel blocks each
                // side only contributes half of the (smaller) inner gutter.
                const leftPct = (slot.col / slot.localCols) * 100;
                const rightPct = 100 - ((slot.col + 1) / slot.localCols) * 100;
                const isFirstCol = slot.col === 0;
                const isLastCol = slot.col === slot.localCols - 1;
                const leftGutter = isFirstCol ? OUTER_GUTTER_PX : INNER_GUTTER_PX / 2;
                const rightGutter = isLastCol ? OUTER_GUTTER_PX : INNER_GUTTER_PX / 2;
                const task = slot.task_id ? tasksById.get(slot.task_id) : null;
                const blk = task ? blockers(task, tasksById) : [];
                const assignees = (task?.assignee_ids || []).map((pid) => peopleById.get(pid)).filter(Boolean);

                const isPersonDropTarget = task && personDropTarget === task.id;

                return (
                  <div
                    key={slot.id}
                    className={`cal-block slot-block${task ? ` st-${task.status}` : ' slot-empty'}${task?.is_critical ? ' critical' : ''}${isPersonDropTarget ? ' drop-active' : ''}`}
                    style={{
                      top, height,
                      left: `calc(${leftPct}% + ${leftGutter}px)`,
                      right: `calc(${rightPct}% + ${rightGutter}px)`,
                    }}
                    onMouseDown={(e) => startMove(e, slot)}
                    onDragOver={(e) => onSlotDragOver(e, slot)}
                    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setPersonDropTarget(null); }}
                    onDrop={(e) => onSlotDrop(e, slot)}
                  >
                    <div className="slot-resize-handle top" onMouseDown={(e) => startResize(e, slot, 'top')} />
                    <div className="cal-block-header">
                      <span className="cal-block-title">
                        {task ? (
                          <>{!!task.is_critical && <span className="crit">●</span>} {task.title}</>
                        ) : (
                          <select
                            className="slot-task-select"
                            value=""
                            onMouseDown={(e) => e.stopPropagation()}
                            onChange={(e) => e.target.value && mutate('PUT', `/api/slots/${slot.id}`, { task_id: Number(e.target.value) })}
                          >
                            <option value="">+ tarea…</option>
                            {candidateTasks.map((t) => (
                              <option key={t.id} value={t.id}>{t.title}</option>
                            ))}
                          </select>
                        )}
                      </span>
                      <span className="cal-block-time">{slot.start_time}–{slot.end_time}</span>
                      <button
                        className="mini cal-block-parallel"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); addParallelSlot(slot); }}
                        title="Añadir horario en paralelo (misma franja horaria)"
                      >‖+</button>
                      <button
                        className="mini danger cal-block-del"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); mutate('DELETE', `/api/slots/${slot.id}`); }}
                        title="Eliminar horario"
                      >×</button>
                    </div>

                    {height >= 40 && task && (
                      <div className="cal-block-assignees">
                        {assignees.length > 0
                          ? assignees.map((p) => <span key={p.id} className="assignee-pill">{p.name}</span>)
                          : <span className="cal-drop-hint">Sin asignar</span>}
                      </div>
                    )}

                    {height >= 40 && task && blk.length > 0 && (
                      <div className="cal-block-blocked">⛔ {blk.map((b) => b.title).join(', ')}</div>
                    )}

                    {height >= 40 && task && (
                      <div className="cal-block-actions">
                        {task.status === 'assigned' && (
                          <button className="mini" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); mutate('PUT', `/api/tasks/${task.id}`, { status: 'in_progress' }); }}>▶</button>
                        )}
                        {task.status === 'in_progress' && (
                          <button className="mini ok" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); mutate('PUT', `/api/tasks/${task.id}`, { status: 'done' }); }}>✔</button>
                        )}
                        <button className="mini" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); mutate('PUT', `/api/slots/${slot.id}`, { task_id: null }); }} title="Quitar tarea del horario">↩</button>
                      </div>
                    )}

                    <div className="slot-resize-handle bottom" onMouseDown={(e) => startResize(e, slot, 'bottom')} />
                  </div>
                );
              })}

              {draft && (
                <div
                  className="cal-block preview"
                  style={{
                    top: timeToY(draft.start_time),
                    height: Math.max((timeToMinNorm(draft.end_time) - timeToMinNorm(draft.start_time)) / 60 * PX_PER_HOUR - 2, 22),
                    left: `${OUTER_GUTTER_PX}px`,
                    right: `${OUTER_GUTTER_PX}px`,
                  }}
                />
              )}

              {slotsToday.length === 0 && !draft && (
                <div className="cal-empty-hint">Arrastra en el calendario para crear un horario</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
