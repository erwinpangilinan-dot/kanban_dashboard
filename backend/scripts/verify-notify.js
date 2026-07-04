#!/usr/bin/env node
const assert = require('assert');
const { escapeHtml, formatTaskLine, notifyOn } = require('../src/services/notify');
const { cronMatches } = require('../src/lib/cron');
const {
  formatDigestHtml,
  digestSubject,
  isEnabled: digestEnabled,
  isGmailEnabled,
  isSmtpEnabled,
} = require('../src/services/digest');
const { formatStatusReport } = require('../src/services/overview-data');
const { buildMessage } = require('../src/services/email');
const { toBase64Url, isEnabled: gmailEnabled } = require('../src/services/gmail');

process.env.TELEGRAM_NOTIFY_ON = 'completed,urgent';
assert.deepStrictEqual([...notifyOn()], ['completed', 'urgent']);
assert.strictEqual(escapeHtml('<b>&'), '&lt;b&gt;&amp;');

const line = formatTaskLine(
  { title: 'Ship it', assignee: 'Alex', due_date: '2026-07-04T00:00:00.000Z' },
  'Mission Control'
);
assert(line.includes('<b>Ship it</b>'));
assert(line.includes('Mission Control'));

assert(cronMatches('0 8 * * 1-5', new Date('2026-07-06T08:00:00')));
assert(!cronMatches('0 8 * * 1-5', new Date('2026-07-06T09:00:00')));
assert(!cronMatches('0 8 * * 1-5', new Date('2026-07-05T08:00:00')));

delete process.env.SMTP_HOST;
delete process.env.EMAIL_TO;
delete process.env.GOOGLE_REFRESH_TOKEN;
assert.strictEqual(digestEnabled(), false);

process.env.GOOGLE_CLIENT_ID = 'id';
process.env.GOOGLE_CLIENT_SECRET = 'secret';
process.env.GOOGLE_REFRESH_TOKEN = 'refresh';
process.env.EMAIL_TO = 'team@test';
assert.strictEqual(gmailEnabled(), true);
assert.strictEqual(isGmailEnabled(), true);
assert.strictEqual(isSmtpEnabled(), false);
assert.strictEqual(digestEnabled(), true);

delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;
delete process.env.GOOGLE_REFRESH_TOKEN;
process.env.SMTP_HOST = 'smtp.test';
assert.strictEqual(isSmtpEnabled(), true);
assert.strictEqual(digestEnabled(), true);

const report = formatStatusReport({
  metrics: {
    total: 3,
    backlog: 1,
    in_progress: 1,
    completed: 1,
    overdue: 0,
    due_this_week: 1,
    completed_this_week: 2,
  },
  projects: [{
    name: 'Mission Control',
    progress_percent: 50,
    active: 2,
    in_progress: 1,
    overdue: 0,
    description: 'Primary dashboard',
  }],
  upcoming: [{
    title: 'Ship digest',
    project_name: 'Mission Control',
    due_date: '2026-07-10T00:00:00.000Z',
    column_name: 'Backlog',
  }],
  activity: [{
    action: 'completed',
    task_title: 'Telegram alerts',
    project_name: 'Mission Control',
  }],
});
assert(report.includes('**Total tasks:** 3'));
assert(report.includes('Ship digest'));

const html = formatDigestHtml('# Title\n\n- **Bold item**');
assert(html.includes('<h1>Title</h1>'));
assert(html.includes('<strong>Bold item</strong>'));

const msg = buildMessage({
  from: 'bot@test',
  to: ['team@test'],
  subject: digestSubject(),
  text: 'hello',
  html: '<p>hello</p>',
});
assert(msg.includes('multipart/alternative'));
assert(msg.includes('hello'));

assert.strictEqual(toBase64Url('hello'), 'aGVsbG8');

console.log('✓ notify and digest helpers passed');
