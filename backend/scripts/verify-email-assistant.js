#!/usr/bin/env node
const assert = require('assert');
const { normalizeReview, CATEGORIES } = require('../src/services/email-assistant');

const ad = normalizeReview({
  category: 'advertisement',
  needs_reply: false,
  should_delete: true,
  summary: 'Promo sale',
  reasoning: 'Marketing email',
  draft_reply: null,
}, 'msg-1');

assert.strictEqual(ad.category, 'advertisement');
assert.strictEqual(ad.should_delete, true);
assert.strictEqual(ad.needs_reply, false);

const important = normalizeReview({
  category: 'important',
  needs_reply: true,
  should_delete: true,
  summary: 'Meeting request',
  reasoning: 'Boss asked for reply',
  draft_reply: { subject: 'Re: Meeting', body: 'Sounds good.' },
}, 'msg-2');

assert.strictEqual(important.should_delete, false, 'must not delete important mail');
assert.strictEqual(important.needs_reply, true);
assert.ok(important.draft_reply?.body.includes('Sounds good'));

const junk = normalizeReview({ category: 'bogus' }, 'msg-3');
assert.strictEqual(junk.category, 'other');
assert.deepStrictEqual(CATEGORIES.length, 5);

console.log('✓ email assistant helpers passed');
