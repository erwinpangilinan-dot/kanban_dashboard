const { buildMessage } = require('./email');

function isEnabled() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID
    && process.env.GOOGLE_CLIENT_SECRET
    && process.env.GOOGLE_REFRESH_TOKEN
    && process.env.EMAIL_TO
  );
}

function fromAddress() {
  return process.env.EMAIL_FROM || process.env.GOOGLE_SEND_AS || 'me';
}

function recipients() {
  return (process.env.EMAIL_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function toBase64Url(value) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

let tokenCache = null;

async function getAccessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google token refresh failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return tokenCache.token;
}

async function sendMail({ subject, text, html }) {
  if (!isEnabled()) return false;

  const to = recipients();
  const raw = buildMessage({
    from: fromAddress(),
    to,
    subject,
    text,
    html,
  });

  const token = await getAccessToken();
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: toBase64Url(raw) }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail API send failed (${res.status}): ${body}`);
  }

  return true;
}

module.exports = {
  isEnabled,
  fromAddress,
  recipients,
  toBase64Url,
  getAccessToken,
  sendMail,
};
