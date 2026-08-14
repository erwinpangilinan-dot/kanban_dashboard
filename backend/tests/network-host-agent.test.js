const test = require('node:test');
const assert = require('node:assert');

const agent = require('../src/services/network-host-agent');

const TOKEN = 'test-token-value';

function withToken(value, fn) {
  const previous = process.env.NETWORK_HOST_AGENT_TOKEN;
  if (value === undefined) delete process.env.NETWORK_HOST_AGENT_TOKEN;
  else process.env.NETWORK_HOST_AGENT_TOKEN = value;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env.NETWORK_HOST_AGENT_TOKEN;
    else process.env.NETWORK_HOST_AGENT_TOKEN = previous;
  }
}

test('hostAgentHeaders refuses to build a request when no token is configured', () => {
  withToken(undefined, () => {
    assert.throws(() => agent.hostAgentHeaders(), /NETWORK_HOST_AGENT_TOKEN is not set/);
  });
});

test('hostAgentHeaders attaches the token and preserves caller headers', () => {
  withToken(TOKEN, () => {
    const headers = agent.hostAgentHeaders({ 'Content-Type': 'application/json' });
    assert.equal(headers['Content-Type'], 'application/json');
    assert.equal(headers[agent.TOKEN_HEADER], TOKEN);
  });
});

test('requestHasValidAgentToken accepts a matching token', () => {
  withToken(TOKEN, () => {
    assert.equal(
      agent.requestHasValidAgentToken({ headers: { [agent.TOKEN_HEADER]: TOKEN } }),
      true
    );
  });
});

test('requestHasValidAgentToken rejects wrong, absent, and prefix tokens', () => {
  withToken(TOKEN, () => {
    assert.equal(
      agent.requestHasValidAgentToken({ headers: { [agent.TOKEN_HEADER]: 'wrong' } }),
      false
    );
    assert.equal(agent.requestHasValidAgentToken({ headers: {} }), false);
    assert.equal(
      agent.requestHasValidAgentToken({ headers: { [agent.TOKEN_HEADER]: TOKEN.slice(0, 5) } }),
      false
    );
  });
});

test('requestHasValidAgentToken rejects everything when no token is configured', () => {
  withToken(undefined, () => {
    assert.equal(agent.requestHasValidAgentToken({ headers: {} }), false);
    assert.equal(
      agent.requestHasValidAgentToken({ headers: { [agent.TOKEN_HEADER]: '' } }),
      false
    );
  });
});
