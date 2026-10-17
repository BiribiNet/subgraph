import test from 'node:test';
import assert from 'node:assert/strict';
import { securePrivateEndpoint } from './goldsky-private-endpoint.mjs';
import { BRB_PROJECT_ID } from './goldsky-project.mjs';
const project = { data: [{ projectId: BRB_PROJECT_ID, name: 'brb', currentlyAuthenticated: true }] };
function mock({ label = '1.1.0', publicEnabled = false, privateEnabled = true, projectPayload = project, failWrite = false } = {}) {
  const writes = [];
  return { writes, fetcher: async (url, options) => {
    assert.equal(options.redirect, 'error');
    if (url.endsWith('/projects')) return { ok: true, json: async () => projectPayload };
    if (options.method === 'PUT') {
      writes.push({ url, body: JSON.parse(options.body) });
      if (failWrite) throw Error('credential must not appear in errors');
      return { ok: true };
    }
    return { ok: true, json: async () => ({ data: [{ version: label, public_endpoint_enabled: publicEnabled, private_endpoint_enabled: privateEnabled }] }) };
  } };
}
test('restricts immutable versions and prod aliases, then verifies both flags', async () => {
  for (const label of ['1.1.0', 'prod']) {
    const { writes, fetcher } = mock({ label });
    await securePrivateEndpoint('biribi-arbitrum-one', label, 'credential', fetcher);
    assert.deepEqual(writes, [{ url: `https://api.goldsky.com/api/admin/subgraph/v1/subgraph/biribi-arbitrum-one/deployment/${label}/update`, body: { public_endpoint_enabled: false, private_endpoint_enabled: true } }]);
  }
});
test('cannot mutate an unknown target or another project', async () => {
  for (const [name, label, payload] of [['other', '1.1.0', project], ['biribi', '../other', project], ['biribi', 'prod', { data: [] }]]) {
    const { writes, fetcher } = mock({ projectPayload: payload });
    await assert.rejects(securePrivateEndpoint(name, label, 'credential', fetcher));
    assert.equal(writes.length, 0);
  }
});
test('a successful update without private-only readback is a failure', async () => {
  for (const flags of [{ publicEnabled: true }, { privateEnabled: false }, { label: 'wrong-version' }]) {
    const { writes, fetcher } = mock(flags);
    await assert.rejects(securePrivateEndpoint('biribi', '1.1.0', 'credential', fetcher), /unconfirmed/);
    assert.equal(writes.length, 1);
  }
});
test('uncertain updates do not retry or reveal transport errors', async () => {
  const { writes, fetcher } = mock({ failWrite: true });
  await assert.rejects(securePrivateEndpoint('biribi', '1.1.0', 'credential', fetcher), error => /unconfirmed/.test(error.message) && !/credential/.test(error.message));
  assert.equal(writes.length, 1);
});
