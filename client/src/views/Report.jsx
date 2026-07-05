import { useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { byId, tasksForPersonDay, daysUntilDemo, fmtHours, formatDate } from '../lib';

export default function Report({ state, date, setDate, isPublic = false }) {
  const { people, tasks, milestones } = state;
  const ref = useRef(null);
  const [exporting, setExporting] = useState(false);

  const milestonesById = useMemo(() => byId(milestones), [milestones]);

  const withTasks = people
    .map((p) => ({ person: p, dayTasks: tasksForPersonDay(tasks, p.id, date) }))
    .filter((x) => x.dayTasks.length > 0);
  const without = people.filter((p) => tasksForPersonDay(tasks, p.id, date).length === 0);

  const dLeft = daysUntilDemo(date);

  async function exportPNG() {
    setExporting(true);
    try {
      const canvas = await html2canvas(ref.current, { backgroundColor: '#ffffff', scale: 2 });
      const a = document.createElement('a');
      a.download = `parte-${date}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="view report-view">
      <div className="row gap no-print">
        <label className="row gap">
          Día
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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
          <div>
            <div className="report-title">PARTE DEL DÍA</div>
            <div className="report-date">{formatDate(date)} · {date}</div>
          </div>
          <div className={`countdown ${dLeft <= 3 ? 'urgent' : ''}`}>
            {dLeft > 0 ? `D−${dLeft}` : dLeft === 0 ? '¡DEMO HOY!' : 'post-demo'}
            {dLeft > 0 && <span className="countdown-sub">para la demo</span>}
          </div>
        </div>

        {withTasks.map(({ person, dayTasks }) => (
          <div key={person.id} className="report-card">
            <div className="report-person">
              {person.name}
              <span className="report-total">
                {fmtHours(dayTasks.reduce((s, t) => s + (t.estimate_hours || 0), 0))}h
              </span>
            </div>
            {dayTasks.map((t) => (
              <div key={t.id} className={`report-task ${t.is_critical ? 'critical' : ''}`}>
                <span className="report-task-title">
                  {t.is_critical ? '🔴 ' : ''}{t.title}{t.status === 'done' ? ' ✔' : ''}
                </span>
                <span className="report-task-meta">
                  {fmtHours(t.estimate_hours || 0)}h
                  {t.location ? ` · ${t.location}` : ''}
                  {t.milestone_id && milestonesById.get(t.milestone_id)
                    ? ` · ${milestonesById.get(t.milestone_id).name}`
                    : ''}
                </span>
              </div>
            ))}
          </div>
        ))}

        {withTasks.length === 0 && (
          <p className="report-empty">Sin asignaciones para este día.</p>
        )}

        {without.length > 0 && withTasks.length > 0 && (
          <div className="report-footer">
            Sin asignación: {without.map((p) => p.name).join(', ')}
          </div>
        )}
      </div>
    </div>
  );
}
