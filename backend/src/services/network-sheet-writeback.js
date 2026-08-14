const { googleFetch, isConfigured, hydrateFromDb } = require('./google-auth');

const DEFAULT_SHEET_ID = '1CpfPlE12oGDIxsJJ8HoeAMXevF7nDAgRTlDoyhoWjsk';

function sheetId() {
  return process.env.NETWORK_VDU_SHEET_ID || DEFAULT_SHEET_ID;
}

const SHEET_TAB = 'Sheet1';
const BATCH_SIZE = 100;

function sheetWritebackEnabled() {
  const v = process.env.NETWORK_VDU_SHEET_WRITEBACK;
  if (v === '0' || v === 'false') return false;
  return true;
}

function columnToA1(colIndex) {
  let col = colIndex + 1;
  let letters = '';
  while (col > 0) {
    const rem = (col - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    col = Math.floor((col - 1) / 26);
  }
  return letters;
}

function middlewareSheetFields(layout) {
  return [
    { field: 'subcloud_ip', col: layout.iSubcloud },
    { field: 'cluster_name', col: layout.iClusterName },
    { field: 'cluster_namespace', col: layout.iClusterNamespace },
    { field: 'parent_controller', col: layout.iParent },
    { field: 'bmc_ip', col: layout.iIp },
  ].filter((f) => f.col >= 0);
}

function buildSheetUpdates(devices, layout) {
  const fields = middlewareSheetFields(layout);
  const updates = [];
  for (const device of devices) {
    if (!device._sheetRow) continue;
    for (const { field, col } of fields) {
      const next = device[field] ?? '';
      const prev = device._sheetOriginal?.[field] ?? '';
      if (!next || String(next) === String(prev)) continue;
      updates.push({
        range: `${SHEET_TAB}!${columnToA1(col)}${device._sheetRow}`,
        values: [[next]],
      });
    }
  }
  return updates;
}

async function writeSheetUpdates(updates) {
  if (!updates.length) {
    return { enabled: true, cells: 0, rows: 0, batches: 0 };
  }
  await hydrateFromDb();
  if (!isConfigured()) {
    return { enabled: false, cells: 0, rows: 0, batches: 0, error: 'Google not configured' };
  }
  const id = sheetId();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`;
  const touchedRows = new Set();
  let batches = 0;

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const chunk = updates.slice(i, i + BATCH_SIZE);
    await googleFetch(url, {
      method: 'POST',
      body: {
        valueInputOption: 'USER_ENTERED',
        data: chunk,
      },
    });
    batches += 1;
    for (const u of chunk) {
      const row = Number(u.range.match(/(\d+)$/)?.[1]);
      if (row) touchedRows.add(row);
    }
  }

  return {
    enabled: true,
    cells: updates.length,
    rows: touchedRows.size,
    batches,
  };
}

async function writeMiddlewareFieldsToSheet(devices, layout) {
  if (!sheetWritebackEnabled()) {
    return { enabled: false, cells: 0, rows: 0, batches: 0, skipped: true };
  }
  try {
    const updates = buildSheetUpdates(devices, layout);
    return await writeSheetUpdates(updates);
  } catch (err) {
    return {
      enabled: true,
      cells: 0,
      rows: 0,
      batches: 0,
      error: err.message || String(err),
    };
  }
}

module.exports = {
  sheetWritebackEnabled,
  buildSheetUpdates,
  writeMiddlewareFieldsToSheet,
  columnToA1,
};
