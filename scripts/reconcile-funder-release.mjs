// Read-only release gate: historical entity equality and no introduced ERC-4626 drift.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { goldskyToken, verifyBrbProject } from './goldsky-project.mjs';

const require = createRequire(new URL('../../biribi/package.json', import.meta.url));
const { createPublicClient, fallback, http, parseAbi } = require('viem');
const root = new URL('../../biribi/reports/upgrades/dai-usdc-route-mainnet-20261029/', import.meta.url);
const journal = JSON.parse(readFileSync(new URL('journal.json', root)));
const block = Number(journal.transactions.find(row => row.label === 'deploy routed funder').block) - 1;
const token = goldskyToken();
const candidateVersion = '1.1.4';
const endpoint = version => `https://api.goldsky.com/api/private/project_cmfbfxud380il01v04gey3ym6/subgraphs/biribi-arbitrum-one/${version}/gn`;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function query(version, query) {
  const response = await fetch(endpoint(version), { method: 'POST', headers, body: JSON.stringify({ query }),
    redirect: 'error', signal: AbortSignal.timeout(30000) });
  assert(response.ok, `Private query failed for ${version}: HTTP ${response.status}`);
  const value = await response.json();
  assert(!value.errors, `Query failed for ${version}: ${value.errors?.map(x => x.message).join('; ')}`);
  return value.data;
}
const unwrap = type => type.ofType ? unwrap(type.ofType) : type;
const isList = type => type.kind === 'LIST' || !!type.ofType && isList(type.ofType);
async function main() {
  await verifyBrbProject(token);
  const versionsResponse = await fetch('https://api.goldsky.com/api/admin/subgraph/v1/subgraphs/biribi-arbitrum-one/deployments', { headers });
  assert(versionsResponse.ok);
  const versions = (await versionsResponse.json()).data;
  const candidate = versions.find(x => x.version === candidateVersion);
  assert(candidate && candidate.health === 'healthy' && candidate.private_endpoint_enabled && !candidate.public_endpoint_enabled);
  const candidateMeta = await query(candidateVersion, '{_meta{block{number} hasIndexingErrors}}');
  assert(candidateMeta._meta.block.number >= block && !candidateMeta._meta.hasIndexingErrors,
    'Candidate has not copied the comparison block yet; production is unchanged');
  const schema = await query('1.1.0', `{__schema{queryType{fields{name args{name} type{kind name ofType{kind name ofType{kind name ofType{kind name}}}}}}
    types{kind name fields{name type{kind name ofType{kind name ofType{kind name ofType{kind name}}}}}}}}`);
  const types = new Map(schema.__schema.types.map(type => [type.name, type]));
  const collections = schema.__schema.queryType.fields.filter(field => isList(field.type) && field.args.some(arg => arg.name === 'where')
    && types.get(unwrap(field.type).name)?.fields?.some(item => item.name === 'id'));
  assert(collections.length > 20, 'Entity discovery failed; a zero-record audit must never pass');
  const report = { status: 'running', oldVersion: '1.1.0', candidateVersion, block,
    candidateSyncedAtAudit: candidate.synced === true, fullSynchronizationRequiredSeparatelyBeforePromotion: true,
    reason: 'Block immediately before replacement deployment excludes only the intentionally new funder events', entities: [], vaults: [] };
  for (let offset = 0; offset < collections.length; offset += 2) {
    await Promise.all(collections.slice(offset, offset + 2).map(async collection => {
      const fields = types.get(unwrap(collection.type).name).fields.filter(field => ['SCALAR', 'ENUM'].includes(unwrap(field.type).kind)).map(field => field.name).join(' ');
      async function rows(version) {
        const all = []; let cursor;
        for (;;) {
          const where = cursor ? `,where:{id_gt:${JSON.stringify(cursor)}}` : '';
          const data = await query(version, `{${collection.name}(first:500,orderBy:id,orderDirection:asc,block:{number:${block}}${where}){${fields}}}`);
          const page = data[collection.name]; all.push(...page);
          if (page.length < 500) return all;
          cursor = page.at(-1).id;
        }
      }
      const [oldRows, newRows] = await Promise.all([rows('1.1.0'), rows(candidateVersion)]);
      assert.deepEqual(newRows, oldRows, `Historical ${collection.name} changed`);
      report.entities.push({ collection: collection.name, count: oldRows.length, sha256: sha(oldRows), equal: true });
    }));
    // Keep this read-only audit within the project's authenticated query budget.
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  report.entities.sort((a, b) => a.collection.localeCompare(b.collection));
  writeFileSync(fileURLToPath(new URL('historical-entity-comparison.json', root)), JSON.stringify({
    status: 'passed', block, candidateVersion, entities: report.entities,
    recordsCompared: report.entities.reduce((sum, entry) => sum + entry.count, 0), checkedAt: new Date().toISOString(),
  }, null, 2) + '\n');
  const pc = createPublicClient({ transport: fallback([http('https://arbitrum-one-rpc.publicnode.com', { timeout: 15000 }),
    http('https://arb1.arbitrum.io/rpc', { timeout: 15000 })]) });
  // Use a fresh common block for chain reads: public Arbitrum RPCs prune old execution state.
  // The immutable historical comparison above stays pinned before replacement deployment.
  const [oldMeta, freshMeta, chainHead] = await Promise.all([query('1.1.0', '{_meta{block{number}}}'),
    query(candidateVersion, '{_meta{block{number}}}'), pc.getBlockNumber()]);
  const vaultBlock = Math.min(oldMeta._meta.block.number, freshMeta._meta.block.number, Number(chainHead)) - 8;
  report.vaultComparisonBlock = vaultBlock;
  const marketQuery = `{markets(block:{number:${vaultBlock}},orderBy:marketId){id bank totalAssets totalShares}}`;
  const [markets, oldMarkets] = await Promise.all([query(candidateVersion, marketQuery), query('1.1.0', marketQuery)]);
  assert.deepEqual(markets, oldMarkets, 'Candidate must not introduce any vault accounting change');
  const abi = parseAbi(['function totalAssets() view returns(uint256)', 'function totalSupply() view returns(uint256)']);
  for (const market of markets.markets) {
    const [assets, shares] = await Promise.all(['totalAssets', 'totalSupply'].map(functionName => pc.readContract({
      address: market.bank, abi, functionName, blockNumber: BigInt(vaultBlock) })));
    assert.equal(shares.toString(), market.totalShares, `Vault ${market.id} share drift`);
    const baselineDrift = (BigInt(market.totalAssets) - assets).toString();
    report.vaults.push({ market: market.id, onChainAssets: assets.toString(), indexedAssets: market.totalAssets,
      shares: shares.toString(), existingBaselineAssetDrift: baselineDrift, introducedAssetDrift: '0', shareDrift: '0' });
  }
  report.status = 'passed'; report.checkedAt = new Date().toISOString();
  report.existingAssetDriftPreserved = report.vaults.some(vault => vault.existingBaselineAssetDrift !== '0');
  writeFileSync(fileURLToPath(new URL('indexer-reconciliation.json', root)), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, block, entityCollections: report.entities.length,
    recordsCompared: report.entities.reduce((sum, item) => sum + item.count, 0), vaults: report.vaults }));
}
main().catch(error => { console.error(error.name, error.message?.replace(/https?:\S+/g, '[URL]')); process.exitCode = 1; });
