'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const authPath = require.resolve('../netlify/functions/ngcc-ops-auth');
const opsPath = require.resolve('../netlify/functions/lib/ngcc-ops');

function loadAuth(overrides = {}) {
  const keys = ['AUTH_TOKEN_SECRET', 'NGCC_OPS_PASSWORD', 'NGCC_TEST_OPS_PASSWORD', 'NGCC_TEST_OPS_EXPIRES_AT'];
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, {
    AUTH_TOKEN_SECRET: 'unit-test-session-secret',
    NGCC_OPS_PASSWORD: 'normal-operator-password',
    ...overrides,
  });
  delete require.cache[authPath];
  delete require.cache[opsPath];
  return require(authPath).handler;
}

function post(password) {
  return {
    httpMethod: 'POST',
    headers: { origin: 'https://federalcontractorportal.aproposgroupllc.com' },
    body: JSON.stringify({ password }),
  };
}

test('normal operator receives an operator session', async () => {
  const handler = loadAuth();
  const response = await handler(post('normal-operator-password'));
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(body.ok, true);
  assert.equal(body.role, 'operator');
  assert.match(body.token, /^\d+\.operator\.[a-f0-9]{64}$/);
});

test('active temporary credential receives a bounded test_operator session', async () => {
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const handler = loadAuth({
    NGCC_TEST_OPS_PASSWORD: 'temporary-test-password',
    NGCC_TEST_OPS_EXPIRES_AT: expires,
  });
  const response = await handler(post('temporary-test-password'));
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(body.ok, true);
  assert.equal(body.role, 'test_operator');
  assert.ok(Date.parse(body.expires_at) <= Date.parse(expires));
  assert.match(body.token, /^\d+\.test_operator\.[a-f0-9]{64}$/);
});

test('expired temporary credential is rejected', async () => {
  const handler = loadAuth({
    NGCC_TEST_OPS_PASSWORD: 'temporary-test-password',
    NGCC_TEST_OPS_EXPIRES_AT: new Date(Date.now() - 1000).toISOString(),
  });
  const response = await handler(post('temporary-test-password'));
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 401);
  assert.equal(body.ok, false);
  assert.match(body.error, /expired|not active/i);
});

test('test_operator role can be excluded from privileged guards', async () => {
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const handler = loadAuth({
    NGCC_TEST_OPS_PASSWORD: 'temporary-test-password',
    NGCC_TEST_OPS_EXPIRES_AT: expires,
  });
  const login = JSON.parse((await handler(post('temporary-test-password'))).body);
  const { opsGuard } = require(opsPath);
  const denied = opsGuard({
    headers: {
      origin: 'https://federalcontractorportal.aproposgroupllc.com',
      authorization: `Bearer ${login.token}`,
    },
  }, ['operator']);
  assert.equal(denied.statusCode, 403);
});
