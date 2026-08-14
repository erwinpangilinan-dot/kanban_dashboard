#!/usr/bin/env node
/** One-shot middleware login diagnostic — never prints password. */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const {
  middlewarePassword,
  middlewareCredentialsConfigured,
} = require('../src/services/network-subcloud-middleware');

function readableChunks(text) {
  const out = [];
  const re = /[A-Za-z][A-Za-z0-9 .,_':-]{8,120}/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const s = m[0].trim();
    if (/lock|invalid|incorrect|password|credential|denied|fail|error|domain|user/i.test(s)) {
      out.push(s);
    }
  }
  return [...new Set(out)].slice(0, 10);
}

async function main() {
  const origin = new URL(
    process.env.NETWORK_SUBCLOUD_MIDDLEWARE_URL ||
      'https://middleware.faredge.vzwops.com/caas/subcloud/'
  ).origin;
  const loginUrl = `${origin}/accounts/login/`;
  const username = process.env.NETWORK_SUBCLOUD_MIDDLEWARE_USERNAME?.trim() || '';
  const domain = process.env.NETWORK_SUBCLOUD_MIDDLEWARE_DOMAIN?.trim() || 'USWIN';
  const password = middlewarePassword();

  console.log(
    JSON.stringify(
      {
        configured: middlewareCredentialsConfigured(),
        loginUrl,
        username_len: username.length,
        domain,
        password_len: password.length,
      },
      null,
      2
    )
  );

  const get = await fetch(loginUrl);
  const html = await get.text();
  const setCookies =
    typeof get.headers.getSetCookie === 'function'
      ? get.headers.getSetCookie()
      : [get.headers.get('set-cookie')].filter(Boolean);
  const csrf = html.match(/name="csrfmiddlewaretoken" value="([^"]+)"/);
  if (!csrf) {
    console.error('FAIL: no CSRF');
    process.exit(1);
  }

  const cookieHeader = setCookies
    .map((c) => String(c).split(';')[0])
    .filter(Boolean)
    .join('; ');

  const body = new URLSearchParams({
    username,
    password,
    domain,
    csrfmiddlewaretoken: csrf[1],
  });

  const post = await fetch(loginUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader,
      Referer: loginUrl,
      Origin: origin,
    },
    body: body.toString(),
  });

  const postCookies =
    typeof post.headers.getSetCookie === 'function'
      ? post.headers.getSetCookie()
      : [post.headers.get('set-cookie')].filter(Boolean);
  const location = post.headers.get('location') || '';
  const postBody = await post.text();
  const msgCookie = postCookies.find((c) => String(c).startsWith('messages='));
  let messagesDecoded = null;
  if (msgCookie) {
    try {
      const raw = decodeURIComponent(String(msgCookie).slice('messages='.length).split(';')[0]);
      messagesDecoded = readableChunks(raw);
    } catch {
      messagesDecoded = [];
    }
  }

  const alerts = [...postBody.matchAll(/<(?:div|li|p|span)[^>]*>([\s\S]*?)<\/(?:div|li|p|span)>/gi)]
    .map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((t) => t && /lock|invalid|incorrect|password|credential|denied|error|fail/i.test(t))
    .slice(0, 8);

  console.log(
    JSON.stringify(
      {
        post_status: post.status,
        location: location || null,
        redirected_to_login: /\/accounts\/login/i.test(location),
        post_cookie_names: postCookies.map((c) => String(c).split('=')[0]),
        has_sessionid: postCookies.some((c) => String(c).startsWith('sessionid=')),
        body_looks_like_login: /VCPFE Middleware Login|csrfmiddlewaretoken/i.test(postBody),
        alerts,
        messages_hints: messagesDecoded,
        body_readable_hints: readableChunks(postBody),
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
