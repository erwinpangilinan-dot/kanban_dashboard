#!/usr/bin/env node
const assert = require('assert');
const { escapeHtml, formatTaskLine, notifyOn } = require('../src/services/notify');

process.env.TELEGRAM_NOTIFY_ON = 'completed,urgent';
assert.deepStrictEqual([...notifyOn()], ['completed', 'urgent']);
assert.strictEqual(escapeHtml('<b>&'), '&lt;b&gt;&amp;');

const line = formatTaskLine(
  { title: 'Ship it', assignee: 'Alex', due_date: '2026-07-04T00:00:00.000Z' },
  'Mission Control'
);
assert(line.includes('<b>Ship it</b>'));
assert(line.includes('Mission Control'));

console.log('✓ notify helpers passed');
