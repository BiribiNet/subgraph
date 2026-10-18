// These pipelines only wake the autonomous mainnet keeper; neither invokes CRE.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { API_BASE, goldskyToken, verifyBrbProject } from './goldsky-project.mjs';
import { validatePipeline } from './mainnet-events-pipeline.mjs';

import { mainnetAbi } from './mainnet-abis.mjs';
import { WEBHOOK_AUTH } from './webhook-auth.mjs';
export const WAKE_SECRET_NAMES = Object.freeze(Object.fromEntries(
  ['biribi-cre-countdown', 'biribi-keeper-payout'].map(name => [name, WEBHOOK_AUTH[name].secret]),
));
const routes = { 'biribi-cre-countdown': '/webhook', 'biribi-keeper-payout': '/webhook/payout' };

export function prepareKeeperPipeline(base, deployment, engineAbi) {
  const path = routes[base.name];
  if (!path || deployment.chainId !== 42161 || deployment.automation?.mode !== 'cloudflare-keeper') {
    throw new Error('Expected an existing countdown/payout pipeline and an Arbitrum One keeper deployment.');
  }
  const engine = deployment.addresses.engine;
  if (!/^0x[\da-f]{40}$/i.test(engine) || /^0x0{40}$/i.test(engine)) throw new Error('Invalid deployed engine.');
  const worker = new URL(deployment.automation.workerUrl);
  if (worker.origin !== 'https://biribi-round-watcher-arbitrum-one.soft-thunder-4aae.workers.dev'
      || worker.search || worker.hash || worker.pathname !== '/') throw new Error('Unexpected mainnet worker destination.');
  const next = structuredClone(base);
  next.sources = { raw_logs_arbitrum_one: { type: 'dataset', dataset_name: 'arbitrum_one.raw_logs',
    version: '1.0.0', start_at: 'latest' } };
  if (!Array.isArray(engineAbi) || !engineAbi.length) throw new Error('Missing deployed engine ABI.');
  const events = mainnetAbi('Game', engineAbi, deployment).filter(entry => entry.type === 'event');
  for (const name of ['RoundCountdownStarted', 'VRFResult', 'PayoutProgress']) {
    if (!events.some(event => event.name === name)) throw new Error(`Missing deployed ${name} ABI.`);
  }
  if (!next.transforms?.decoded_events || Object.keys(next.sinks ?? {}).length !== 1) throw new Error('Unexpected pipeline topology.');
  next.transforms.decoded_events.sql = `SELECT
  id, address,
  _gs_log_decode('${JSON.stringify(events).replaceAll("'", "''")}', topics, data) AS decoded,
  block_number, block_timestamp, transaction_hash, log_index, _gs_op
FROM raw_logs_arbitrum_one
WHERE address = '${engine.toLowerCase()}'`;
  for (const sink of Object.values(next.sinks)) {
    if (sink.type !== 'webhook') throw new Error('Expected a webhook sink.');
    sink.url = worker.origin + path;
    sink.secret_name = WAKE_SECRET_NAMES[base.name];
    if (sink.headers) sink.headers = Object.fromEntries(Object.entries(sink.headers)
      .filter(([name]) => !['authorization', 'x-mirror-secret', 'x-webhook-secret'].includes(name.toLowerCase())));
  }
  return next;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [operation, deploymentFile, outputDirectory] = process.argv.slice(2);
  if (!['validate', 'apply'].includes(operation) || !outputDirectory) {
    throw new Error('Usage: mainnet-keeper-pipelines.mjs <validate|apply> <deployment.json> <new-private-backup-dir>');
  }
  const token = goldskyToken();
  await verifyBrbProject(token);
  const deployment = JSON.parse(readFileSync(deploymentFile, 'utf8'));
  const artifact = JSON.parse(readFileSync(new URL('../abis/Game.json', import.meta.url), 'utf8'));
  const abi = Array.isArray(artifact) ? artifact : artifact.abi;
  mkdirSync(outputDirectory, { mode: 0o700 });
  const definitions = [];
  for (const name of Object.keys(routes)) {
    const response = await fetch(`${API_BASE}/api/admin/streamling/v1/${name}`, {
      headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Cannot read ${name}.`);
    const previous = await response.json();
    writeFileSync(join(outputDirectory, name + '.before.private.json'), JSON.stringify(previous, null, 2), { mode: 0o600, flag: 'wx' });
    const definition = prepareKeeperPipeline(previous.definition, deployment, abi);
    writeFileSync(join(outputDirectory, name + '.mainnet.json'), JSON.stringify(definition, null, 2), { mode: 0o600, flag: 'wx' });
    console.log(name, JSON.stringify(await validatePipeline(definition, token)));
    definitions.push(definition);
  }
  if (operation === 'apply') {
    // Validate both definitions before either pipeline changes.
    for (const definition of definitions) {
      await verifyBrbProject(token);
      const response = await fetch(`${API_BASE}/api/admin/streamling/v1/${definition.name}?validate=true`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ definition }), redirect: 'error', signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) throw new Error(`${definition.name} update unconfirmed (HTTP ${response.status}); inspect BRB before retrying.`);
      console.log(`${definition.name}: mainnet update accepted.`);
    }
  }
}
