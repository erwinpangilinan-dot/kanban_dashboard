const crypto = require('crypto');
const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { requireView, requireWrite } = require('../middleware/authorize');
const { signToken, verifyToken } = require('../lib/jwt');
const {
  hasClientCredentials,
  isConfigured,
  setCredentials,
  getAccessToken,
  accountEmail,
} = require('../services/google-auth');

const router = express.Router();

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
].join(' ');

const STATE_COOKIE = 'mc_google_oauth_state';
const STATE_MAX_AGE_SEC = 600;
const STATE_PURPOSE = 'google-oauth';

let processStateSecret = null;

/**
 * The callback cannot require a token — Google sends the browser there as a
 * plain navigation — so the state value itself has to prove that a signed-in
 * operator started the flow. Comparing state to the cookie alone is not enough:
 * a caller outside a browser sets both sides of that comparison. Signing it
 * makes the value unforgeable.
 */
function stateSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  // Auth disabled, which only happens in development — production refuses to
  // start without JWT_SECRET. A per-process key still keeps state unforgeable;
  // it just does not survive a restart.
  processStateSecret ||= crypto.randomBytes(32).toString('hex');
  return processStateSecret;
}

function issueState(username) {
  return signToken({ purpose: STATE_PURPOSE, username }, stateSecret(), STATE_MAX_AGE_SEC);
}

function readState(value) {
  try {
    const claims = verifyToken(value, stateSecret());
    return claims.purpose === STATE_PURPOSE ? claims : null;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(val);
  }
  return out;
}

function setStateCookie(res, value, { secure }) {
  const attrs = [
    `${STATE_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/api/workspace/oauth',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${STATE_MAX_AGE_SEC}`,
  ];
  if (secure) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearStateCookie(res, { secure }) {
  const attrs = [
    `${STATE_COOKIE}=`,
    'Path=/api/workspace/oauth',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (secure) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function publicBaseUrl(req) {
  const configured = process.env.MISSION_CONTROL_PUBLIC_URL;
  if (configured) return configured.replace(/\/$/, '');

  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}

function redirectUri(req) {
  return `${publicBaseUrl(req)}/api/workspace/oauth/callback`;
}

function frontendWorkspaceUrl(req, params = {}) {
  const base = publicBaseUrl(req);
  const qs = new URLSearchParams({ view: 'workspace', ...params });
  return `${base}/?${qs.toString()}`;
}

// This router mounts ahead of the global authorize middleware so the callback
// stays reachable, so the tab and write checks are applied per route here.
router.get('/oauth/status', requireAuth, requireView('workspace'), asyncHandler(async (_req, res) => {
  const clientReady = hasClientCredentials();
  let tokenValid = false;
  let tokenError = null;

  if (isConfigured()) {
    try {
      await getAccessToken();
      tokenValid = true;
    } catch (err) {
      tokenError = err.message;
    }
  }

  res.json({
    client_credentials: clientReady,
    configured: isConfigured(),
    token_valid: tokenValid,
    needs_reauth: clientReady && !tokenValid,
    account: accountEmail(),
    error: tokenError,
  });
}));

// POST, and behind auth: connecting a Google account replaces the credentials
// the whole dashboard acts under, so it must not be reachable by a stranger
// following a link. The UI asks for the consent URL and then navigates.
router.post('/oauth/start', requireAuth, requireView('workspace'), requireWrite, asyncHandler(async (req, res) => {
  if (!hasClientCredentials()) {
    return res.status(503).json({
      error: 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env before re-authenticating.',
    });
  }

  const secure = (req.get('x-forwarded-proto') || req.protocol) === 'https';
  const state = issueState(req.user?.username || 'local');
  setStateCookie(res, state, { secure });

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri(req));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', state);

  return res.json({ url: url.toString() });
}));

router.get('/oauth/callback', asyncHandler(async (req, res) => {
  const secure = (req.get('x-forwarded-proto') || req.protocol) === 'https';
  const { code, state, error, error_description: errorDescription } = req.query;
  const cookies = parseCookies(req.get('cookie'));
  const cookieState = cookies[STATE_COOKIE];
  clearStateCookie(res, { secure });

  if (error) {
    return res.redirect(frontendWorkspaceUrl(req, {
      oauth: 'error',
      message: String(errorDescription || error),
    }));
  }

  // Cookie match defends against another site forging the request; the
  // signature is what proves the flow began at an authenticated /oauth/start
  // rather than being fabricated by whoever is calling.
  if (!code || !state || !cookieState || state !== cookieState || !readState(state)) {
    return res.redirect(frontendWorkspaceUrl(req, {
      oauth: 'error',
      message: 'Invalid or expired OAuth state. Try Re-authenticate again.',
    }));
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: String(code),
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(req),
      grant_type: 'authorization_code',
    }),
  });

  const tokenBody = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    return res.redirect(frontendWorkspaceUrl(req, {
      oauth: 'error',
      message: tokenBody.error_description || tokenBody.error || 'Token exchange failed',
    }));
  }

  if (!tokenBody.refresh_token) {
    return res.redirect(frontendWorkspaceUrl(req, {
      oauth: 'error',
      message: 'Google did not return a refresh token. Revoke prior access in Google Account settings, then try again.',
    }));
  }

  let email = null;
  try {
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    if (profileRes.ok) {
      const profile = await profileRes.json();
      email = profile.email || null;
    }
  } catch {
    // optional
  }

  await setCredentials({
    refreshToken: tokenBody.refresh_token,
    accountEmail: email,
  });

  return res.redirect(frontendWorkspaceUrl(req, { oauth: 'ok' }));
}));

module.exports = router;
