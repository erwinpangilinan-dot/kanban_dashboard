#!/usr/bin/env node
/**
 * Start the API against DATABASE_URL and verify core endpoints respond.
 * Run: DATABASE_URL=... node scripts/ci-smoke.js
 */
const { spawn } = require('child_process');
const path = require('path');

const PORT = process.env.PORT || 3001;
const BASE = `http://localhost:${PORT}`;

const fs = require('fs');

// Load environment variables from .env if present
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      let val = parts.slice(1).join('=').trim();
      // Strip outer quotes if present
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  }
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const proc = spawn('node', ['src/server.js'], {
  cwd: path.join(__dirname, '../backend'),
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

proc.stderr.on('data', (chunk) => process.stderr.write(chunk));

async function waitForHealth(maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return res.json();
    } catch {
      // ponytail: fixed retry interval; upgrade to backoff if CI flakes
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('API health check timed out');
}

(async () => {
  try {
    const health = await waitForHealth();
    console.log('✓ /api/health', health);

    const headers = {};
    if (process.env.AUTH_API_TOKEN) {
      headers['Authorization'] = `Bearer ${process.env.AUTH_API_TOKEN}`;
    }
    const overview = await fetch(`${BASE}/api/overview`, { headers });
    if (!overview.ok) throw new Error(`/api/overview returned ${overview.status}`);
    console.log('✓ /api/overview ok');

    proc.kill();
    process.exit(0);
  } catch (err) {
    console.error('✗ smoke test failed:', err.message);
    proc.kill();
    process.exit(1);
  }
})();
