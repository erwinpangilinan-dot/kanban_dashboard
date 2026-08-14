#!/usr/bin/env node
/**
 * Compare .env file password shape vs dotenv-loaded value.
 * Never prints the password or character codes.
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { middlewarePassword } = require('../src/services/network-subcloud-middleware');

const envPath = path.join(__dirname, '../../.env');
const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
const line = lines.find((l) => l.startsWith('NETWORK_SUBCLOUD_MIDDLEWARE_PASSWORD='));
if (!line) {
  console.log(JSON.stringify({ error: 'PASSWORD line missing' }));
  process.exit(1);
}
let fileVal = line.slice('NETWORK_SUBCLOUD_MIDDLEWARE_PASSWORD='.length);
const quoted =
  (fileVal.startsWith('"') && fileVal.endsWith('"')) ||
  (fileVal.startsWith("'") && fileVal.endsWith("'"));
if (quoted) fileVal = fileVal.slice(1, -1);

const loaded = process.env.NETWORK_SUBCLOUD_MIDDLEWARE_PASSWORD ?? '';
const normalized = middlewarePassword();

console.log(
  JSON.stringify(
    {
      quoted_in_env: quoted,
      file_len: fileVal.length,
      dotenv_len: loaded.length,
      normalized_len: normalized.length,
      file_equals_dotenv: fileVal === loaded,
      file_ends_with_hash: fileVal.endsWith('#'),
      dotenv_ends_with_hash: loaded.endsWith('#'),
      dollar_count: (normalized.match(/\$/g) || []).length,
    },
    null,
    2
  )
);
