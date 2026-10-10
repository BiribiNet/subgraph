import test from 'node:test';
import assert from 'node:assert/strict';
import { BRB_PROJECT_ID, assertProjectResponse, verifyBrbProject, validateReleaseTarget, assertBuildNetwork } from './goldsky-project.mjs';
const project = { projectId: BRB_PROJECT_ID, name: 'brb', currentlyAuthenticated: true };
test('requires authenticated BRB project ID and name, never merely project membership', () => {
  assert.deepEqual(assertProjectResponse({ data: [project] }), { projectId: BRB_PROJECT_ID, name: 'brb' });
  for (const data of [[], [{ ...project, currentlyAuthenticated: false }], [{ ...project, name: 'other' }], [{ ...project, projectId: 'project_other' }], [project, project]]) {
    assert.throws(() => assertProjectResponse({ data }));
  }
  assert.throws(() => assertProjectResponse({}));
});
test('project checks are read-only and transport errors redact credentials', async () => {
  await verifyBrbProject('secret', async (url, options) => {
    assert.equal(options.method, undefined);
    assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => ({ data: [project] }) };
  });
  await assert.rejects(verifyBrbProject('secret', async () => { throw new Error('secret'); }), error => !error.message.includes('secret'));
});
test('mainnet cannot use the existing testnet subgraph name', () => {
  assertBuildNetwork('biribi', '    network: arbitrum-sepolia\n');
  assertBuildNetwork('biribi-arbitrum-one', '    network: arbitrum-one\n');
  assert.throws(() => assertBuildNetwork('biribi', '    network: arbitrum-one\n'));
  assert.throws(() => assertBuildNetwork('biribi-arbitrum-one', '    network: arbitrum-one\n    network: arbitrum-sepolia\n'));
  assert.throws(() => assertBuildNetwork('biribi', ''));
});
test('rejects path/shell injection, public aliases as versions and unknown names', () => {
  validateReleaseTarget('biribi-arbitrum-one', '0.1.0');
  for (const version of ['prod', 'latest', '1.0.0/../../prod', '$(whoami)', '', undefined]) assert.throws(() => validateReleaseTarget('biribi', version));
  assert.throws(() => validateReleaseTarget('other', '1.0.0'));
});
