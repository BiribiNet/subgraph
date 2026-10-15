// Inspect, validate, and promote one explicitly named testnet receipt release.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { API_BASE, goldskyToken, verifyBrbProject, validateReleaseTarget } from './goldsky-project.mjs';
import { promoteRelease } from './goldsky-promote.mjs';

const operation = process.env.RELEASE_OPERATION;
const version = process.env.VERSION;
if (!['inspect', 'validate', 'promote'].includes(operation)) throw new Error('Invalid release operation');
validateReleaseTarget('biribi', version);
const token = goldskyToken();
await verifyBrbProject(token);
async function json(url, options = {}) {
  try {
    const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error();
    return await response.json();
  } catch { throw new Error('Release metadata/query request failed; credentials and upstream URLs omitted.'); }
}
const auth = { Authorization: `Bearer ${token}` };
const entries = (await json(`${API_BASE}/api/admin/subgraph/v1/subgraphs/biribi/deployments`, { headers: auth })).data;
if (!Array.isArray(entries)) throw new Error('Invalid deployment metadata');
function endpoint(entry) {
  const path = entry.private_endpoint_enabled ? entry.private_graphql_endpoint : entry.graphql_endpoint;
  const url = new URL(path, API_BASE);
  if (url.origin !== API_BASE || !url.pathname.startsWith('/api/')) throw new Error('Unexpected upstream origin');
  return url.href;
}
async function query(url, query, authenticated = true) {
  const payload = await json(url, {method:'POST', headers:{'Content-Type':'application/json', ...(authenticated ? auth : {Origin:'https://biribi.net'})}, body:JSON.stringify({query})});
  if (payload.errors) throw new Error('Release query rejected by schema/indexer');
  return payload.data;
}
const live = await query('https://biribi.net/api/subgraph', '{ _meta { deployment block { number } hasIndexingErrors } }', false);
const candidate = entries.find(entry => entry.version === version);
const report = {operation, version, live:live._meta, candidate:null, receiptSample:[], versions:entries.map(entry=>({version:entry.version,health:entry.health,synced:entry.synced}))};
if (candidate) {
  const progress=candidate.deployments?.[0]?.indexing_progress;
  report.candidate = {health:candidate.health,synced:candidate.synced,progress:progress ? {percent:progress.progress_percent,head:progress.deployment_head_block} : null};
  try {
    const data = await query(endpoint(candidate), '{ _meta { deployment block { number } hasIndexingErrors } roulettePlacements(first:2,orderBy:timestamp,orderDirection:desc) { id amount transactionHash bet { id } user { id } market { id bank assetSymbol assetDecimals } } }');
    report.candidate.meta = data._meta;
    report.receiptSample = data.roulettePlacements;
  } catch { report.candidate.queryReady = false; }
}
writeFileSync('receipt-release-status.json', JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
if (operation === 'inspect') process.exit(0);
if (!candidate || candidate.health !== 'healthy' || candidate.synced !== true || !candidate.deployments?.length || candidate.deployments.some(d=>d.fatal_error || d.non_fatal_errors?.length) || !report.receiptSample.length || report.candidate.meta?.hasIndexingErrors !== false) throw new Error('Candidate is not healthy, synchronized, and serving placement receipts');
if (process.env.EXPECTED_LIVE_DEPLOYMENT !== live._meta.deployment) throw new Error('Public deployment changed; inspect before retrying');
// Resolve the rollback version by its observed content hash, never by version order.
let liveVersion;
for (let offset=0;offset<entries.length && !liveVersion;offset+=6) {
  const batch=await Promise.all(entries.slice(offset,offset+6).map(async entry=>{try {const data=await query(endpoint(entry),'{ _meta { deployment } }'); return data._meta.deployment === live._meta.deployment ? entry.version : null;}catch{return null;}}));
  liveVersion=batch.find(Boolean);
}
if (!liveVersion || liveVersion === version) throw new Error('Distinct rollback version could not be resolved');
execFileSync(process.execPath,['scripts/validate-deploy.mjs',liveVersion,version],{stdio:'inherit',env:{...process.env,STRICT_RECEIPT_RELEASE:'1'}});
execFileSync(process.execPath,['scripts/reconcile-vaults.mjs'],{stdio:'inherit',env:{...process.env,SUBGRAPH_URL:endpoint(candidate),SUBGRAPH_AUTH_TOKEN:token}});
const fresh=await query('https://biribi.net/api/subgraph','{ _meta { deployment } }',false);
if (fresh._meta.deployment !== process.env.EXPECTED_LIVE_DEPLOYMENT) throw new Error('Public deployment changed during validation');
if (operation === 'promote') {
  await promoteRelease('biribi',version,token);
  const after=await query('https://biribi.net/api/subgraph','{ _meta { deployment } roulettePlacements(first:1) { id transactionHash } }',false);
  if (after._meta.deployment !== report.candidate.meta.deployment || !after.roulettePlacements.length) throw new Error('Public alias verification failed after promotion; inspect before retrying');
  console.log(JSON.stringify({promoted:true,version,rollback:liveVersion,deployment:after._meta.deployment}));
}
