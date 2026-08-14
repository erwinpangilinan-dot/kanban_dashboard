const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { migrationVersion, listMigrationFiles } = require('../src/migrate');

describe('migration order', () => {
  it('parses numeric versions so V8 precedes V10', () => {
    assert.equal(migrationVersion('V8__network_equipment.sql'), 8);
    assert.equal(migrationVersion('V10__network_subcloud_precheck.sql'), 10);
    assert.ok(migrationVersion('V8__x.sql') < migrationVersion('V10__x.sql'));
  });

  it('lists repo migrations in numeric order', () => {
    const dir = path.join(__dirname, '../../database/migrations');
    const files = listMigrationFiles(dir);
    const versions = files.map(migrationVersion);
    for (let i = 1; i < versions.length; i += 1) {
      assert.ok(
        versions[i] >= versions[i - 1],
        `expected ${files[i - 1]} before ${files[i]}`
      );
    }
    assert.ok(files.indexOf('V8__network_equipment.sql') < files.indexOf('V10__network_subcloud_precheck.sql'));
    assert.ok(files.indexOf('V6__workspace_settings.sql') < files.indexOf('V8__network_equipment.sql'));
  });
});
