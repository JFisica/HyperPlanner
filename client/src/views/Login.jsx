import { useState } from 'react';
import { apiSend } from '../api';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const user = await apiSend('POST', '/api/login', { username: username.trim(), password });
      onLogin(user);
    } catch (err) {
      setError(err.message || 'Error al iniciar sesión');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pin-gate">
      <form onSubmit={submit}>
        <h1>⚡ EHW <span>Task Command</span></h1>
        <label className="login-label">
          Usuario
          <input
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
        </label>
        <label className="login-label">
          Contraseña
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <div className="login-error">{error}</div>}
        <button className="primary" type="submit" disabled={busy || !username || !password}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
