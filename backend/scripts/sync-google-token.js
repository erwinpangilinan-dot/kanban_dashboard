#!/usr/bin/env node
/**
 * Copy GOOGLE_REFRESH_TOKEN from google-workspace-mcp credentials into .env.
 * Usage: node backend/scripts/sync-google-token.js [credential-file]
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const envPath = path.join(root, '.env');
const defaultCred = path.join(
  process.env.HOME || '',
  '.local/share/google-workspace-mcp/credentials'
);

function findCredentialFile(arg) {
  if (arg) return arg;
  if (!fs.existsSync(defaultCred)) {
    throw new Error(`No credentials dir at ${defaultCred}. Pass a credential file path.`);
  }
  const files = fs.readdirSync(defaultCred).filter((f) => f.endsWith('.json'));
  if (files.length === 0) throw new Error(`No credential files in ${defaultCred}`);
  if (files.length > 1) {
    console.error('Multiple credential files found; using first:', files[0]);
  }
  return path.join(defaultCred, files[0]);
}

function upsertEnv(lines, key, value) {
  const prefix = `${key}=`;
  const idx = lines.findIndex((line) => line.startsWith(prefix));
  const next = `${key}=${value}`;
  if (idx >= 0) lines[idx] = next;
  else lines.push(next);
}

const credPath = findCredentialFile(process.argv[2]);
const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'));
if (!cred.refresh_token) {
  throw new Error(`No refresh_token in ${credPath}`);
}

let lines = fs.existsSync(envPath)
  ? fs.readFileSync(envPath, 'utf8').split('\n').filter((line, i, arr) => (
    line.length > 0 || i < arr.length - 1
  ))
  : [];

upsertEnv(lines, 'GOOGLE_CLIENT_ID', cred.client_id);
upsertEnv(lines, 'GOOGLE_CLIENT_SECRET', cred.client_secret);
upsertEnv(lines, 'GOOGLE_REFRESH_TOKEN', cred.refresh_token);
if (cred.client_id && !lines.some((l) => l.startsWith('EMAIL_FROM='))) {
  const email = path.basename(credPath, '.json').replace(/_dot_/g, '.').replace(/_at_/g, '@');
  upsertEnv(lines, 'EMAIL_FROM', email);
}

fs.writeFileSync(envPath, `${lines.join('\n')}\n`);
console.log(`✓ Synced Google OAuth tokens from ${credPath} into .env`);
