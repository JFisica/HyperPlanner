import { useEffect, useRef, useState } from 'react';

function SkillMenu({ person, skills, onToggle, onClose }) {
  const ref = useRef(null);
  const available = skills.filter((s) => !person.skill_ids.includes(s.id));

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div className="skill-menu" ref={ref}>
      {available.length === 0 ? (
        <div className="skill-menu-empty">Todas añadidas</div>
      ) : (
        available.map((s) => (
          <div key={s.id} className="skill-menu-item" onMouseDown={() => { onToggle(s.id); onClose(); }}>
            {s.name}
          </div>
        ))
      )}
    </div>
  );
}

export default function Team({ state, mutate }) {
  const { people, skills } = state;
  const [newName, setNewName]   = useState('');
  const [newSkill, setNewSkill] = useState('');
  const [openMenu, setOpenMenu] = useState(null); // person id with menu open

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

  return (
    <div className="view">
      <div className="row gap wrap">
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

      {/* Skills legend */}
      {skills.length > 0 && (
        <div className="row gap wrap">
          {skills.map((s) => (
            <span key={s.id} className="skill-legend-pill">
              {s.name}
              <button
                className="pill-remove"
                onClick={() => mutate('DELETE', `/api/skills/${s.id}`)}
                title="Eliminar skill"
              >×</button>
            </span>
          ))}
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Notas</th>
              <th>Skills</th>
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
                <td className="skills-td">
                  <div className="skill-pills">
                    {p.skill_ids.map((sid) => {
                      const skill = skills.find((s) => s.id === sid);
                      if (!skill) return null;
                      return (
                        <span key={sid} className="skill-pill">
                          {skill.name}
                          <button
                            className="pill-remove"
                            onClick={() => toggleSkill(p, sid)}
                            title="Quitar skill"
                          >×</button>
                        </span>
                      );
                    })}
                    {skills.length > p.skill_ids.length && (
                      <div className="skill-add-wrap">
                        <button
                          className="mini"
                          onClick={() => setOpenMenu(openMenu === p.id ? null : p.id)}
                        >
                          + skill
                        </button>
                        {openMenu === p.id && (
                          <SkillMenu
                            person={p}
                            skills={skills}
                            onToggle={(sid) => toggleSkill(p, sid)}
                            onClose={() => setOpenMenu(null)}
                          />
                        )}
                      </div>
                    )}
                    {p.skill_ids.length === 0 && skills.length === 0 && (
                      <span className="muted" style={{ fontSize: 12 }}>—</span>
                    )}
                  </div>
                </td>
                <td>
                  <button
                    className="mini danger"
                    onClick={() => mutate('DELETE', `/api/people/${p.id}`)}
                  >×</button>
                </td>
              </tr>
            ))}
            {people.length === 0 && (
              <tr>
                <td colSpan={4} className="empty">Añade personas al equipo.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
