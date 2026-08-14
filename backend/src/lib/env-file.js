const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '../../../.env');

function upsertEnv(lines, key, value) {
  const prefix = `${key}=`;
  const next = `${key}=${value}`;
  const idx = lines.findIndex((line) => line.startsWith(prefix));
  if (idx >= 0) lines[idx] = next;
  else lines.push(next);
  return lines;
}

/**
 * Persist key/value pairs to .env when the file is writable.
 * Returns true if written, false if skipped (missing/unwritable).
 */
function writeEnvValues(updates) {
  try {
    let lines = [];
    if (fs.existsSync(ENV_PATH)) {
      lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
      // Keep trailing empty line behavior stable
      while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    }
    for (const [key, value] of Object.entries(updates)) {
      if (value == null) continue;
      upsertEnv(lines, key, String(value));
    }
    fs.writeFileSync(ENV_PATH, `${lines.join('\n')}\n`);
    return true;
  } catch (err) {
    console.warn(`Could not write .env (${err.message}); using in-memory/DB only`);
    return false;
  }
}

module.exports = {
  ENV_PATH,
  upsertEnv,
  writeEnvValues,
};
