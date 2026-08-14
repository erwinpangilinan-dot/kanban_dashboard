const test = require('node:test');
const assert = require('node:assert');

const { assertAuthConfigured, isAuthEnabled } = require('../src/middleware/auth');

function withEnv(vars, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('auth is optional outside production', () => {
  withEnv({ NODE_ENV: 'development', JWT_SECRET: undefined }, () => {
    assert.equal(isAuthEnabled(), false);
    assert.doesNotThrow(() => assertAuthConfigured());
  });
});

test('production without JWT_SECRET refuses to start', () => {
  withEnv(
    { NODE_ENV: 'production', JWT_SECRET: undefined, ALLOW_UNAUTHENTICATED: undefined },
    () => {
      assert.throws(() => assertAuthConfigured(), /JWT_SECRET is required/);
    }
  );
});

test('production with JWT_SECRET starts normally', () => {
  withEnv({ NODE_ENV: 'production', JWT_SECRET: 'a-secret' }, () => {
    assert.equal(isAuthEnabled(), true);
    assert.doesNotThrow(() => assertAuthConfigured());
  });
});

test('an open production API requires an explicit opt-in', () => {
  withEnv(
    { NODE_ENV: 'production', JWT_SECRET: undefined, ALLOW_UNAUTHENTICATED: '1' },
    () => {
      assert.doesNotThrow(() => assertAuthConfigured());
    }
  );
});
