const { buildMessage } = require('./email');
const { googleFetch } = require('./google-auth');

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

function toBase64Url(value) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function headerValue(headers, name) {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function extractBody(payload) {
  if (!payload) return '';

  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf8');
  }

  const parts = payload.parts || [];
  const plain = parts.find((p) => p.mimeType === 'text/plain');
  if (plain?.body?.data) {
    return Buffer.from(plain.body.data, 'base64url').toString('utf8');
  }

  const html = parts.find((p) => p.mimeType === 'text/html');
  if (html?.body?.data) {
    return Buffer.from(html.body.data, 'base64url').toString('utf8');
  }

  for (const part of parts) {
    const nested = extractBody(part);
    if (nested) return nested;
  }

  return '';
}

function summarizeMessage(msg) {
  const headers = msg.payload?.headers || [];
  return {
    id: msg.id,
    thread_id: msg.threadId,
    subject: headerValue(headers, 'Subject') || '(no subject)',
    from: headerValue(headers, 'From'),
    to: headerValue(headers, 'To'),
    date: headerValue(headers, 'Date'),
    snippet: msg.snippet || '',
    unread: (msg.labelIds || []).includes('UNREAD'),
  };
}

async function listMessages({ q = 'in:inbox', maxResults = 25 } = {}) {
  const params = new URLSearchParams({
    q,
    maxResults: String(maxResults),
  });
  const list = await googleFetch(`${GMAIL}/messages?${params}`);
  const ids = (list.messages || []).map((m) => m.id);
  if (!ids.length) return [];

  const messages = await Promise.all(
    ids.map((id) => googleFetch(
      `${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`
    ))
  );

  return messages.map(summarizeMessage);
}

async function getMessage(id) {
  const msg = await googleFetch(`${GMAIL}/messages/${id}?format=full`);
  const summary = summarizeMessage(msg);
  return {
    ...summary,
    body: extractBody(msg.payload),
  };
}

async function sendMessage({ to, subject, body, threadId, inReplyTo }) {
  const from = process.env.EMAIL_FROM || process.env.GOOGLE_SEND_AS || 'me';
  const raw = buildMessage({
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
    text: body,
    ...(inReplyTo ? { inReplyTo } : {}),
  });

  const payload = { raw: toBase64Url(raw) };
  if (threadId) payload.threadId = threadId;

  const sent = await googleFetch(`${GMAIL}/messages/send`, {
    method: 'POST',
    body: payload,
  });

  return getMessage(sent.id);
}

module.exports = {
  listMessages,
  getMessage,
  sendMessage,
  summarizeMessage,
};
