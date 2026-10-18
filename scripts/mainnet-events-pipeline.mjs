// Prepare the authenticated event mirror independently of keeper wake-ups.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { goldskyToken, verifyBrbProject, API_BASE } from './goldsky-project.mjs';

import { mainnetAbi } from './mainnet-abis.mjs';
import { deploymentAbi } from './deployment-abis.mjs';
import { WEBHOOK_AUTH } from './webhook-auth.mjs';
export const MIRROR_SECRET_NAME = WEBHOOK_AUTH['biribi-roulette-events'].secret;

export function mainnetEventsPipeline(base, deployment, abiDirectory) {
  if (deployment.chainId !== 42161 || deployment.automation?.mode !== 'cloudflare-keeper') {
    throw new Error('Requires the verified Arbitrum One autonomous keeper deployment.');
  }
  if (base.name !== 'biribi-roulette-events' || Object.keys(base.sinks ?? {}).length !== 1
      || base.sinks.webhook_events?.type !== 'webhook') throw new Error('Unexpected event mirror definition.');
  const addresses = ['brb', 'brbReferal', 'roulette', 'sideBet', 'jackpotFunder', 'scheduler',
    'creExecutionAuthority', 'tipJar', 'registry', 'jackpotTreasury']
    .map(key => deployment.addresses[key]).concat(Object.values(deployment.markets).map(m => m.bank));
  if (addresses.some(a => !/^0x[\da-f]{40}$/i.test(a) || /^0x0{40}$/i.test(a))) throw new Error('Invalid contract address.');
  const original = JSON.parse(readFileSync(join(abiDirectory, 'MergedEvents.json'), 'utf8'));
  const events = mainnetAbi('MergedEvents', deploymentAbi(original, deployment), deployment);
  if (!Array.isArray(events) || events.some(event => event.type !== 'event')) throw new Error('Expected deployed event ABI.');
  const next = structuredClone(base);
  // A new source key prevents reuse of Sepolia checkpoints during the chain switch.
  next.sources = { raw_logs_arbitrum_one: { type: 'dataset', dataset_name: 'arbitrum_one.raw_logs',
    version: '1.0.0', start_at: 'latest' } };
  next.transforms.decoded_events.sql = `SELECT
  id, address,
  _gs_log_decode('${JSON.stringify(events).replaceAll("'", "''")}', topics, data) AS decoded,
  block_number, block_timestamp, transaction_hash, log_index, _gs_op
FROM raw_logs_arbitrum_one
WHERE address IN (${[...new Set(addresses.map(a => a.toLowerCase()))].map(a => `'${a}'`).join(', ')})`;
  const sink = next.sinks.webhook_events;
  sink.url = 'https://biribi.net/api/mirror';
  sink.secret_name = MIRROR_SECRET_NAME;
  if (sink.headers) sink.headers = Object.fromEntries(Object.entries(sink.headers)
    .filter(([name]) => !['authorization', 'x-mirror-secret', 'x-webhook-secret'].includes(name.toLowerCase())));
  return next;
}

export async function validatePipeline(definition, token) {
  await verifyBrbProject(token);
  const response = await fetch(`${API_BASE}/api/admin/streamling/v1/validate`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ definition }), redirect: 'error', signal: AbortSignal.timeout(45000),
  });
  const result = await response.json();
  if (!response.ok || result.valid !== true) throw new Error(`Goldsky rejected pipeline validation (HTTP ${response.status}).`);
  return { valid: true, warnings: result.warnings ?? [] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [operation, manifestFile, abiDirectory, backupFile] = process.argv.slice(2);
  if (!['validate', 'apply'].includes(operation) || !backupFile) {
    throw new Error('Usage: mainnet-events-pipeline.mjs <validate|apply> <deployment.json> <release-abis> <new-private-backup.json>');
  }
  const token = goldskyToken();
  await verifyBrbProject(token);
  const url = `${API_BASE}/api/admin/streamling/v1/biribi-roulette-events`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` },
    redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('Cannot read the existing event mirror.');
  const previous = await response.json();
  writeFileSync(backupFile, JSON.stringify(previous, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  const definition = mainnetEventsPipeline(previous.definition,
    JSON.parse(readFileSync(manifestFile, 'utf8')), abiDirectory);
  console.log(JSON.stringify(await validatePipeline(definition, token)));
  if (operation === 'apply') {
    await verifyBrbProject(token);
    const applied = await fetch(url + '?validate=true', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ definition }), redirect: 'error', signal: AbortSignal.timeout(45000),
    });
    if (!applied.ok) throw new Error(`Pipeline update unconfirmed (HTTP ${applied.status}); inspect BRB before retrying.`);
    console.log('Goldsky accepted the Arbitrum One event mirror update. Verify running status and destination before cutover.');
  }
}
