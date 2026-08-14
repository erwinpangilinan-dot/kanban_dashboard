#!/usr/bin/env node
/** One-off probe: POST Fuze Site ID to middleware subcloud lookup. */
const fuzeId = process.argv[2] || '29991573171';
const base =
  process.env.NETWORK_SUBCLOUD_MIDDLEWARE_URL ||
  'https://middleware.faredge.vzwops.com/caas/subcloud/';

async function main() {
  const get = await fetch(base);
  const html = await get.text();
  const csrf = html.match(/name="csrfmiddlewaretoken" value="([^"]+)"/);
  const cookie = get.headers.get('set-cookie') || '';
  const body = new URLSearchParams({ fuze_id: fuzeId });
  if (csrf) body.set('csrfmiddlewaretoken', csrf[1]);
  const post = await fetch(base, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookie.split(',').map((c) => c.split(';')[0]).join('; '),
      Referer: base,
    },
    body: body.toString(),
  });
  const out = await post.text();
  console.log('status', post.status, 'len', out.length);
  const fs = require('fs');
  const path = require('path');
  const outPath = path.join(__dirname, '../../logs', `subcloud-middleware-${fuzeId}.html`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, out);
  console.log('saved', outPath);

  const tables = out.match(/<table[\s\S]*?<\/table>/gi) || [];
  console.log('tables', tables.length);
  for (const k of ['subcloud', 'cluster', '2607:f160', 'welktx', 'gNBDUID', 'Cluster IP', 'OAM', 'card']) {
    const i = out.indexOf(k);
    console.log(k, i >= 0 ? out.slice(i, i + 140).replace(/\s+/g, ' ') : 'NOT FOUND');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
