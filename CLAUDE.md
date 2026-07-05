# CLAUDE.md — EHW Task Command

## What this project is

Web app for task management during the 2 weeks of European Hyperloop Week (today is July 5th; work starts Monday the 6th and the demo is July 18th). Team of 20 people. Management is done by 2-4 coordinators; the rest of the team does NOT use the app: every morning they receive an exported image with their assignments for the day.

**Guiding principle: the app exists to answer in seconds "X just finished, what is the next most critical thing X can do?".** Any feature that doesn't serve that goal is out.

## Hard constraints

- **Must be operational tonight.** Prioritize a functional MVP over any refinement. If forced to choose, cut features, not core quality.
- Lifespan: 13 days. No future migrations, no scale, no i18n. Zero over-engineering.
- 2-5 concurrent users max (the coordinators).
- Must work on the venue WiFi (possibly bad): the app must tolerate latency, and the frontend must keep showing the last loaded state if the connection drops.

## Stack (non-negotiable, chosen for development speed)

- **Backend:** Node + Express + better-sqlite3. A single DB file (`data.db`). No ORM.
- **Frontend:** Vite + React. No state library (useState/useReducer + fetch). Plain CSS or Tailwind, whichever is fastest.
- **Sync between coordinators:** polling every 5 s (GET /api/state returns the full state; the DB easily fits in memory). No websockets.
- **Auth:** a single shared PIN (env var `ADMIN_PIN`), sent as a header on every write request. Public page reads require no PIN.
- **Image export:** html2canvas on the client over the "Daily Report" view.
- **Deploy:** a single process (`node server.js` serves the API and the static build). Must run the same on a laptop over LAN or on Railway/Fly.

## Data model

```sql
people(id, name, notes)
skills(id, name)                          -- e.g.: SMD soldering, STM32 firmware, HV, mechanical, wiring, testing
person_skills(person_id, skill_id)
milestones(id, name, due_date, sort_order)
tasks(
  id, title, description,
  milestone_id,
  estimate_hours REAL,
  status TEXT,            -- backlog | assigned | in_progress | blocked | done
  assignee_id,            -- NULL if unassigned
  assigned_date TEXT,     -- day it was assigned for (YYYY-MM-DD)
  is_critical INTEGER,    -- manual flag on top of the automatic computation
  location TEXT,          -- optional: boxes, workshop, track...
  created_at, updated_at
)
task_skills(task_id, skill_id)            -- REQUIRED skills (AND)
task_deps(task_id, depends_on_task_id)    -- task_id blocked by depends_on
```

## Domain rules (the logic that actually matters)

1. **Person-task compatibility:** a person is eligible for a task if they have ALL required skills. The UI never prevents an incompatible assignment (the coordinator is in charge), but flags it with a visible warning.
2. **Dependencies:** a task with non-done dependencies is "blocked". It can still be assigned (to prep the day) but is shown with a blocked badge and what blocks it. Detect and reject cycles when creating dependencies.
3. **Critical path:** using estimates and the dependency graph, compute the longest chain (in hours) toward each milestone. Tasks on that chain are painted red. Recompute on every change. Simple longest-path over a DAG (topological order); nothing sophisticated needed.
4. **Capacity:** each person has 10 h/day available by default (editable per person and per day — there are shifts and people arriving/leaving). The sum of estimates assigned to a person on a day must not exceed their capacity; if it does, warning, not a hard block.
5. **Suggested urgency:** when asking for the "next task for X", sort eligible and unblocked tasks by: on critical path > manual is_critical > nearest milestone > most hours of dependent descendants (unblocks the most work).

## Code conventions

- Spanish in the UI, English in code (identifiers, brief comments).
- Flat REST API: `/api/people`, `/api/tasks`, `/api/tasks/:id`, `/api/state`, `/api/assign`, etc. JSON always.
- Minimal server-side validation (ID existence, dep cycles). No validation libraries.
- Errors: respond `{error: "message"}` with the appropriate status; the frontend shows them in a toast.
- Small, frequent commits. The DB (`data.db`) goes in `.gitignore`; include `seed.js` with the 4 milestones and sample skills to bootstrap.
- No unit tests except for the critical path computation and cycle detection (those two yes, because a bug there corrupts decisions).

## What NOT to build

- Per-user login, roles, granular permissions.
- Notifications, emails, integrations.
- Interactive Gantt, date dragging.
- History/undo beyond being able to edit any field.
- Real offline mode, service workers.