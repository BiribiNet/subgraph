import test from 'node:test';
import assert from 'node:assert/strict';
import { credential, validateTarget, submitValidation } from './goldsky-stage-client.mjs';

const input = { name: 'biribi', version: 'validation-123-1', token: 'test-secret', bundle: new Uint8Array([1, 2, 3]) };
test('missing or blank credentials fail; legacy secret remains supported', () => {
  for (const env of [{}, { GOLDSKY_API_TOKEN: '   ' }]) assert.throws(() => credential(env), /GOLDSKY_API_TOKEN/);
  assert.equal(credential({ GOLDSKY_API_TOKEN: ' ', GOLDSKY_TOKEN: 'legacy' }), 'legacy');
});
test('rejects prod, empty validation suffix and URL path injection', () => {
  for (const version of ['prod', 'latest', 'validation-', 'validation-x/../../prod']) assert.throws(() => validateTarget('biribi', version));
  assert.throws(() => validateTarget('../other', 'validation-123'));
});
test('invalid input causes no network call', async () => {
  let calls = 0;
  for (const change of [{ version: 'prod' }, { token: '' }, { bundle: new Uint8Array() }]) {
    await assert.rejects(submitValidation({ ...input, ...change }, async () => { calls++; }));
  }
  assert.equal(calls, 0);
});
test('one deployment request, overwrite disabled, no tag mutation', async () => {
  const calls = [];
  const result = await submitValidation(input, async (url, options) => {
    calls.push(url);
    assert.equal(options.method, 'PUT');
    assert.equal(options.redirect, 'error');
    for (const name of ['overwrite', 'remove_graft', 'skip_graft_validation']) assert.equal(options.body.get(name), '0');
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    return { ok: true, json: async () => ({ data: { health: 'healthy', graphql_endpoint: 'https://unsafe.example/?token=test-secret' } }) };
  });
  assert.deepEqual(calls, ['https://api.goldsky.com/api/admin/subgraph/v1/subgraphs/biribi/deployments/validation-123-1']);
  assert.equal(result.indexingVerified, false);
  assert.equal(result.productionAliasChanged, false);
  assert.match(result.bundleSha256, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(result).includes(input.token));
});
test('uncertain network failure neither retries nor exposes transport secrets', async () => {
  let calls = 0;
  await assert.rejects(submitValidation(input, async () => { calls++; throw new Error('Bearer test-secret'); }), error => {
    assert.match(error.message, /status unknown/);
    assert.ok(!error.message.includes(input.token)); return true;
  });
  assert.equal(calls, 1);
});
test('HTTP conflict cannot be mistaken for accepted deployment', async () => {
  await assert.rejects(submitValidation(input, async () => ({ ok: false, status: 409 })), /HTTP 409/);
});
test('unreadable successful response remains uncertain', async () => {
  await assert.rejects(submitValidation(input, async () => ({ ok: true, json: async () => { throw new Error('test-secret'); } })), /status unknown/);
});
test('unexpected server fields are not copied into a public receipt', async () => {
  const result = await submitValidation(input, async () => ({ ok: true, json: async () => ({ data: { health: 'test-secret', secret: input.token } }) }));
  assert.equal(result.health, null);
  assert.ok(!JSON.stringify(result).includes(input.token));
});
