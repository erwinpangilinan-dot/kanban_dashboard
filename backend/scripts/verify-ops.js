#!/usr/bin/env node
const assert = require('assert');
const {
  getOpsStatus,
  isProductionReady,
} = require('../src/services/ops');

function withEnv(overrides, fn) {
  const saved = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    const value = overrides[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

withEnv({
  JWT_SECRET: undefined,
  AUTH_API_TOKEN: undefined,
  AUTH_PASSWORD: undefined,
  MISSION_CONTROL_PUBLIC_URL: undefined,
  GITHUB_TOKEN: undefined,
  GITHUB_WEBHOOK_SECRET: undefined,
  GITHUB_DEFAULT_REPO: undefined,
  TELEGRAM_BOT_TOKEN: undefined,
  TELEGRAM_CHAT_ID: undefined,
  EMAIL_TO: undefined,
}, () => {
  const status = getOpsStatus();
  assert.strictEqual(status.auth.enabled, false);
  assert.strictEqual(status.ready, undefined);
});

withEnv({
  JWT_SECRET: 'secret',
  AUTH_API_TOKEN: 'api-token',
  AUTH_PASSWORD: 'password',
  MISSION_CONTROL_PUBLIC_URL: 'http://10.10.50.6',
  GITHUB_TOKEN: 'ghp_test',
  GITHUB_WEBHOOK_SECRET: 'hook-secret',
  GITHUB_DEFAULT_REPO: 'acme/app',
  TELEGRAM_BOT_TOKEN: 'bot',
  TELEGRAM_CHAT_ID: 'chat',
  GOOGLE_CLIENT_ID: 'id',
  GOOGLE_CLIENT_SECRET: 'secret',
  GOOGLE_REFRESH_TOKEN: 'refresh',
  EMAIL_TO: 'team@test',
}, () => {
  const status = getOpsStatus();
  assert.strictEqual(status.auth.enabled, true);
  assert.strictEqual(status.auth.api_token_configured, true);
  assert.strictEqual(status.telegram.enabled, true);
  assert.strictEqual(status.email_digest.enabled, true);
  assert.strictEqual(status.email_digest.via, 'gmail');
  assert.strictEqual(status.github.enabled, true);
  assert.strictEqual(status.github.webhook_configured, true);
  assert.strictEqual(status.public_url, 'http://10.10.50.6');
  assert.strictEqual(isProductionReady(status), true);
});

withEnv({
  JWT_SECRET: 'secret',
  AUTH_API_TOKEN: 'api-token',
  AUTH_PASSWORD: 'password',
  MISSION_CONTROL_PUBLIC_URL: 'https://10.10.50.6',
  GITHUB_TOKEN: 'ghp_test',
  GITHUB_WEBHOOK_SECRET: 'hook-secret',
  GITHUB_DEFAULT_REPO: 'acme/app',
}, () => {
  const status = getOpsStatus();
  assert.strictEqual(status.tls, true);
});

console.log('✓ ops status helpers passed');
