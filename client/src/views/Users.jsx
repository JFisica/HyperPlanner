import { useEffect, useState } from 'react';
import { apiGet, apiSend } from '../api';

export default function Users({ currentUser, showToast }) {
  const [users, setUsers] = useState(null);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('coordinator');

  async function refresh() {
    try {
      setUsers(await apiGet('/api/users'));
    } catch (e) {
      showToast?.(e.message);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function addUser(e) {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword) return;
    try {
      setUsers(await apiSend('POST', '/api/users', {
        username: newUsername.trim(),
        password: newPassword,
        role: newRole,
      }));
      setNewUsername('');
      setNewPassword('');
      setNewRole('coordinator');
    } catch (e) {
      showToast?.(e.message);
    }
  }

  async function changeRole(u, role) {
    try {
      setUsers(await apiSend('PUT', `/api/users/${u.id}`, { role }));
    } catch (e) {
      showToast?.(e.message);
    }
  }

  async function resetPassword(u) {
    const password = window.prompt(`Nueva contraseña para ${u.username}:`);
    if (!password) return;
    try {
      setUsers(await apiSend('PUT', `/api/users/${u.id}`, { password }));
      showToast?.('Contraseña actualizada', 'warn');
    } catch (e) {
      showToast?.(e.message);
    }
  }

  async function deleteUser(u) {
    if (!window.confirm(`¿Eliminar a ${u.username}?`)) return;
    try {
      setUsers(await apiSend('DELETE', `/api/users/${u.id}`));
    } catch (e) {
      showToast?.(e.message);
    }
  }

  return (
    <div className="view">
      <form onSubmit={addUser} className="row gap wrap">
        <input placeholder="Usuario" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
        <input type="password" placeholder="Contraseña" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        <select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
          <option value="coordinator">Coordinador</option>
          <option value="admin">Administrador</option>
        </select>
        <button type="submit" className="primary">+ Usuario</button>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Rol</th>
              <th>Creado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(users || []).map((u) => (
              <tr key={u.id}>
                <td><b>{u.username}</b>{u.id === currentUser.id && <span className="muted"> (tú)</span>}</td>
                <td>
                  <select value={u.role} onChange={(e) => changeRole(u, e.target.value)}>
                    <option value="coordinator">Coordinador</option>
                    <option value="admin">Administrador</option>
                  </select>
                </td>
                <td className="muted">{u.created_at}</td>
                <td className="actions">
                  <button className="mini" onClick={() => resetPassword(u)}>🔑 Contraseña</button>
                  <button className="mini danger" onClick={() => deleteUser(u)} disabled={u.id === currentUser.id}>×</button>
                </td>
              </tr>
            ))}
            {users && users.length === 0 && (
              <tr><td colSpan={4} className="empty">Sin usuarios.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
