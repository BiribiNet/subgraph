import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { API_BASE, BRB_PROJECT_ID, goldskyToken, verifyBrbProject, validateReleaseTarget } from './goldsky-project.mjs';
import { promoteRelease } from './goldsky-promote.mjs';

export function releaseTarget(network, operation, version, previous) {
  if (!['mainnet', 'testnet'].includes(network) || !['inspect', 'validate', 'promote', 'restore-testnet'].includes(operation)) throw Error('Invalid release operation/network');
  if (operation === 'restore-testnet' && network !== 'testnet') throw Error('Recovery is limited to the missing Sepolia alias');
  const name = network === 'mainnet' ? 'biribi-arbitrum-one' : 'biribi';
  validateReleaseTarget(name, version);
  if (['validate', 'promote'].includes(operation)) {
    validateReleaseTarget(name, previous);
    if (version === previous) throw Error('Candidate must differ from rollback version');
  }
  return { name, chainId: network === 'mainnet' ? 42161 : 421614,
    rpc: network === 'mainnet' ? 'https://arb1.arbitrum.io/rpc' : 'https://sepolia-rollup.arbitrum.io/rpc',
    manifestPath: network === 'mainnet' ? 'deployments/arbitrum-one.json' : 'deployments/arbitrum-sepolia.json' };
}
export function privateEndpoint(name, entry) {
  const url = new URL(entry.private_graphql_endpoint, API_BASE);
  if (url.origin !== API_BASE || url.username || url.password || url.search || url.hash
      || url.pathname !== `/api/private/${BRB_PROJECT_ID}/subgraphs/${name}/${entry.version}/gn`) throw Error('Unexpected private endpoint');
  return url.href;
}
export function assertCandidate(entry) {
  if (!entry || entry.health !== 'healthy' || entry.synced !== true || entry.public_endpoint_enabled !== false
      || entry.private_endpoint_enabled !== true || !entry.deployments?.length
      || entry.deployments.some(item => item.fatal_error || item.non_fatal_errors?.length)) throw Error('Candidate must be healthy, synchronized and private-only');
}
export function assertMarkets(markets, manifest) {
  const expected = Object.values(manifest.markets);
  if (!Array.isArray(markets) || markets.length !== expected.length) throw Error('Incomplete market catalogue');
  for (const market of expected) {
    const matches = markets.filter(item => String(item.marketId) === String(market.marketId));
    if (matches.length !== 1 || matches[0].asset?.toLowerCase() !== market.asset.toLowerCase()
        || matches[0].bank?.toLowerCase() !== market.bank.toLowerCase()) throw Error('Market identity differs from the canonical manifest');
  }
}

export async function runReleaseCheck(env = process.env, {
  fetcher = fetch, execute = execFileSync,
  readManifest = path => JSON.parse(readFileSync(path, 'utf8')),
  writeReport = report => writeFileSync('goldsky-release-status.json', JSON.stringify(report, null, 2) + '\n'),
} = {}) {
  const { RELEASE_NETWORK: network, RELEASE_OPERATION: operation, VERSION: version, EXPECTED_LIVE_VERSION: previous } = env;
  const target = releaseTarget(network, operation, version, previous);
  const token = goldskyToken(env);
  await verifyBrbProject(token, fetcher);
  const auth = { Authorization: `Bearer ${token}` };
  async function json(url, options = {}) {
    try {
      const response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw Error();
      const body = await response.json();
      if (body.errors || body.error) throw Error();
      return body;
    } catch { throw Error('Release request failed; credential-bearing request details omitted'); }
  }
  const entries = (await json(`${API_BASE}/api/admin/subgraph/v1/subgraphs/${target.name}/deployments`, { headers: auth })).data;
  if (!Array.isArray(entries)) throw Error('Missing deployment metadata');
  const candidate = entries.find(item => item.version === version);
  const prod = entries.find(item => item.version === 'prod');
  const query = async entry => (await json(privateEndpoint(target.name, entry), { method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `{ _meta { deployment block { number } hasIndexingErrors } markets(orderBy:marketId) { marketId asset bank }
      ${network === 'testnet' ? 'roulettePlacements(first:1,orderBy:timestamp,orderDirection:desc) { id transactionHash }' : ''} }` }),
  })).data;
  const report = { network, operation, version, expectedLiveVersion: previous || null, checkedAt: new Date().toISOString(),
    health: candidate?.health ?? null, synced: candidate?.synced ?? false, progress: candidate?.deployments?.[0]?.indexing_progress ?? null,
    privateOnly: candidate?.private_endpoint_enabled === true && candidate?.public_endpoint_enabled === false,
    prodTarget: prod?.tag?.target_version ?? null, candidate: null, promotionAttempted: false, promoted: false };
  let data;
  try {
    try {
      if (candidate?.private_endpoint_enabled === true) data = await query(candidate);
    } catch (error) {
      if (operation !== 'inspect') throw error;
      report.queryReady = false;
    }
    report.candidate = data ?? null;
    if (operation === 'inspect') return report;
    assertCandidate(candidate);
    if (!data?._meta || data._meta.hasIndexingErrors !== false) throw Error('Candidate query is not healthy');
    const manifest = readManifest(target.manifestPath);
    assertMarkets(data.markets, manifest);
    const chain = await json(target.rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) });
    if (Number(BigInt(chain.result)) !== target.chainId) throw Error('RPC chain mismatch');
    if (operation === 'restore-testnet') {
      if (prod) throw Error('Cannot recover over an existing prod alias');
      if (!data.roulettePlacements?.some(item => /^0x[\da-f]{64}$/i.test(item.transactionHash ?? ''))) throw Error('Restoration requires indexed placement receipts');
    } else {
      const rollback = entries.find(item => item.version === previous);
      if (!prod || prod.tag?.target_version !== previous || !rollback) throw Error('Prod target changed; inspect before release');
      const [liveData, rollbackData] = await Promise.all([query(prod), query(rollback)]);
      if (liveData?._meta?.deployment !== rollbackData?._meta?.deployment) throw Error('Rollback does not match the live deployment');
      execute(process.execPath, ['scripts/validate-deploy.mjs', previous, version], { stdio: 'inherit',
        env: { ...env, GOLDSKY_API_TOKEN: token, GOLDSKY_SUBGRAPH_NAME: target.name } });
    }
    execute(process.execPath, ['scripts/reconcile-vaults.mjs', target.manifestPath], { stdio: 'inherit',
      env: { ...env, RPC_URL: target.rpc, SUBGRAPH_URL: privateEndpoint(target.name, candidate), SUBGRAPH_AUTH_TOKEN: token, TOLERANCE: '0' } });
    if (operation === 'promote' || operation === 'restore-testnet') {
      // Recheck alias identity immediately before the only tag mutation.
      const fresh = (await json(`${API_BASE}/api/admin/subgraph/v1/subgraphs/${target.name}/deployments`, { headers: auth })).data;
      if (!Array.isArray(fresh)) throw Error('Missing fresh deployment metadata; prod state is unknown');
      const live = fresh.find(item => item.version === 'prod');
      if (operation === 'restore-testnet' ? live : live?.tag?.target_version !== previous) throw Error('Prod changed during validation');
      report.promotionAttempted = true;
      await promoteRelease(target.name, version, token, fetcher);
      const after = await query({ version: 'prod', private_graphql_endpoint: `/api/private/${BRB_PROJECT_ID}/subgraphs/${target.name}/prod/gn` });
      if (after?._meta?.deployment !== data._meta.deployment || after._meta.hasIndexingErrors !== false) throw Error('Promoted alias verification failed; inspect before retrying');
      report.promoted = true;
    }
    return report;
  } finally {
    writeReport(report);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await runReleaseCheck(), null, 2));
}
