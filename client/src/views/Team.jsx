import { useState } from 'react';

export default function Team({ state, mutate }) {
  const { people, skills } = state;
  const [newName, setNewName] = useState('');
  const [newSkill, setNewSkill] = useState('');

  async function addPerson(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    if (await mutate('POST', '/api/people', { name: newName.trim() })) setNewName('');
  }

  async function addSkill(e) {
    e.preventDefault();
    if (!newSkill.trim()) return;
    if (await mutate('POST', '/api/skills', { name: newSkill.trim() })) setNewSkill('');
  }

  function toggleSkill(person, skillId) {
    const has = person.skill_ids.includes(skillId);
    const skill_ids = has
      ? person.skill_ids.filter((id) => id !== skillId)
      : [...person.skill_ids, skillId];
    mutate('PUT', `/api/people/${person.id}`, { skill_ids });
  }

  function deletePerson(person) {
    if (confirm(`¿Eliminar a ${person.name}? Sus tareas quedarán sin asignar.`)) {
      mutate('DELETE', `/api/people/${person.id}`);
    }
  }

  function deleteSkill(skill) {
    if (confirm(`¿Eliminar la skill "${skill.name}"?`)) {
      mutate('DELETE', `/api/skills/${skill.id}`);
    }
  }

  return (
    <div className="view">
      <div className="row gap">
        <form onSubmit={addPerson} className="inline-form">
          <input
            placeholder="Nueva persona…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button type="submit">+ Persona</button>
        </form>
        <form onSubmit={addSkill} className="inline-form">
          <input
            placeholder="Nueva skill…"
            value={newSkill}
            onChange={(e) => setNewSkill(e.target.value)}
          />
          <button type="submit">+ Skill</button>
        </form>
      </div>

      <div className="table-wrap">
        <table className="matrix">
          <thead>
            <tr>
              <th>Nombre</th>
              <th title="Horas/día por defecto">h/día</th>
              <th>Notas</th>
              {skills.map((s) => (
                <th key={s.id} className="skill-col">
                  <span>{s.name}</span>
                  <button className="mini danger" onClick={() => deleteSkill(s)} title="Eliminar skill">
                    ×
                  </button>
                </th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id}>
                <td>
                  <input
                    className="cell-input name"
                    key={`n${p.id}-${p.name}`}
                    defaultValue={p.name}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== p.name) mutate('PUT', `/api/people/${p.id}`, { name: v });
                    }}
                  />
                </td>
                <td>
                  <input
                    className="cell-input hours"
                    type="number"
                    min="0"
                    step="0.5"
                    key={`c${p.id}-${p.capacity}`}
                    defaultValue={p.capacity}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (v !== p.capacity) mutate('PUT', `/api/people/${p.id}`, { capacity: v });
                    }}
                  />
                </td>
                <td>
                  <input
                    className="cell-input notes"
                    key={`o${p.id}-${p.notes}`}
                    defaultValue={p.notes}
                    placeholder="—"
                    onBlur={(e) => {
                      if (e.target.value !== p.notes)
                        mutate('PUT', `/api/people/${p.id}`, { notes: e.target.value });
                    }}
                  />
                </td>
                {skills.map((s) => (
                  <td key={s.id} className="check-cell">
                    <input
                      type="checkbox"
                      checked={p.skill_ids.includes(s.id)}
                      onChange={() => toggleSkill(p, s.id)}
                    />
                  </td>
                ))}
                <td>
                  <button className="mini danger" onClick={() => deletePerson(p)}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
            {people.length === 0 && (
              <tr>
                <td colSpan={skills.length + 4} className="empty">
                  Añade a las personas del equipo.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
