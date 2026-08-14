require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { migrate } = require('./migrate');
const { seed } = require('./seed');
const routes = require('./routes');
const authRoutes = require('./routes/auth');
const webhookRoutes = require('./routes/webhooks');
const { requireAuth, assertAuthConfigured } = require('./middleware/auth');
const { authorize } = require('./middleware/authorize');
const { bootstrapFirstAdmin } = require('./services/users');
const { buildCorsOptions, buildHelmetOptions } = require('./lib/http-security');
const { errorHandler } = require('./middleware/errorHandler');
const { startOverdueChecker } = require('./services/notify');
const { startDigestScheduler } = require('./services/digest');
const { startEmailAgent } = require('./services/email-agent');
const { startNetworkPoller } = require('./services/network-poller');

const app = express();
const PORT = process.env.PORT || 3001;

// The API is only reachable through nginx, which appends the client to
// X-Forwarded-For. Count the proxies in front of it so req.ip is the real
// caller and the login rate limiter keys on it: 1 for nginx alone, 2 when a
// Cloudflare Tunnel sits in front. Trusting every hop would let a caller spoof
// their own address and slip the limiter.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));

app.use(helmet(buildHelmetOptions()));
app.use(cors(buildCorsOptions()));
app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);
app.use(express.json());

app.get('/api/health', async (_req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch {
    res.status(503).json({ status: 'error', database: 'disconnected' });
  }
});

app.use('/api/auth', authRoutes);
// Mounted ahead of requireAuth because the Google callback arrives as a plain
// browser redirect with no Authorization header. The router authenticates its
// own start/status routes and verifies a signed state on the callback.
app.use('/api/workspace', require('./routes/workspace-oauth'));
app.use('/api', requireAuth, authorize, routes);

const frontendDist = path.join(__dirname, '../../frontend/dist');
const hasFrontendBuild = fs.existsSync(path.join(frontendDist, 'index.html'));

if (hasFrontendBuild) {
  app.use(express.static(frontendDist));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.type('html').send(`<!DOCTYPE html>
<html><head><title>Mission Control API</title></head>
<body style="font-family:system-ui;max-width:520px;margin:80px auto;padding:0 24px;color:#111">
  <h1>Mission Control API</h1>
  <p>The API is running on port ${PORT}. The UI is not built yet.</p>
  <ul>
    <li><strong>Development:</strong> run <code>npm run dev</code> and open <a href="http://localhost:5173">http://localhost:5173</a></li>
    <li><strong>Production:</strong> run <code>npm run build && npm start</code>, then open <a href="http://localhost:${PORT}">http://localhost:${PORT}</a></li>
  </ul>
  <p>API health: <a href="/api/health">/api/health</a></p>
</body></html>`);
  });
}

app.use(errorHandler);

async function start() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required. Copy .env.example to .env and start Postgres.');
    process.exit(1);
  }

  assertAuthConfigured();

  await migrate();
  await seed();
  await bootstrapFirstAdmin();
  try {
    const { hydrateFromDb } = require('./services/google-auth');
    await hydrateFromDb();
  } catch (err) {
    console.warn('Google auth hydrate skipped:', err.message);
  }

  app.listen(PORT, () => {
    console.log(`Mission Control API running at http://localhost:${PORT}`);
    if (hasFrontendBuild) {
      console.log(`Dashboard UI available at http://localhost:${PORT}`);
    } else {
      console.log(`Run "npm run dev" for UI at http://localhost:5173`);
    }
    startOverdueChecker();
    startDigestScheduler();
    startEmailAgent();
    startNetworkPoller();
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
