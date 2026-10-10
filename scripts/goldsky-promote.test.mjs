import test from 'node:test';
import assert from 'node:assert/strict';
import { promoteRelease } from './goldsky-promote.mjs';
import { BRB_PROJECT_ID } from './goldsky-project.mjs';
const project = { data: [{ projectId: BRB_PROJECT_ID, name: 'brb', currentlyAuthenticated: true }] };
const healthy = { version: '1.0.0', health: 'healthy', synced: true, deployments: [{ non_fatal_errors: [] }] };
function mock(candidate, writes, projectPayload = project, failWrite = false) {
  return async (url, options) => {
    assert.equal(options.redirect, 'error');
    if (url.endsWith('/projects')) return { ok: true, json: async () => projectPayload };
    if (url.endsWith('/deployments')) return { ok: true, json: async () => ({ data: [candidate] }) };
    writes.push({ url, options });
    if (failWrite) throw new Error('secret transport data');
    return { ok: true };
  };
}
test('promotion checks BRB identity and candidate health before a single prod write, with no deletes', async () => {
  const writes = [];
  await promoteRelease('biribi-arbitrum-one', '1.0.0', 'secret', mock(healthy, writes));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].options.method, 'PUT');
  assert.match(writes[0].url, /biribi-arbitrum-one\/tags\/prod$/);
  assert.deepEqual(JSON.parse(writes[0].options.body), { target_version: '1.0.0' });
});
test('wrong project and unhealthy/unsynced/error candidates cannot move prod', async () => {
  for (const candidate of [{ ...healthy, synced: false }, { ...healthy, health: 'failed' }, { ...healthy, deployments: [] }, { ...healthy, deployments: [{ fatal_error: 'error' }] }, { ...healthy, deployments: [{ non_fatal_errors: ['error'] }] }]) {
    const writes = [];
    await assert.rejects(promoteRelease('biribi', '1.0.0', 'secret', mock(candidate, writes)));
    assert.equal(writes.length, 0);
  }
  const writes = [];
  await assert.rejects(promoteRelease('biribi', '1.0.0', 'secret', mock(healthy, writes, { data: [] })));
  assert.equal(writes.length, 0);
});
test('uncertain promotion does not retry or disclose transport secrets', async () => {
  const writes = [];
  await assert.rejects(promoteRelease('biribi', '1.0.0', 'secret', mock(healthy, writes, project, true)), error => error.message.includes('unknown') && !error.message.includes('secret'));
  assert.equal(writes.length, 1);
});
