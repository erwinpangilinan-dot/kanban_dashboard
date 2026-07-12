#!/usr/bin/env node
const assert = require('assert');
const { normalizeReview, salvageReviewJson, isUnparseableReviewError, CATEGORIES } = require('../src/services/email-assistant');
const { repairJsonText, parseJsonContent } = require('../src/services/ollama');

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

const systemNotice = normalizeReview({
  category: 'notification',
  needs_reply: false,
  should_delete: true,
  summary: 'App status digest',
  reasoning: 'Routine automated blast',
  draft_reply: null,
}, 'msg-notify');
assert.strictEqual(systemNotice.should_delete, true, 'notification cleanup allowed');

const receipt = normalizeReview({
  category: 'notification',
  needs_reply: false,
  should_delete: false,
  summary: 'Your order shipped',
  reasoning: 'Transactional shipping alert',
  draft_reply: null,
}, 'msg-ship');
assert.strictEqual(receipt.should_delete, false);

const newsletter = normalizeReview({
  category: 'newsletter',
  needs_reply: false,
  should_delete: true,
  summary: 'Weekly digest',
  reasoning: 'Mailing list roundup',
  draft_reply: null,
}, 'msg-news');
assert.strictEqual(newsletter.should_delete, true, 'newsletter cleanup allowed');

const junk = normalizeReview({ category: 'bogus' }, 'msg-3');
assert.strictEqual(junk.category, 'other');
assert.deepStrictEqual(CATEGORIES.length, 5);

const broken = '{ "category": "notification", "needs_reply": false, "should_delete": true, "summary": \\"Automated email notification about';
const salvaged = salvageReviewJson(broken);
assert.strictEqual(salvaged?.category, 'notification');
assert.strictEqual(salvaged?.should_delete, true);

const repaired = parseJsonContent(repairJsonText(
  '{ "category": "notification", "needs_reply": false, "summary": \\"Hello world\\" }'
));
assert.strictEqual(repaired.category, 'notification');
assert.strictEqual(repaired.summary, 'Hello world');

assert.strictEqual(
  isUnparseableReviewError(new Error('Model returned invalid JSON: {"category":')),
  true,
);
assert.strictEqual(isUnparseableReviewError(new Error('Gmail API failed')), false);

console.log('✓ email assistant helpers passed');
