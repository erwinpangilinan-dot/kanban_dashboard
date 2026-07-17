const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const db = require('../db');
const { isConfigured, accountEmail } = require('../services/google-auth');
const ollama = require('../services/ollama');
const gemini = require('../services/gemini');
const workspaceEmail = require('../services/workspace-email');
const workspaceCalendar = require('../services/workspace-calendar');
const emailAssistant = require('../services/email-assistant');
const emailAgent = require('../services/email-agent');

const router = express.Router();

function requireGoogle(_req, res, next) {
  if (!isConfigured()) {
    return res.status(503).json({
      error: 'Google Workspace is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN.',
    });
  }
  return next();
}

async function isLlmConfigured() {
  try {
    const { rows } = await db.query(
      "SELECT value FROM workspace_settings WHERE key = 'email_agent_llm_provider'"
    );
    const provider = rows.length ? rows[0].value : 'ollama';
    if (provider === 'gemini') {
      return await gemini.isConfigured();
    }
  } catch (err) {
    // defaults to ollama
  }
  return ollama.isConfigured();
}

async function requireAssistant(_req, res, next) {
  const ready = await isLlmConfigured();
  if (!ready) {
    return res.status(503).json({
      error: 'Email assistant is not configured. Configure Ollama or Gemini in Settings.',
    });
  }
  return next();
}

router.use(requireGoogle);

async function getLlmProvider() {
  try {
    const { rows } = await db.query(
      "SELECT value FROM workspace_settings WHERE key = 'email_agent_llm_provider'"
    );
    if (rows.length && rows[0].value === 'gemini') {
      return 'gemini';
    }
  } catch (err) {
    // defaults to ollama
  }
  return 'ollama';
}

router.get('/status', asyncHandler(async (_req, res) => {
  const provider = await getLlmProvider();
  const assistantReady = await isLlmConfigured();
  res.json({
    enabled: true,
    email: true,
    calendar: true,
    assistant: assistantReady ? provider : false,
    account: accountEmail(),
  });
}));

router.get('/email/messages', asyncHandler(async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : 'in:inbox';
  const max = Math.min(Number(req.query.max) || 25, 50);
  res.json(await workspaceEmail.listMessages({ q, maxResults: max }));
}));

router.get('/email/messages/:id', asyncHandler(async (req, res) => {
  res.json(await workspaceEmail.getMessage(req.params.id));
}));

router.post('/email/send', asyncHandler(async (req, res) => {
  const { to, subject, body, thread_id: threadId, in_reply_to: inReplyTo } = req.body;
  if (!to || !subject || !body) {
    return res.status(400).json({ error: 'to, subject, and body are required.' });
  }
  res.status(201).json(await workspaceEmail.sendMessage({
    to,
    subject,
    body,
    threadId,
    inReplyTo,
  }));
}));

router.delete('/email/messages/:id', asyncHandler(async (req, res) => {
  await workspaceEmail.deleteMessage(req.params.id);
  res.status(204).send();
}));

router.post('/email/assistant/review/:id', requireAssistant, asyncHandler(async (req, res) => {
  res.json(await emailAssistant.reviewMessage(req.params.id));
}));

router.post('/email/assistant/scan', requireAssistant, asyncHandler(async (req, res) => {
  const q = typeof req.body?.q === 'string' ? req.body.q : 'in:inbox';
  const max = Math.min(Number(req.body?.max) || 5, 10);
  res.json(await emailAssistant.scanInbox({ q, max }));
}));

router.post('/email/assistant/cleanup', requireAssistant, asyncHandler(async (req, res) => {
  const q = typeof req.body?.q === 'string' ? req.body.q : 'in:inbox';
  const max = Math.min(Number(req.body?.max) || 25, 50);
  res.json(await emailAssistant.cleanupInbox({ q, max }));
}));

// ── Email Agent Reviews ────────────────────────────────────────────────────────

router.get('/email/agent/reviews', asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  res.json(await emailAgent.getAllReviews(limit));
}));

router.get('/email/agent/pending', asyncHandler(async (req, res) => {
  res.json(await emailAgent.getPendingReviews());
}));

router.post('/email/agent/approve/:id', asyncHandler(async (req, res) => {
  const { body } = req.body;
  if (!body) return res.status(400).json({ error: 'body is required' });
  res.json(await emailAgent.approveAndSendDraft(req.params.id, body));
}));

router.post('/email/agent/reject/:id', asyncHandler(async (req, res) => {
  res.json(await emailAgent.rejectDraft(req.params.id));
}));

router.post('/email/agent/trigger', asyncHandler(async (req, res) => {
  await emailAgent.checkInboxForAgentReviews();
  res.json({ success: true });
}));

router.get('/calendar/events', asyncHandler(async (req, res) => {
  const days = Math.min(Number(req.query.days) || 14, 90);
  const max = Math.min(Number(req.query.max) || 50, 100);
  res.json(await workspaceCalendar.listEvents({ days, maxResults: max }));
}));

router.post('/calendar/events', asyncHandler(async (req, res) => {
  const { summary, description, location, start, end, all_day: allDay } = req.body;
  if (!summary || !start || !end) {
    return res.status(400).json({ error: 'summary, start, and end are required.' });
  }
  res.status(201).json(await workspaceCalendar.createEvent({
    summary,
    description,
    location,
    start,
    end,
    allDay,
  }));
}));

router.patch('/calendar/events/:id', asyncHandler(async (req, res) => {
  res.json(await workspaceCalendar.updateEvent(req.params.id, req.body));
}));

router.delete('/calendar/events/:id', asyncHandler(async (req, res) => {
  await workspaceCalendar.deleteEvent(req.params.id);
  res.status(204).send();
}));

// ── Workspace Settings ───────────────────────────────────────────────────────

router.get('/settings', asyncHandler(async (req, res) => {
  const { rows } = await db.query('SELECT key, value FROM workspace_settings');
  const settings = {
    email_agent_llm_provider: 'ollama',
    gemini_api_key: ''
  };
  rows.forEach(r => {
    if (r.key === 'gemini_api_key' && r.value) {
      settings[r.key] = '********';
    } else {
      settings[r.key] = r.value;
    }
  });
  res.json(settings);
}));

router.post('/settings', asyncHandler(async (req, res) => {
  const { email_agent_llm_provider, gemini_api_key } = req.body;

  if (email_agent_llm_provider) {
    if (!['ollama', 'gemini'].includes(email_agent_llm_provider)) {
      return res.status(400).json({ error: 'Invalid provider choice' });
    }
    await db.query(
      `INSERT INTO workspace_settings (key, value) VALUES ('email_agent_llm_provider', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [email_agent_llm_provider]
    );
  }

  if (gemini_api_key !== undefined) {
    if (gemini_api_key !== '********') {
      await db.query(
        `INSERT INTO workspace_settings (key, value) VALUES ('gemini_api_key', $1)
         ON CONFLICT (key) DO UPDATE SET value = $1`,
        [gemini_api_key]
      );
    }
  }

  res.json({ success: true });
}));

module.exports = router;
