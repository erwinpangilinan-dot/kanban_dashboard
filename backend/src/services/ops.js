const { isAuthEnabled } = require('../middleware/auth');
const telegram = require('./notify');
const digest = require('./digest');
const github = require('./github');
const { isConfigured: isGoogleConfigured } = require('./google-auth');
const { isConfigured: isOllamaConfigured } = require('./ollama');
const db = require('../db');

function publicUrl() {
  const url = (process.env.MISSION_CONTROL_PUBLIC_URL || '').trim();
  return url || null;
}

function getOpsStatus() {
  const url = publicUrl();
  return {
    public_url: url,
    tls: Boolean(url?.startsWith('https://')),
    auth: {
      enabled: isAuthEnabled(),
      api_token_configured: Boolean(process.env.AUTH_API_TOKEN),
      password_configured: Boolean(process.env.AUTH_PASSWORD),
      username: process.env.AUTH_USERNAME || 'admin',
    },
    telegram: {
      enabled: telegram.isEnabled(),
      notify_on: [...telegram.notifyOn()],
      overdue_check_hours: Number(process.env.TELEGRAM_OVERDUE_CHECK_HOURS) || 24,
    },
    email_digest: {
      enabled: digest.isEnabled(),
      via: digest.isGmailEnabled() ? 'gmail' : digest.isSmtpEnabled() ? 'smtp' : null,
      cron: digest.digestCron(),
      recipient_count: digest.isEnabled()
        ? (process.env.EMAIL_TO || '').split(',').map((s) => s.trim()).filter(Boolean).length
        : 0,
    },
    github: {
      enabled: github.isEnabled(),
      default_repo: github.defaultRepo(),
      auto_create: github.autoCreateEnabled(),
      webhook_configured: Boolean(process.env.GITHUB_WEBHOOK_SECRET),
    },
    workspace: {
      enabled: isGoogleConfigured(),
      email: isGoogleConfigured(),
      calendar: isGoogleConfigured(),
      assistant: isGoogleConfigured() && isOllamaConfigured(),
    },
  };
}

async function getGitHubSyncStats() {
  const { rows } = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE github_issue_number IS NOT NULL)::int AS linked_tasks,
      COUNT(*)::int AS total_tasks
    FROM tasks
  `);
  return rows[0] || { linked_tasks: 0, total_tasks: 0 };
}

async function getOpsStatusDetailed() {
  const status = getOpsStatus();
  status.github.sync = await getGitHubSyncStats();

  if (status.github.enabled) {
    try {
      await github.ping();
      status.github.api_reachable = true;
    } catch (err) {
      status.github.api_reachable = false;
      status.github.api_error = err.message;
    }
  }

  status.ready = isProductionReady(status);
  return status;
}

function isProductionReady(status) {
  return Boolean(
    status.auth.enabled
    && status.auth.api_token_configured
    && status.auth.password_configured
    && status.public_url
    && status.github.enabled
    && status.github.webhook_configured
    && status.github.default_repo
  );
}

module.exports = {
  getOpsStatus,
  getOpsStatusDetailed,
  getGitHubSyncStats,
  isProductionReady,
  publicUrl,
};
