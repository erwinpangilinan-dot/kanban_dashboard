/**
 * Shared contract between the API container and the host-side network agent
 * (backend/scripts/network-host-poller.js).
 *
 * The agent performs privileged actions (BMC reboot, Redfish reset, Atlas job
 * launches) and must be reachable from the API container, which on Docker
 * Desktop means binding a LAN-visible interface rather than loopback. A shared
 * secret is therefore the control that keeps other hosts on the LAN out.
 */
const crypto = require('crypto');

const DEFAULT_BASE_URL = 'http://host.docker.internal:38765';
const TOKEN_HEADER = 'x-mission-control-agent-token';

function hostAgentBaseUrl() {
  return (process.env.NETWORK_HOST_AGENT_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
}

function hostAgentToken() {
  return (process.env.NETWORK_HOST_AGENT_TOKEN || '').trim();
}

/**
 * Build request headers for a call to the host agent. Callers pass their own
 * headers (e.g. Content-Type) and get the auth token merged in.
 */
function hostAgentHeaders(extra = {}) {
  const token = hostAgentToken();
  if (!token) {
    const err = new Error(
      'NETWORK_HOST_AGENT_TOKEN is not set. The API cannot authenticate to the host network agent.'
    );
    err.status = 500;
    throw err;
  }
  return { ...extra, [TOKEN_HEADER]: token };
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * Agent-side check. Returns true only when the request carries the configured
 * shared secret.
 */
function requestHasValidAgentToken(req) {
  const expected = hostAgentToken();
  if (!expected) return false;
  const provided = req.headers?.[TOKEN_HEADER];
  return safeEqual(provided, expected);
}

module.exports = {
  DEFAULT_BASE_URL,
  TOKEN_HEADER,
  hostAgentBaseUrl,
  hostAgentToken,
  hostAgentHeaders,
  requestHasValidAgentToken,
};
