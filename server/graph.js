// Dependency-graph helpers. Kept pure (no DB) so they can be unit-tested.

// Edges go task -> its dependencies. Adding taskId -> depIds creates a cycle
// if taskId is reachable from any of depIds following dependency edges.
function wouldCreateCycle(taskId, depIds, allDeps) {
  const adj = new Map();
  for (const { task_id, depends_on_task_id } of allDeps) {
    if (task_id === taskId) continue; // replaced by the new dep list
    if (!adj.has(task_id)) adj.set(task_id, []);
    adj.get(task_id).push(depends_on_task_id);
  }
  const stack = [...depIds];
  const seen = new Set();
  while (stack.length) {
    const n = stack.pop();
    if (n === taskId) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const m of adj.get(n) || []) stack.push(m);
  }
  return false;
}

module.exports = { wouldCreateCycle };
