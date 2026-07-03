require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { migrate } = require('./migrate');
const { seed } = require('./seed');
const routes = require('./routes');
const authRoutes = require('./routes/auth');
const { requireAuth } = require('./middleware/auth');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
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
app.use('/api', requireAuth, routes);

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

  await migrate();
  await seed();

  app.listen(PORT, () => {
    console.log(`Mission Control API running at http://localhost:${PORT}`);
    if (hasFrontendBuild) {
      console.log(`Dashboard UI available at http://localhost:${PORT}`);
    } else {
      console.log(`Run "npm run dev" for UI at http://localhost:5173`);
    }
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
