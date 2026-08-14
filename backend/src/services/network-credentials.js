const fs = require('fs');
const db = require('../db');

function vendorKey(vendor) {
  return String(vendor || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
}

function settingsKeysForVendor(vendor) {
  const key = vendorKey(vendor) || 'unknown';
  return {
    usernameKey: `redfish_${key}_username`,
    passwordKey: `redfish_${key}_password`,
  };
}

async function getVendorCredentials(vendor) {
  const { usernameKey, passwordKey } = settingsKeysForVendor(vendor);
  const { rows } = await db.query(
    'SELECT key, value FROM workspace_settings WHERE key = ANY($1::text[])',
    [[usernameKey, passwordKey]]
  );
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const username = map[usernameKey] || '';
  const password = map[passwordKey] || '';
  return {
    username,
    password,
    configured: Boolean(username && password),
    usernameKey,
    passwordKey,
  };
}

async function listVendorCredentialSettings() {
  const { rows } = await db.query(
    `SELECT key, value FROM workspace_settings
     WHERE key LIKE 'redfish_%_username' OR key LIKE 'redfish_%_password'
     ORDER BY key`
  );
  const vendors = {};
  for (const row of rows) {
    const m = row.key.match(/^redfish_(.+)_username$/);
    if (m) {
      const v = m[1];
      vendors[v] = vendors[v] || { vendor: v.toUpperCase(), username: '', password_set: false };
      vendors[v].username = row.value || '';
    }
    const p = row.key.match(/^redfish_(.+)_password$/);
    if (p) {
      const v = p[1];
      vendors[v] = vendors[v] || { vendor: v.toUpperCase(), username: '', password_set: false };
      vendors[v].password_set = Boolean(row.value);
    }
  }
  return Object.values(vendors);
}

async function setVendorCredentials(vendor, { username, password }) {
  const { usernameKey, passwordKey } = settingsKeysForVendor(vendor);
  if (username != null) {
    await db.query(
      `INSERT INTO workspace_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [usernameKey, username]
    );
  }
  if (password != null && password !== '' && password !== '********') {
    await db.query(
      `INSERT INTO workspace_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [passwordKey, password]
    );
  }
  return getVendorCredentials(vendor);
}

const WR_SSH_USERNAME_KEY = 'wr_subcloud_username';
const WR_SSH_PASSWORD_KEY = 'wr_subcloud_password';

function controllerKey(controller) {
  return String(controller || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
}

function settingsKeysForWrController(controller) {
  const key = controllerKey(controller) || 'unknown';
  return {
    usernameKey: `wr_subcloud_${key}_username`,
    passwordKey: `wr_subcloud_${key}_password`,
  };
}

async function getGlobalWrSubcloudCredentials() {
  const keyPath = process.env.NETWORK_WR_SSH_KEY_PATH || '';
  const { rows } = await db.query(
    'SELECT key, value FROM workspace_settings WHERE key = ANY($1::text[])',
    [[WR_SSH_USERNAME_KEY, WR_SSH_PASSWORD_KEY]]
  );
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const username =
    process.env.NETWORK_WR_SSH_USER ||
    process.env.WR_SUBCLOUD_SSH_USER ||
    map[WR_SSH_USERNAME_KEY] ||
    '';
  const password =
    process.env.NETWORK_WR_SSH_PASSWORD ||
    process.env.WR_SUBCLOUD_SSH_PASSWORD ||
    map[WR_SSH_PASSWORD_KEY] ||
    '';
  const hasKey = Boolean(keyPath && fs.existsSync(keyPath));
  return { username, password, keyPath, configured: Boolean(username && (password || hasKey)) };
}

async function getWrSubcloudCredentials(parentController) {
  const keyPath = process.env.NETWORK_WR_SSH_KEY_PATH || '';
  const hasKey = Boolean(keyPath && fs.existsSync(keyPath));

  if (parentController?.trim()) {
    const { usernameKey, passwordKey } = settingsKeysForWrController(parentController);
    const { rows } = await db.query(
      'SELECT key, value FROM workspace_settings WHERE key = ANY($1::text[])',
      [[usernameKey, passwordKey]]
    );
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const username = map[usernameKey] || '';
    const password = map[passwordKey] || '';
    if (username && (password || hasKey)) {
      return {
        username,
        password,
        keyPath,
        configured: true,
        parent_controller: parentController.trim(),
        source: 'controller',
      };
    }
  }

  const global = await getGlobalWrSubcloudCredentials();
  return {
    ...global,
    parent_controller: parentController?.trim() || null,
    source: global.configured ? 'default' : 'none',
  };
}

async function listWrSubcloudControllersFromInventory() {
  const { rows } = await db.query(
    `SELECT parent_controller, COUNT(*)::int AS device_count
     FROM network_devices
     WHERE parent_controller IS NOT NULL AND TRIM(parent_controller) <> ''
       AND (os ILIKE '%wind%' OR os ILIKE '%wrcp%')
     GROUP BY parent_controller
     ORDER BY parent_controller ASC`
  );
  return rows.map((r) => ({
    controller: r.parent_controller,
    device_count: r.device_count,
  }));
}

async function listWrSubcloudControllerSettings() {
  const inventory = await listWrSubcloudControllersFromInventory();
  const { rows } = await db.query(
    `SELECT key, value FROM workspace_settings
     WHERE key LIKE 'wr_subcloud_%_username' OR key LIKE 'wr_subcloud_%_password'
     ORDER BY key`
  );

  const byKey = {};
  for (const row of rows) {
    const u = row.key.match(/^wr_subcloud_(.+)_username$/);
    if (u && u[1] !== 'username' && row.key !== WR_SSH_USERNAME_KEY) {
      byKey[u[1]] = byKey[u[1]] || { controller_key: u[1], username: '', password_set: false };
      byKey[u[1]].username = row.value || '';
    }
    const p = row.key.match(/^wr_subcloud_(.+)_password$/);
    if (p && p[1] !== 'password' && row.key !== WR_SSH_PASSWORD_KEY) {
      byKey[p[1]] = byKey[p[1]] || { controller_key: p[1], username: '', password_set: false };
      byKey[p[1]].password_set = Boolean(row.value);
    }
  }

  const controllers = new Map();
  for (const inv of inventory) {
    const key = controllerKey(inv.controller);
    const saved = byKey[key] || { username: '', password_set: false };
    controllers.set(inv.controller, {
      controller: inv.controller,
      username: saved.username || '',
      password_set: saved.password_set,
      configured: Boolean(saved.username && saved.password_set),
      device_count: inv.device_count,
    });
  }

  return [...controllers.values()].sort((a, b) => a.controller.localeCompare(b.controller));
}

async function setWrSubcloudControllerCredentials(controller, { username, password }) {
  if (!controller?.trim()) {
    throw new Error('controller name required');
  }
  const { usernameKey, passwordKey } = settingsKeysForWrController(controller);
  if (username != null) {
    await db.query(
      `INSERT INTO workspace_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [usernameKey, username]
    );
  }
  if (password != null && password !== '' && password !== '********') {
    await db.query(
      `INSERT INTO workspace_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [passwordKey, password]
    );
  }
  return getWrSubcloudCredentials(controller);
}

async function getWrSubcloudCredentialsLegacy() {
  return getGlobalWrSubcloudCredentials();
}

async function setWrSubcloudCredentials({ username, password }) {
  if (username != null) {
    await db.query(
      `INSERT INTO workspace_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [WR_SSH_USERNAME_KEY, username]
    );
  }
  if (password != null && password !== '' && password !== '********') {
    await db.query(
      `INSERT INTO workspace_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [WR_SSH_PASSWORD_KEY, password]
    );
  }
  return getGlobalWrSubcloudCredentials();
}

module.exports = {
  vendorKey,
  settingsKeysForVendor,
  getVendorCredentials,
  listVendorCredentialSettings,
  setVendorCredentials,
  controllerKey,
  getWrSubcloudCredentials,
  getGlobalWrSubcloudCredentials,
  listWrSubcloudControllerSettings,
  setWrSubcloudControllerCredentials,
  setWrSubcloudCredentials,
};
