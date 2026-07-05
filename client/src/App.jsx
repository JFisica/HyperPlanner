import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiSend, getPin, setPin, clearPin } from './api';
import { todayISO } from './lib';
import Team from './views/Team';
import Backlog from './views/Backlog';
import Assign from './views/Assign';
import Report from './views/Report';
import Milestones from './views/Milestones';

const IS_PUBLIC = window.location.pathname.startsWith('/parte');

const TABS = [
  ['asignacion', 'Asignación'],
  ['backlog', 'Backlog'],
  ['equipo', 'Equipo'],
  ['hitos', 'Hitos'],
  ['parte', 'Parte del día'],
];

export default function App() {
  const [state, setState] = useState(null);
  const [tab, setTab] = useState('asignacion');
  const [date, setDate] = useState(() => {
    const q = new URLSearchParams(window.location.search).get('date');
    return q || todayISO();
  });
  const [authed, setAuthed] = useState(!!getPin());
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
      setOffline(true); // keep showing last loaded state
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  // Every mutation returns the full updated state.
  const mutate = useCallback(
    async (method, path, body) => {
      try {
        const s = await apiSend(method, path, body);
        setState(s);
        setOffline(false);
        return true;
      } catch (e) {
        if (e.status === 401) {
          clearPin();
          setAuthed(false);
        }
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

  if (!authed) {
    return <PinGate onOk={() => setAuthed(true)} showToast={showToast} toast={toast} />;
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
          {tab === 'parte' && <Report state={state} date={date} setDate={setDate} />}
        </main>
      )}

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}

function PinGate({ onOk, showToast, toast }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true);
    setPin(value.trim());
    try {
      await apiSend('POST', '/api/login', {});
      onOk();
    } catch (err) {
      clearPin();
      showToast(err.status === 401 ? 'PIN incorrecto' : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pin-gate">
      <form onSubmit={submit}>
        <h1>⚡ EHW Task Command</h1>
        <input
          type="password"
          placeholder="PIN"
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="submit" disabled={busy}>Entrar</button>
      </form>
      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}
