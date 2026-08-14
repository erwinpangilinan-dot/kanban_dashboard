const db = require('../db');

const SETTINGS_KEY = 'subcloud_precheck_custom_commands';
const MAX_COMMANDS = 30;
const MAX_COMMAND_LEN = 500;
const MAX_LABEL_LEN = 80;

const PLATFORMS = new Set(['all', 'Wind River', 'RHOCP']);

function slugify(text) {
  return String(text || 'custom')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40) || 'custom';
}

function sanitizeCommand(command) {
  const cmd = String(command || '').trim();
  if (!cmd) return '';
  if (cmd.length > MAX_COMMAND_LEN) {
    throw new Error(`Command exceeds ${MAX_COMMAND_LEN} characters`);
  }
  if (/[\r\n;`$]/.test(cmd) || /\|\||&&/.test(cmd)) {
    throw new Error('Command contains unsupported shell operators');
  }
  return cmd;
}

function normalizePlatform(platform) {
  const p = String(platform || 'all').trim();
  if (p.toLowerCase() === 'wr' || p.toLowerCase() === 'wind river') return 'Wind River';
  if (p.toLowerCase() === 'rhocp' || p.toLowerCase() === 'ocp') return 'RHOCP';
  if (PLATFORMS.has(p)) return p;
  return 'all';
}

function normalizeCommand(entry, index) {
  const label = String(entry.label || entry.name || `Custom ${index + 1}`).trim().slice(0, MAX_LABEL_LEN);
  const command = sanitizeCommand(entry.command);
  if (!command) throw new Error(`Custom command ${index + 1} is empty`);
  const platform = normalizePlatform(entry.platform);
  const id = entry.id || slugify(label);
  return { id, label, command, platform };
}

function splitPlatformSuffix(line) {
  const match = line.match(/\s+\|\s+(all|Wind River|RHOCP|WR|OCP)\s*$/i);
  if (!match) return { body: line.trim(), platform: 'all' };
  return {
    body: line.slice(0, match.index).trim(),
    platform: normalizePlatform(match[1]),
  };
}

function parseCommandsText(text) {
  const lines = String(text || '').split('\n');
  const commands = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const { body, platform } = splitPlatformSuffix(line);
    let label = '';
    let command = body;
    const colonIdx = body.indexOf(':');
    if (colonIdx > 0 && !body.startsWith('http')) {
      label = body.slice(0, colonIdx).trim();
      command = body.slice(colonIdx + 1).trim();
    }

    commands.push(
      normalizeCommand(
        {
          id: slugify(label || command),
          label: label || command.slice(0, 60),
          command,
          platform,
        },
        commands.length
      )
    );
  }

  if (commands.length > MAX_COMMANDS) {
    throw new Error(`At most ${MAX_COMMANDS} custom commands allowed`);
  }
  return commands;
}

function commandsToText(commands) {
  return (commands || [])
    .map((c) => {
      const platform = c.platform && c.platform !== 'all' ? ` | ${c.platform}` : '';
      return `${c.label}: ${c.command}${platform}`;
    })
    .join('\n');
}

async function getCustomPrecheckCommands() {
  const { rows } = await db.query(
    'SELECT value FROM workspace_settings WHERE key = $1',
    [SETTINGS_KEY]
  );
  if (!rows.length) return [];
  try {
    const parsed = JSON.parse(rows[0].value || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry, index) => normalizeCommand(entry, index));
  } catch {
    return [];
  }
}

async function getCustomPrecheckCommandsForPlatform(platform) {
  const all = await getCustomPrecheckCommands();
  return all.filter((c) => c.platform === 'all' || c.platform === platform);
}

async function setCustomPrecheckCommandsFromText(text) {
  const commands = parseCommandsText(text);
  await db.query(
    `INSERT INTO workspace_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [SETTINGS_KEY, JSON.stringify(commands)]
  );
  return commands;
}

async function getCustomPrecheckCommandsText() {
  const commands = await getCustomPrecheckCommands();
  return commandsToText(commands);
}

function parseKubectlArgs(command) {
  let cmd = command.trim();
  if (cmd.startsWith('kubectl ')) cmd = cmd.slice(8).trim();
  const parts = cmd.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  return parts.map((p) => p.replace(/^"|"$/g, ''));
}

function evaluateCustomOutput(output) {
  const text = String(output || '').trim();
  if (!text) return { status: 'warn', detail: 'No output', output: text };
  const failPat =
    /(^|\n)(error:|fatal:|command not found|connection refused|unable to connect|forbidden|unauthorized)/i;
  if (failPat.test(text)) {
    const line = text.split('\n').find((l) => l.trim()) || text;
    return { status: 'fail', detail: line.slice(0, 160), output: text };
  }
  const line =
    text.split('\n').find((l) => l.trim() && !/^E\d{4}\s/.test(l)) || text.split('\n')[0] || text;
  return { status: 'pass', detail: line.slice(0, 160), output: text };
}

module.exports = {
  getCustomPrecheckCommands,
  getCustomPrecheckCommandsForPlatform,
  setCustomPrecheckCommandsFromText,
  getCustomPrecheckCommandsText,
  parseKubectlArgs,
  evaluateCustomOutput,
  commandsToText,
  parseCommandsText,
};
