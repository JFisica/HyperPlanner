import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiSend } from './api';
import { todayISO } from './lib';
import Team from './views/Team';
import Backlog from './views/Backlog';
import Assign from './views/Assign';
import Report from './views/Report';
import Milestones from './views/Milestones';
import CarpaPlan from './views/CarpaPlan';

const IS_PUBLIC = window.location.pathname.startsWith('/parte');

const TABS = [
  ['asignacion', 'Asignación'],
  ['backlog', 'Backlog'],
  ['equipo', 'Equipo'],
  ['hitos', 'Hitos'],
  ['plano-carpa', 'Plano carpa'],
  ['parte', 'Parte del día'],
];

export default function App() {
  const [state, setState] = useState(null);
  const [tab, setTab] = useState('asignacion');
  const [date, setDate] = useState(() => {
    const q = new URLSearchParams(window.location.search).get('date');
    return q || todayISO();
  });
  const [offline, setOffline] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const showToast = useCallback((msg, kind = 'error') => {
    setToast({ msg, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setState(await apiGet('/api/state'));
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const mutate = useCallback(
    async (method, path, body) => {
      try {
        const s = await apiSend(method, path, body);
        setState(s);
        setOffline(false);
        return true;
      } catch (e) {
        showToast(e.message);
        return false;
      }
    },
    [showToast]
  );

  if (IS_PUBLIC) {
    return (
      <div className="public-wrap">
        {state ? (
          <Report state={state} date={date} setDate={setDate} isPublic />
        ) : (
          <p className="loading">{offline ? 'Sin conexión…' : 'Cargando…'}</p>
        )}
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">⚡ EHW <span>Task Command</span></span>
        <nav>
          {TABS.map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? 'tab active' : 'tab'}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <span className={offline ? 'conn offline' : 'conn'}>
          {offline ? '⚠ sin conexión' : '● conectado'}
        </span>
      </header>

      {!state ? (
        <p className="loading">Cargando…</p>
      ) : (
        <main>
          {tab === 'equipo' && <Team state={state} mutate={mutate} />}
          {tab === 'backlog' && <Backlog state={state} mutate={mutate} />}
          {tab === 'asignacion' && (
            <Assign state={state} mutate={mutate} date={date} setDate={setDate} showToast={showToast} />
          )}
          {tab === 'hitos' && <Milestones state={state} mutate={mutate} />}
          {tab === 'plano-carpa' && <CarpaPlan />}
          {tab === 'parte' && <Report state={state} date={date} setDate={setDate} />}
        </main>
      )}

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}
