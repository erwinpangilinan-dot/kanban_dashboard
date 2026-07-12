const { buildMessage } = require('./email');
const { isConfigured, getAccessToken, accountEmail } = require('./google-auth');

function isEnabled() {
  return isConfigured() && Boolean(process.env.EMAIL_TO);
}

function fromAddress() {
  return accountEmail() || 'me';
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
