const test = require('node:test');
const assert = require('node:assert');

const { safeEqual } = require('../src/lib/safe-equal');
const { parseOrigins, buildCorsOptions, buildHelmetOptions } = require('../src/lib/http-security');

function originAllowed(options, requestOrigin) {
  return new Promise((resolve, reject) => {
    options.origin(requestOrigin, (err, allowed) => (err ? reject(err) : resolve(allowed)));
  });
}

test('safeEqual matches identical secrets', () => {
  assert.equal(safeEqual('s3cret', 's3cret'), true);
});

test('safeEqual rejects different secrets, including prefixes', () => {
  assert.equal(safeEqual('s3cret', 's3cre'), false);
  assert.equal(safeEqual('s3cret', 's3cret '), false);
  assert.equal(safeEqual('s3cret', 'wrong'), false);
});

test('safeEqual handles absent values without throwing', () => {
  assert.equal(safeEqual(undefined, 'token'), false);
  assert.equal(safeEqual(null, 'token'), false);
  // Documents why the login route refuses to run when credentials are unset:
  // two empty values do compare equal.
  assert.equal(safeEqual(undefined, undefined), true);
});

test('safeEqual compares secrets of differing lengths', () => {
  assert.equal(safeEqual('a', 'a-much-longer-secret'), false);
});

test('origins parse from a comma separated list, ignoring trailing slashes', () => {
  assert.deepEqual(parseOrigins('https://a.example.com/, https://b.example.com'), [
    'https://a.example.com',
    'https://b.example.com',
  ]);
  assert.deepEqual(parseOrigins(''), []);
  assert.deepEqual(parseOrigins(undefined), []);
});

test('production without an allowlist refuses cross-origin requests', () => {
  const options = buildCorsOptions({ env: 'production', origins: [] });
  assert.equal(options.origin, false);
});

test('development without an allowlist stays open for the Vite dev server', () => {
  const options = buildCorsOptions({ env: 'development', origins: [] });
  assert.deepEqual(options, {});
});

test('an allowlisted origin is permitted and others are not', async () => {
  const options = buildCorsOptions({
    env: 'production',
    origins: ['https://mc.example.com'],
  });
  assert.equal(await originAllowed(options, 'https://mc.example.com'), true);
  assert.equal(await originAllowed(options, 'https://mc.example.com/'), true);
  assert.equal(await originAllowed(options, 'https://evil.example.com'), false);
});

test('requests without an Origin header are left alone', async () => {
  const options = buildCorsOptions({
    env: 'production',
    origins: ['https://mc.example.com'],
  });
  assert.equal(await originAllowed(options, undefined), true);
});

test('helmet leaves CSP to nginx and does not force HSTS', () => {
  const options = buildHelmetOptions();
  assert.equal(options.contentSecurityPolicy, false);
  assert.equal(options.hsts, false);
});
