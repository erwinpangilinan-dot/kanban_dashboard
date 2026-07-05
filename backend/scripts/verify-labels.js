#!/usr/bin/env node
const assert = require('assert');
const { escapeCsv, formatDate, boardToCsv, boardToJson } = require('../src/services/export');

assert.strictEqual(escapeCsv('plain'), 'plain');

assert.strictEqual(formatDate('2026-08-01T00:00:00.000Z'), '2026-08-01');
assert.strictEqual(formatDate(new Date('2026-08-01T00:00:00.000Z')), '2026-08-01');
assert.strictEqual(formatDate(null), '');
assert.strictEqual(escapeCsv('say "hi"'), '"say ""hi"""');
assert.strictEqual(escapeCsv('a,b'), '"a,b"');

const csv = boardToCsv({
  project: { name: 'Demo' },
  columns: [{
    name: 'To Do',
    tasks: [{
      title: 'Ship labels',
      description: 'Sprint 4',
      priority: 'high',
      assignee: 'Alex',
      due_date: '2026-08-01T00:00:00.000Z',
      labels: [{ name: 'feature' }, { name: 'sprint-4' }],
      github_issue_url: null,
    }],
  }],
});
assert(csv.includes('Ship labels'));
assert(csv.includes('feature; sprint-4'));

const json = boardToJson({
  project: { name: 'Demo' },
  board: { name: 'Main' },
  columns: [{ name: 'Done', tasks: [{ id: '1', title: 'Done task', priority: 'low', labels: [] }] }],
});
assert.strictEqual(json.columns[0].tasks[0].title, 'Done task');
assert(json.exported_at);

console.log('✓ labels and export helpers passed');
