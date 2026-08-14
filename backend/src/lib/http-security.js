/**
 * CORS and header policy for the API.
 *
 * In Docker the SPA and the API share an origin (nginx serves the app and
 * proxies /api to the API container), so the browser never issues a
 * cross-origin request and no allowlist is needed. A wide-open policy only
 * becomes a liability once the host is public, so production defaults to
 * same-origin and anything else has to be named explicitly.
 */

function parseOrigins(raw) {
  return String(raw || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

function allowedOrigins() {
  return parseOrigins(process.env.CORS_ALLOWED_ORIGINS);
}

function buildCorsOptions({
  env = process.env.NODE_ENV,
  origins = allowedOrigins(),
} = {}) {
  if (origins.length) {
    return {
      origin(requestOrigin, callback) {
        // No Origin header means a same-origin or non-browser caller (scripts,
        // MCP), which CORS does not govern.
        if (!requestOrigin) return callback(null, true);
        const normalized = requestOrigin.replace(/\/$/, '');
        return callback(null, origins.includes(normalized));
      },
      credentials: true,
    };
  }

  // The Vite dev server runs on a different port, so development stays open.
  if (env !== 'production') return {};

  return { origin: false };
}

/**
 * nginx serves the HTML in Docker, so a CSP set here would not cover the app
 * shell. It is defined in frontend/nginx.conf instead, and disabled here to
 * avoid a second, conflicting policy on the Express static fallback.
 */
function buildHelmetOptions() {
  return {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    // Only meaningful over HTTPS, and it would pin clients that reach the
    // dashboard over plain HTTP on the LAN.
    hsts: false,
  };
}

module.exports = {
  parseOrigins,
  allowedOrigins,
  buildCorsOptions,
  buildHelmetOptions,
};
