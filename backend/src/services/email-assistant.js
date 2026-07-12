const ollama = require('./ollama');
const workspaceEmail = require('./workspace-email');

const CATEGORIES = ['important', 'advertisement', 'newsletter', 'notification', 'other'];
const CLEANUP_CATEGORIES = new Set(['advertisement', 'notification', 'newsletter']);

const SYSTEM_PROMPT = `You are a personal email assistant. Analyze the email and respond ONLY with valid JSON (no markdown fences):
{
  "category": "important" | "advertisement" | "newsletter" | "notification" | "other",
  "needs_reply": boolean,
  "should_delete": boolean,
  "summary": "one sentence",
  "reasoning": "brief explanation",
  "draft_reply": null | { "subject": "string", "body": "string" }
}

Rules:
- important: personal, work, bills, appointments, actionable requests
- advertisement: marketing promos, sales spam, unsolicited ads
- newsletter: subscribed digests, content roundups, mailing-list editions (not pure ads)
- notification: automated system alerts, app digests, platform status updates
- needs_reply=true only when a thoughtful human reply is clearly expected
- should_delete=true for advertisement/promotional spam, low-value automated system notifications, or newsletter/digest editions the user likely does not need — never for important personal mail, receipts, invoices, shipping, security, or billing alerts
- draft_reply only when needs_reply is true; write a polite, concise reply in a professional tone
- Output strict JSON only: double-quoted strings, no backslash-escaped quotes inside values, no markdown`;

function salvageReviewJson(text) {
  const categoryMatch = text.match(/"category"\s*:\s*(?:"([^"]+)"|\\"([^"\\]+))/i);
  const categoryRaw = (categoryMatch?.[1] || categoryMatch?.[2] || '').toLowerCase();
  if (!categoryRaw) return null;

  const needsReply = /"needs_reply"\s*:\s*true/i.test(text);
  const shouldDelete = /"should_delete"\s*:\s*true/i.test(text);
  const summary = text.match(/"summary"\s*:\s*(?:"([^"]*)"|\\"([^"]*))/i);
  const reasoning = text.match(/"reasoning"\s*:\s*(?:"([^"]*)"|\\"([^"]*))/i);

  return {
    category: CATEGORIES.includes(categoryRaw) ? categoryRaw : 'other',
    needs_reply: needsReply,
    should_delete: shouldDelete,
    summary: (summary?.[1] || summary?.[2] || '').slice(0, 500),
    reasoning: (reasoning?.[1] || reasoning?.[2] || '').slice(0, 1000),
    draft_reply: null,
  };
}

async function parseReviewResponse(messages) {
  const content = await ollama.chat({ messages });
  try {
    return ollama.parseJsonContent(content);
  } catch {
    const salvaged = salvageReviewJson(content);
    if (salvaged) return salvaged;
    throw new Error(`Model returned invalid JSON: ${content.slice(0, 120)}`);
  }
}

function normalizeReview(raw, messageId) {
  const category = CATEGORIES.includes(raw?.category) ? raw.category : 'other';
  const needsReply = Boolean(raw?.needs_reply);
  const shouldDelete = Boolean(raw?.should_delete) && CLEANUP_CATEGORIES.has(category);

  let draftReply = null;
  if (needsReply && raw?.draft_reply && typeof raw.draft_reply === 'object') {
    draftReply = {
      subject: String(raw.draft_reply.subject || '').slice(0, 500),
      body: String(raw.draft_reply.body || '').slice(0, 10_000),
    };
    if (!draftReply.body.trim()) draftReply = null;
  }

  return {
    message_id: messageId,
    category,
    needs_reply: needsReply,
    should_delete: shouldDelete,
    summary: String(raw?.summary || '').slice(0, 500),
    reasoning: String(raw?.reasoning || '').slice(0, 1000),
    draft_reply: draftReply,
  };
}

async function reviewMessage(messageId) {
  const msg = await workspaceEmail.getMessage(messageId);
  const body = (msg.body || msg.snippet || '').slice(0, 8000);

  const raw = await parseReviewResponse([
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `From: ${msg.from}\nTo: ${msg.to}\nSubject: ${msg.subject}\nDate: ${msg.date}\n\n${body}`,
    },
  ]);

  return {
    ...normalizeReview(raw, messageId),
    subject: msg.subject,
    from: msg.from,
  };
}

async function scanInbox({ q = 'in:inbox', max = 5 } = {}) {
  const limit = Math.min(Math.max(Number(max) || 5, 1), 10);
  const messages = await workspaceEmail.listMessages({ q, maxResults: limit });
  const reviews = [];

  for (const msg of messages) {
    try {
      reviews.push(await reviewMessage(msg.id));
    } catch (err) {
      reviews.push({
        message_id: msg.id,
        subject: msg.subject,
        from: msg.from,
        category: 'other',
        needs_reply: false,
        should_delete: false,
        summary: '',
        reasoning: '',
        draft_reply: null,
        error: err.message,
      });
    }
  }

  return { reviews, scanned: reviews.length };
}

function isUnparseableReviewError(err) {
  return String(err?.message || err).startsWith('Model returned invalid JSON');
}

async function cleanupInbox({ q = 'in:inbox', max = 25 } = {}) {
  const limit = Math.min(Math.max(Number(max) || 25, 1), 50);
  const messages = await workspaceEmail.listMessages({ q, maxResults: limit });
  const deleted = [];
  const skipped = [];
  const errors = [];

  for (const msg of messages) {
    try {
      const review = await reviewMessage(msg.id);
      if (review.should_delete) {
        await workspaceEmail.deleteMessage(msg.id);
        deleted.push({
          message_id: msg.id,
          subject: msg.subject || review.subject,
          from: msg.from || review.from,
        });
      } else {
        skipped.push({
          message_id: msg.id,
          subject: msg.subject,
          category: review.category,
        });
      }
    } catch (err) {
      if (isUnparseableReviewError(err)) {
        try {
          await workspaceEmail.deleteMessage(msg.id);
          deleted.push({
            message_id: msg.id,
            subject: msg.subject,
            from: msg.from,
          });
        } catch (deleteErr) {
          errors.push({
            message_id: msg.id,
            subject: msg.subject,
            error: deleteErr.message,
          });
        }
      } else {
        errors.push({
          message_id: msg.id,
          subject: msg.subject,
          error: err.message,
        });
      }
    }
  }

  return {
    scanned: messages.length,
    deleted: deleted.length,
    skipped: skipped.length,
    deleted_messages: deleted,
    errors,
  };
}

module.exports = {
  CATEGORIES,
  CLEANUP_CATEGORIES,
  normalizeReview,
  salvageReviewJson,
  isUnparseableReviewError,
  reviewMessage,
  scanInbox,
  cleanupInbox,
};
