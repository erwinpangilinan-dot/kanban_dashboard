const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { authorize, VIEW_BY_SEGMENT, UNGATED_SEGMENTS } = require('../src/middleware/authorize');
const { effectiveViews, canWrite, isAdmin } = require('../src/lib/permissions');

function asUser(role, allowedViews = []) {
  return {
    id: 'user-1',
    username: role,
    role,
    views: effectiveViews(role, allowedViews),
    can_write: canWrite(role),
    is_admin: isAdmin(role),
  };
}

/** Run the middleware against a fake request and report whether it passed. */
function attempt(user, method, reqPath) {
  const req = { user, method, path: reqPath };
  let status = null;
  let body = null;
  let allowed = false;

  const res = {
    status(code) {
      status = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
  };

  authorize(req, res, () => {
    allowed = true;
  });

  return { allowed, status, error: body?.error };
}

test('an admin reaches every tab and can write', () => {
  const admin = asUser('admin');
  for (const segment of Object.keys(VIEW_BY_SEGMENT)) {
    assert.equal(attempt(admin, 'GET', `/${segment}`).allowed, true, `GET /${segment}`);
    assert.equal(attempt(admin, 'POST', `/${segment}`).allowed, true, `POST /${segment}`);
  }
});

test('a granted tab is reachable and an ungranted one is not', () => {
  const user = asUser('editor', ['network']);

  assert.equal(attempt(user, 'GET', '/network/devices').allowed, true);
  assert.equal(attempt(user, 'GET', '/network/devices/abc/pods').allowed, true);

  const denied = attempt(user, 'GET', '/projects');
  assert.equal(denied.allowed, false);
  assert.equal(denied.status, 403);
  assert.match(denied.error, /does not have access to the board section/);

  assert.equal(attempt(user, 'GET', '/workspace/email/messages').allowed, false);
  assert.equal(attempt(user, 'GET', '/memoria/graph').allowed, false);
  assert.equal(attempt(user, 'GET', '/overview').allowed, false);
});

test('full access can write on its granted tabs', () => {
  const editor = asUser('editor', ['network', 'board']);
  assert.equal(attempt(editor, 'POST', '/network/devices/abc/reboot').allowed, true);
  assert.equal(attempt(editor, 'DELETE', '/tasks/abc').allowed, true);
  assert.equal(attempt(editor, 'PATCH', '/tasks/abc/move').allowed, true);
});

test('read-only can read its tabs but every mutating method is refused', () => {
  const viewer = asUser('viewer', ['network', 'board']);

  assert.equal(attempt(viewer, 'GET', '/network/devices').allowed, true);
  assert.equal(attempt(viewer, 'HEAD', '/network/devices').allowed, true);
  assert.equal(attempt(viewer, 'GET', '/projects/abc/board').allowed, true);

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const denied = attempt(viewer, method, '/network/devices/abc/reboot');
    assert.equal(denied.allowed, false, `${method} should be refused`);
    assert.equal(denied.status, 403);
    assert.match(denied.error, /read-only/);
  }
});

test('only admins reach the users API', () => {
  assert.equal(attempt(asUser('admin'), 'GET', '/users').allowed, true);
  assert.equal(attempt(asUser('admin'), 'POST', '/users').allowed, true);

  for (const role of ['editor', 'viewer']) {
    const denied = attempt(asUser(role, ['overview', 'board', 'network']), 'GET', '/users');
    assert.equal(denied.allowed, false, `${role} should not list users`);
    assert.equal(denied.status, 403);
    assert.match(denied.error, /Administrator access is required/);
  }
});

test('the API service token keeps full access', () => {
  const service = asUser('service');
  assert.equal(attempt(service, 'GET', '/users').allowed, true);
  assert.equal(attempt(service, 'POST', '/network/devices/abc/reboot').allowed, true);
  assert.equal(attempt(service, 'PATCH', '/tasks/abc/move').allowed, true);
});

test('an unmapped path is denied rather than allowed by default', () => {
  const denied = attempt(asUser('admin'), 'GET', '/something-new');
  assert.equal(denied.allowed, false);
  assert.equal(denied.status, 403);
});

test('unauthenticated requests are rejected', () => {
  const denied = attempt(undefined, 'GET', '/overview');
  assert.equal(denied.allowed, false);
  assert.equal(denied.status, 401);
});

// The map defaults to deny, so a route added without an entry would 403 for
// everyone. These two checks fail loudly instead of leaving that to be found in
// production.

test('every route registered on the API router maps to a view', () => {
  const router = require('../src/routes');
  const unmapped = new Set();

  for (const layer of router.stack) {
    const routePath = layer.route?.path;
    if (!routePath) continue;
    const segment = routePath.split('/').filter(Boolean)[0];
    if (segment && !VIEW_BY_SEGMENT[segment]) unmapped.add(segment);
  }

  assert.deepEqual(
    [...unmapped],
    [],
    'Add these path segments to VIEW_BY_SEGMENT in src/middleware/authorize.js'
  );
});

test('every sub-router mounted under /api maps to a view', () => {
  // Express 5 does not expose mount prefixes on the router stack, so read them
  // from where they are declared.
  const sources = [
    path.join(__dirname, '../src/routes/index.js'),
    path.join(__dirname, '../src/server.js'),
  ];

  const unmapped = new Set();
  for (const file of sources) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [, mount] of source.matchAll(/\.use\(\s*'(\/[^']*)'/g)) {
      // server.js mounts include the /api prefix that routes/index.js sits under.
      const segments = mount.replace(/^\/api\b/, '').split('/').filter(Boolean);
      const segment = segments[0];
      if (!segment) continue;
      if (!VIEW_BY_SEGMENT[segment] && !UNGATED_SEGMENTS.has(segment)) unmapped.add(segment);
    }
  }

  assert.deepEqual(
    [...unmapped],
    [],
    'Add these mount prefixes to VIEW_BY_SEGMENT or UNGATED_SEGMENTS in src/middleware/authorize.js'
  );
});
