import { useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { byId, daysUntilDemo, fmtHours, formatDate } from '../lib';

const PX_PER_HOUR = 80;
const START_HOUR = 6;
const END_HOUR = 26;   // 02:00 siguiente día
const TOTAL_H = END_HOUR - START_HOUR; // 20
const CAL_HEIGHT = TOTAL_H * PX_PER_HOUR; // 1600

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

function timeToMin(t) {
  let [h, m] = t.split(':').map(Number);
  return normalizeH(h) * 60 + m;
}

function layoutBlocks(blocks) {
  if (!blocks.length) return [];
  const sorted = [...blocks].sort((a, b) => timeToMin(a.startTime) - timeToMin(b.startTime));
  const cols = [];
  const withCol = sorted.map((b) => {
    const startMin = timeToMin(b.startTime);
    const endMin   = timeToMin(b.endTime);
    let col = cols.findIndex((end) => end <= startMin);
    if (col === -1) { col = cols.length; cols.push(endMin); }
    else cols[col] = endMin;
    return { ...b, col };
  });
  return withCol.map((b) => {
    const startMin = timeToMin(b.startTime);
    const endMin   = timeToMin(b.endTime);
    const concurrent = withCol.filter(
      (o) => timeToMin(o.startTime) < endMin && timeToMin(o.endTime) > startMin
    );
    return { ...b, localCols: Math.max(...concurrent.map((o) => o.col + 1)) };
  });
}

export default function Report({ state, date, setDate, isPublic = false }) {
  const { people, tasks, milestones } = state;
  const ref = useRef(null);
  const [exporting, setExporting] = useState(false);

  const peopleById    = useMemo(() => byId(people), [people]);
  const milestonesById = useMemo(() => byId(milestones), [milestones]);
  const dLeft = daysUntilDemo(date);

  const layoutedBlocks = useMemo(() => {
    const blocks = tasks
      .filter((t) => t.schedule?.some((s) => s.date === date))
      .map((task) => {
        const sched = task.schedule.find((s) => s.date === date);
        return { task, startTime: sched.start_time, endTime: sched.end_time };
      });
    return layoutBlocks(blocks);
  }, [tasks, date]);

  const unscheduledAssigned = useMemo(() =>
    tasks.filter((t) =>
      t.assignments.some((a) => a.assigned_date === date) &&
      !t.schedule?.some((s) => s.date === date)
    ),
    [tasks, date]
  );

  const unassignedPeople = people.filter((p) =>
    !tasks.some((t) => t.assignments.some((a) => a.person_id === p.id && a.assigned_date === date))
  );

  async function exportPNG() {
    setExporting(true);
    ref.current.classList.add('exporting');

    // Crop the calendar to the hours actually used (± 30 min padding).
    const calOuter = ref.current.querySelector('.report-cal-outer');
    const calInner = calOuter?.querySelector('.cal-inner');
    const PAD = PX_PER_HOUR * 0.5; // 30 min

    let cropTop = 0;
    let cropH = CAL_HEIGHT;
    if (calInner && layoutedBlocks.length > 0) {
      const minY = Math.min(...layoutedBlocks.map((b) => timeToY(b.startTime)));
      const maxY = Math.max(...layoutedBlocks.map((b) => timeToY(b.endTime)));
      cropTop = Math.max(0, minY - PAD);
      cropH   = Math.min(CAL_HEIGHT, maxY + PAD) - cropTop;
      calInner.style.marginTop = `-${cropTop}px`;
      calOuter.style.height    = `${cropH}px`;
    }

    try {
      const canvas = await html2canvas(ref.current, { backgroundColor: '#ffffff', scale: 2 });
      const a = document.createElement('a');
      a.download = `parte-${date}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
    } finally {
      if (calInner) { calInner.style.marginTop = ''; calOuter.style.height = ''; }
      ref.current.classList.remove('exporting');
      setExporting(false);
    }
  }

  const hours     = Array.from({ length: TOTAL_H + 1 }, (_, i) => START_HOUR + i); // 6..26
  const halfHours = Array.from({ length: TOTAL_H },     (_, i) => START_HOUR + i);

  return (
    <div className="view report-view">
      <div className="row gap">
        <label className="row gap">
          Día <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button className="primary" onClick={exportPNG} disabled={exporting}>
          {exporting ? 'Exportando…' : '⬇ Exportar PNG'}
        </button>
        {!isPublic && (
          <a className="muted" href={`/parte?date=${date}`} target="_blank" rel="noreferrer">
            enlace público ↗
          </a>
        )}
      </div>

      <div className="report" ref={ref}>
        <div className="report-header">
          <div className="report-date">{formatDate(date)} · {date}</div>
          <div className={`countdown ${dLeft <= 3 ? 'urgent' : ''}`}>
            {dLeft > 0 ? `${dLeft} días hasta la demo` : dLeft === 0 ? '¡DEMO HOY!' : 'post-demo'}
          </div>
        </div>

        {/* Vertical calendar */}
        <div className="report-cal-outer">
          <div className="cal-inner" style={{ height: CAL_HEIGHT + 32 }}>
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

            <div className="cal-events">
              {hours.map((h) => (
                <div
                  key={`hl${h}`}
                  className={`cal-hline${h === 12 ? ' midday' : h === 24 ? ' midnight' : ''}`}
                  style={{ top: (h - START_HOUR) * PX_PER_HOUR }}
                />
              ))}
              {halfHours.map((h) => (
                <div
                  key={`hh${h}`}
                  className="cal-hline half"
                  style={{ top: (h - START_HOUR + 0.5) * PX_PER_HOUR }}
                />
              ))}

              {layoutedBlocks.map(({ task, startTime, endTime, col, localCols }) => {
                const top    = timeToY(startTime);
                const height = Math.max(
                  (timeToMin(endTime) - timeToMin(startTime)) / 60 * PX_PER_HOUR - 2,
                  28
                );
                const leftPct  = (col / localCols) * 100;
                const widthPct = (1 / localCols) * 100 - 0.4;
                const todayAssignees = task.assignments.filter((a) => a.assigned_date === date);
                const m = task.milestone_id && milestonesById.get(task.milestone_id);

                return (
                  <div
                    key={task.id}
                    className={`cal-block st-${task.status}${!!task.is_critical ? ' critical' : ''}`}
                    style={{ top, height, left: `${leftPct}%`, width: `${widthPct}%` }}
                  >
                    <div className="cal-block-header">
                      <span className="cal-block-title">
                        {!!task.is_critical && '● '}{task.title}
                        {task.status === 'done' && ' ✔'}
                      </span>
                      <span className="cal-block-time">{startTime}–{endTime}</span>
                    </div>
                    {height >= 38 && (
                      <div className="cal-block-assignees">
                        {todayAssignees.map((a) => (
                          <span key={a.person_id} className="assignee-pill">
                            {peopleById.get(a.person_id)?.name}
                          </span>
                        ))}
                        {todayAssignees.length === 0 && (
                          <span className="cal-drop-hint">Sin asignar</span>
                        )}
                      </div>
                    )}
                    {m && height >= 56 && (
                      <div className="cal-block-milestone">{m.name}</div>
                    )}
                  </div>
                );
              })}

              {layoutedBlocks.length === 0 && (
                <div className="cal-empty-hint">Sin tareas planificadas para este día</div>
              )}
            </div>
          </div>
        </div>

        {/* Tasks assigned but without a scheduled time slot */}
        {unscheduledAssigned.length > 0 && (
          <div className="report-unscheduled">
            <div className="report-unscheduled-title">Sin horario</div>
            {unscheduledAssigned.map((t) => {
              const assignees = t.assignments
                .filter((a) => a.assigned_date === date)
                .map((a) => peopleById.get(a.person_id)?.name)
                .filter(Boolean);
              return (
                <div key={t.id} className="report-unscheduled-item">
                  <span>{!!t.is_critical && '● '}{t.title}{t.status === 'done' ? ' ✔' : ''}</span>
                  <span className="muted">
                    {fmtHours(t.estimate_hours || 0)}h
                    {assignees.length ? ` · ${assignees.join(', ')}` : ''}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {unassignedPeople.length > 0 && (
          <div className="report-footer">
            Sin asignación: {unassignedPeople.map((p) => p.name).join(', ')}
          </div>
        )}
      </div>
    </div>
  );
}
