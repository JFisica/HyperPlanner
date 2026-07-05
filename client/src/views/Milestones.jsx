import { useState } from 'react';

const EMPTY = { name: '', due_date: '', sort_order: '' };

export default function Milestones({ state, mutate }) {
  const { milestones } = state;
  const [editing, setEditing] = useState(null); // null | 'new' | milestone obj
  const [form, setForm] = useState(EMPTY);

  function openNew() {
    setForm({ ...EMPTY, sort_order: milestones.length + 1 });
    setEditing('new');
  }

  function openEdit(m) {
    setForm({ name: m.name, due_date: m.due_date || '', sort_order: m.sort_order ?? '' });
    setEditing(m);
  }

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function save(e) {
    e.preventDefault();
    const body = {
      name: form.name.trim(),
      due_date: form.due_date || null,
      sort_order: Number(form.sort_order) || 0,
    };
    const ok = editing === 'new'
      ? await mutate('POST', '/api/milestones', body)
      : await mutate('PUT', `/api/milestones/${editing.id}`, body);
    if (ok) setEditing(null);
  }

  return (
    <div className="view">
      <div className="row gap">
        <button className="primary" onClick={openNew}>+ Nuevo hito</button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Nombre</th>
              <th>Fecha límite</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {milestones.map((m) => (
              <tr key={m.id}>
                <td className="muted" style={{ width: 40 }}>{m.sort_order}</td>
                <td><b>{m.name}</b></td>
                <td>{m.due_date || '—'}</td>
                <td className="actions">
                  <button className="mini" onClick={() => openEdit(m)}>✎</button>
                  <button className="mini danger" onClick={() => mutate('DELETE', `/api/milestones/${m.id}`)}>×</button>
                </td>
              </tr>
            ))}
            {milestones.length === 0 && (
              <tr><td colSpan={4} className="empty">Sin hitos. Añade uno para empezar.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setEditing(null)}>
          <form className="modal" onSubmit={save} style={{ width: 400 }}>
            <h2>{editing === 'new' ? 'Nuevo hito' : 'Editar hito'}</h2>

            <label>
              Nombre
              <input value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus required />
            </label>

            <label>
              Fecha límite
              <input type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} />
            </label>

            <label>
              Orden
              <input type="number" min="0" value={form.sort_order} onChange={(e) => set('sort_order', e.target.value)} />
            </label>

            <div className="row gap right">
              <button type="button" onClick={() => setEditing(null)}>Cancelar</button>
              <button type="submit" className="primary">Guardar</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
