const test = require('node:test');
const assert = require('node:assert');
const { wouldCreateCycle } = require('../graph');

const deps = (pairs) => pairs.map(([task_id, depends_on_task_id]) => ({ task_id, depends_on_task_id }));

test('no cycle in a simple chain', () => {
  // 3 -> 2 -> 1, adding 4 -> 3 is fine
  assert.equal(wouldCreateCycle(4, [3], deps([[2, 1], [3, 2]])), false);
});

test('direct cycle: A depends on B, B depends on A', () => {
  assert.equal(wouldCreateCycle(1, [2], deps([[2, 1]])), true);
});

test('transitive cycle: A -> B -> C, adding C -> A', () => {
  // task 3 deps on 2, 2 deps on 1; making 1 depend on 3 closes the loop
  assert.equal(wouldCreateCycle(1, [3], deps([[2, 1], [3, 2]])), true);
});

test('replacing own deps does not count the old edges', () => {
  // 1 currently depends on 2; replacing 2's deps with [3] is fine even
  // though the old edge list contains 2 -> ... entries being replaced
  assert.equal(wouldCreateCycle(2, [3], deps([[1, 2], [2, 3]])), false);
});

test('diamond is not a cycle', () => {
  // 4 depends on 2 and 3; both depend on 1
  assert.equal(wouldCreateCycle(4, [2, 3], deps([[2, 1], [3, 1]])), false);
});

test('long cycle detected', () => {
  const chain = deps([[2, 1], [3, 2], [4, 3], [5, 4]]);
  assert.equal(wouldCreateCycle(1, [5], chain), true);
});
