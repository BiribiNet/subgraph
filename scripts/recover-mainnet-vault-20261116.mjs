import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { API_BASE, goldskyToken, verifyBrbProject } from './goldsky-project.mjs';
import { assertCandidate, assertMarkets, privateEndpoint } from './goldsky-release-check.mjs';
import { promoteRelease } from './goldsky-promote.mjs';

const name = 'biribi-arbitrum-one';
const version = 'validation-vault-recovery-20261116';
const failedVersion = 'validation-tips-fees-20261102-d829122';
const failedDeployment = 'QmQvQU3xWxSxQ4E4yBuatfeUL6Xo2178hgx2kz3RKiMvLF';
const failedBlock = 524505182;
const resolutionTx = '0xf403f7d70cef6b084bc440e20af503d74015f3726feccd8fed009ab3dd80e3e6';
const rpcUrl = 'https://arbitrum.gateway.tenderly.co';
const manifestPath = 'deployments/arbitrum-one.json';
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const token = goldskyToken();
await verifyBrbProject(token);
const auth = { Authorization: `Bearer ${token}` };
const jsonHeaders = { 'Content-Type': 'application/json' };
const metaQuery = '{ _meta { deployment hasIndexingErrors block { number hash } } }';

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000) });
  assert(response.ok, `Request failed (HTTP ${response.status})`);
  return response.json();
}

async function entries() {
  const { data } = await request(`${API_BASE}/api/admin/subgraph/v1/subgraphs/${name}`, { headers: auth });
  assert(Array.isArray(data), 'Deployment status unavailable');
  return data;
}

async function query(entry, document, expectFailedIndex = false) {
  const { data, errors } = await request(privateEndpoint(name, entry), {
    method: 'POST', headers: { ...jsonHeaders, ...auth }, body: JSON.stringify({ query: document }),
  });
  assert(data && (!errors?.length || (expectFailedIndex && errors.every(item => item.message === 'indexing_error'))),
    'Unexpected GraphQL error');
  return data;
}

async function rpc(method, params = []) {
  const { result, error } = await request(rpcUrl, {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  assert(result && !error, `Arbitrum RPC read failed: ${method}`);
  return result;
}

assert.equal(await rpc('eth_chainId'), '0xa4b1');
const receipt = await rpc('eth_getTransactionReceipt', [resolutionTx]);
assert.equal(receipt.status, '0x1');
assert.equal(Number(receipt.blockNumber), failedBlock);
const resolutionTime = Number((await rpc('eth_getBlockByNumber', [receipt.blockNumber, false])).timestamp);

let candidate;
for (let attempt = 0; attempt < 70; attempt++) {
  const current = await entries();
  candidate = current.find(entry => entry.version === version);
  if (candidate?.health === 'failed' || candidate?.deployments?.some(item => item.fatal_error)) {
    throw Error('Candidate has a fatal indexing error. See Goldsky logs.');
  }
  if (candidate?.health === 'healthy' && candidate.synced === true) break;
  if (attempt % 3 === 0) console.log('Awaiting candidate sync', candidate?.health, candidate?.deployments?.[0]?.indexing_progress ?? '');
  await setTimeout(30000);
}
assertCandidate(candidate);
const data = await query(candidate, `{
  _meta { deployment hasIndexingErrors block { number hash } }
  markets(orderBy:marketId) { marketId asset bank }
  globalRounds(first:1,where:{roundNumber:"173"},block:{number:${failedBlock}}) { roundNumber status resolvedAt }
}`);
assertMarkets(data.markets, manifest);
assert.equal(data._meta.hasIndexingErrors, false);
assert.notEqual(data._meta.deployment, failedDeployment);
const indexedBlock = data._meta.block.number;
assert(indexedBlock > failedBlock && (Number(await rpc('eth_blockNumber')) - indexedBlock) < 300, 'Candidate index is stale');
const indexedHash = (await rpc('eth_getBlockByNumber', ['0x' + indexedBlock.toString(16), false])).hash;
assert.equal(data._meta.block.hash, indexedHash, 'Indexed head differs from Arbitrum');
assert.deepEqual(data.globalRounds, [{ roundNumber:'173', status:'CLEAN', resolvedAt:String(resolutionTime) }]);
console.log('Verified round 173 at', failedBlock);

for (const block of [failedBlock - 1, indexedBlock]) {
  const pinned = await query(candidate, `{ markets(orderBy:marketId,block:{number:${block}}) {
    marketId asset bank totalAssets totalShares
  } }`);
  assertMarkets(pinned.markets, manifest);
  const tag = '0x' + block.toString(16);
  for (const m of pinned.markets) {
    const [assets, shares] = await Promise.all([
      rpc('eth_call', [{to:m.bank,data:'0x01e1d114'},tag]),
      rpc('eth_call', [{to:m.bank,data:'0x18160ddd'},tag]),
    ]);
    assert.equal(BigInt(m.totalAssets), BigInt(assets), `Vault assets drift at ${block} market ${m.marketId}`);
    assert.equal(BigInt(m.totalShares), BigInt(shares), `Vault supply drift at ${block} market ${m.marketId}`);
    console.log(`Vault ${m.marketId} reconciled at ${block}`);
  }
}

const canonicalRpc = async (method, params) => {
  const response = await request('https://arb1.arbitrum.io/rpc', {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({jsonrpc:'2.0',id:1,method,params}),
  });
  assert(response.result && !response.error, `Arbitrum RPC read failed: ${method}`);
  return response.result;
};
const { verifyTipPoints } = await import('./verify-tip-points.mjs');
const tips = await verifyTipPoints({
  manifest, block:indexedBlock, graphql: document => query(candidate, document), rpc: canonicalRpc,
});
console.log('Tip accounting verified', tips.tipCount, 'receipts and', tips.usersChecked, 'users');

const prod = (await entries()).find(entry => entry.version === 'prod');
assert.equal(prod?.tag?.target_version, failedVersion, 'Prod target changed during recovery validation');
const { _meta: previous } = await query(prod, metaQuery, true);
assert.equal(previous.deployment, failedDeployment, 'Unexpected prod deployment');
assert.equal(previous.hasIndexingErrors, true, 'Prod is no longer reporting an indexing error');
assert.equal(previous.block.number, failedBlock, 'Prod advanced during recovery validation');

const latestProd = (await entries()).find(entry => entry.version === 'prod');
assert.equal(latestProd?.tag?.target_version, failedVersion, 'Prod target changed before promotion');
await promoteRelease(name, version, token);
const active = (await entries()).find(entry => entry.version === 'prod');
assert.equal(active?.tag?.target_version, version);
assert.equal(active.private_endpoint_enabled, true);
assert.equal(active.public_endpoint_enabled, false);
const after = await query(active, metaQuery);
assert.equal(after._meta.deployment, data._meta.deployment);
assert.equal(after._meta.hasIndexingErrors, false);
console.log('Active private deployment', after._meta.deployment, 'block', after._meta.block.number);
