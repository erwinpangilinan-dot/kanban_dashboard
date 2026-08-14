const db = require('../db');
const { writeEnvValues } = require('../lib/env-file');

const SETTINGS_REFRESH = 'google_refresh_token';
const SETTINGS_EMAIL = 'google_account_email';

function hasClientCredentials() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function isConfigured() {
  return Boolean(hasClientCredentials() && process.env.GOOGLE_REFRESH_TOKEN);
}

let tokenCache = null;
let hydratedFromDb = false;

async function hydrateFromDb() {
  if (hydratedFromDb) return;
  hydratedFromDb = true;
  try {
    const { rows } = await db.query(
      'SELECT key, value FROM workspace_settings WHERE key = ANY($1::text[])',
      [[SETTINGS_REFRESH, SETTINGS_EMAIL]]
    );
    for (const row of rows) {
      if (row.key === SETTINGS_REFRESH && row.value) {
        process.env.GOOGLE_REFRESH_TOKEN = row.value;
      }
      if (row.key === SETTINGS_EMAIL && row.value) {
        if (!process.env.EMAIL_FROM) process.env.EMAIL_FROM = row.value;
        if (!process.env.GOOGLE_SEND_AS) process.env.GOOGLE_SEND_AS = row.value;
      }
    }
  } catch (err) {
    // DB may not be ready during early boot; ignore
  }
}

async function persistSetting(key, value) {
  await db.query(
    `INSERT INTO workspace_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
}

/**
 * Update refresh token (and optional account email) in process.env, DB, and .env.
 */
async function setCredentials({ refreshToken, accountEmail: email }) {
  if (!refreshToken) throw new Error('refreshToken is required');

  process.env.GOOGLE_REFRESH_TOKEN = refreshToken;
  if (email) {
    process.env.EMAIL_FROM = email;
    process.env.GOOGLE_SEND_AS = email;
  }
  tokenCache = null;

  await persistSetting(SETTINGS_REFRESH, refreshToken);
  if (email) await persistSetting(SETTINGS_EMAIL, email);

  const updates = { GOOGLE_REFRESH_TOKEN: refreshToken };
  if (email) {
    updates.EMAIL_FROM = email;
    updates.GOOGLE_SEND_AS = email;
  }
  writeEnvValues(updates);
}

function clearTokenCache() {
  tokenCache = null;
}

async function getAccessToken() {
  await hydrateFromDb();

  if (!isConfigured()) {
    throw new Error('Google Workspace is not configured.');
  }

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
    const err = new Error(`Google token refresh failed (${res.status}): ${body}`);
    err.status = 401;
    err.code = 'GOOGLE_TOKEN_INVALID';
    throw err;
  }

  const data = await res.json();
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return tokenCache.token;
}

async function googleFetch(url, { method = 'GET', body } = {}) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || data.message || res.statusText || 'Google API error';
    throw new Error(msg);
  }
  return data;
}

function accountEmail() {
  return process.env.EMAIL_FROM || process.env.GOOGLE_SEND_AS || null;
}

module.exports = {
  hasClientCredentials,
  isConfigured,
  hydrateFromDb,
  setCredentials,
  clearTokenCache,
  getAccessToken,
  googleFetch,
  accountEmail,
};
