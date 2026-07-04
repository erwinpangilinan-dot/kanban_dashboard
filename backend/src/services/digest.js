const { cronMatches } = require('../lib/cron');
const { fetchOverview, formatStatusReport } = require('./overview-data');
const { sendMail: sendSmtpMail } = require('./email');
const { sendMail: sendGmailMail, isEnabled: isGmailEnabled } = require('./gmail');

function isSmtpEnabled() {
  return Boolean(process.env.SMTP_HOST && process.env.EMAIL_TO);
}

function isEnabled() {
  return isGmailEnabled() || isSmtpEnabled();
}

function digestCron() {
  return process.env.EMAIL_DIGEST_CRON || '0 8 * * 1-5';
}

function formatDigestHtml(text) {
  const body = text
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '<p>&bull; $1</p>')
    .replace(/\n\n/g, '<br><br>');

  return `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">${body}</body></html>`;
}

function digestSubject() {
  const date = new Date().toISOString().slice(0, 10);
  return `Mission Control Daily Digest — ${date}`;
}

async function sendDailyDigest() {
  if (!isEnabled()) return false;

  const overview = await fetchOverview();
  const text = formatStatusReport(overview);
  const html = formatDigestHtml(text);
  const payload = { subject: digestSubject(), text, html };

  if (isGmailEnabled()) {
    await sendGmailMail(payload);
  } else {
    await sendSmtpMail(payload);
  }

  return true;
}

function slotKey(date) {
  return [
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
  ].join('-');
}

function startDigestScheduler() {
  if (!isEnabled()) return;

  const cron = digestCron();
  const via = isGmailEnabled() ? 'Gmail API' : 'SMTP';
  let lastSentKey = '';

  const tick = () => {
    const now = new Date();
    if (!cronMatches(cron, now)) return;

    const key = slotKey(now);
    if (key === lastSentKey) return;
    lastSentKey = key;

    sendDailyDigest().catch((err) => {
      console.error('Daily digest failed:', err.message);
      lastSentKey = '';
    });
  };

  tick();
  setInterval(tick, 60 * 1000);
  console.log(`Email digest scheduled (${cron}) via ${via}`);
}

module.exports = {
  isEnabled,
  isGmailEnabled,
  isSmtpEnabled,
  digestCron,
  formatDigestHtml,
  digestSubject,
  sendDailyDigest,
  startDigestScheduler,
};
