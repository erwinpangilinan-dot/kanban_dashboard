#!/usr/bin/env node
/** Verify anonymous middleware Fuze lookup (no AD login). */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const {
  fetchSubcloudRecordsDirect,
  indexRecordsByGnbDuid,
} = require('../src/services/network-subcloud-middleware');

const fuzeId = process.argv[2] || '1372466';
const duid = process.argv[3] || '29991573171';

async function main() {
  console.log('mode: anonymous CSRF (no AD login)');
  console.log('fuze_site_id:', fuzeId);
  const records = await fetchSubcloudRecordsDirect(fuzeId);
  const byDuid = indexRecordsByGnbDuid(records);
  const hit = byDuid.get(duid);
  console.log('records:', records.length);
  console.log(
    'match',
    duid + ':',
    hit
      ? {
          cluster_name: hit.cluster_name,
          subcloud_ip: hit.oam_vip_address,
          parent_controller: hit.parent_cluster_name,
        }
      : 'NOT FOUND'
  );
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
