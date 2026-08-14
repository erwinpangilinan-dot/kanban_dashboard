#!/usr/bin/env node
/** Print domain dropdown options from middleware login page (no credentials). */
async function main() {
  const url = 'https://middleware.faredge.vzwops.com/accounts/login/';
  const res = await fetch(url);
  const html = await res.text();
  const opts = [...html.matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)<\/option>/gi)].map(
    (m) => ({ value: m[1], label: m[2].trim() })
  );
  const domainBlock = (html.match(/name="domain"[\s\S]{0,800}/i) || [])[0] || '';
  console.log(
    JSON.stringify(
      {
        status: res.status,
        options: opts,
        has_uswin: /USWIN/i.test(html),
        has_qtwin: /QTWIN/i.test(html),
        domain_field_present: /name="domain"/i.test(html),
        domain_snip: domainBlock.slice(0, 400),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
