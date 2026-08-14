#!/usr/bin/env node
/**
 * Quote NETWORK_SUBCLOUD_MIDDLEWARE_PASSWORD in .env so a trailing '#'
 * is not treated as a dotenv comment. Never prints the password.
 */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../../.env');
const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
let changed = false;
const out = lines.map((line) => {
  if (!line.startsWith('NETWORK_SUBCLOUD_MIDDLEWARE_PASSWORD=')) return line;
  let v = line.slice('NETWORK_SUBCLOUD_MIDDLEWARE_PASSWORD='.length);
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return line;
  }
  changed = true;
  const quoted = `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return `NETWORK_SUBCLOUD_MIDDLEWARE_PASSWORD=${quoted}`;
});

if (!changed) {
  console.log(JSON.stringify({ changed: false, reason: 'already_quoted_or_missing' }));
  process.exit(0);
}

fs.writeFileSync(envPath, `${out.join('\n').replace(/\n$/, '')}\n`);
delete require.cache[require.resolve('dotenv')];
require('dotenv').config({ path: envPath, override: true });
const loaded = process.env.NETWORK_SUBCLOUD_MIDDLEWARE_PASSWORD || '';
console.log(JSON.stringify({ changed: true, loaded_len: loaded.length }));
