import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareKeeperPipeline, WAKE_SECRET_NAMES } from './mainnet-keeper-pipelines.mjs';
const deployment = JSON.parse(readFileSync(new URL('../deployments/arbitrum-one.json', import.meta.url)));
const artifact = JSON.parse(readFileSync(new URL('../abis/Game.json', import.meta.url)));
const abi = Array.isArray(artifact) ? artifact : artifact.abi;
const base = name => ({ name, sources: { raw_logs: { dataset_name: 'arbitrum_sepolia.raw_logs' } },
  transforms: { decoded_events: { sql: 'old testnet engine' } },
  sinks: { wake: { type: 'webhook', url: 'https://old.example/webhook', secret_name: 'OLD', headers: { Authorization: 'old' } } } });
test('both existing pipelines use fresh mainnet checkpoints, actual engine ABI and dedicated wake-up routes', () => {
  for (const [name, path] of [['biribi-cre-countdown', '/webhook'], ['biribi-keeper-payout', '/webhook/payout']]) {
    const original = base(name);
    const next = prepareKeeperPipeline(original, deployment, abi);
    assert.equal(next.sources.raw_logs_arbitrum_one.dataset_name, 'arbitrum_one.raw_logs');
    assert.equal(next.sources.raw_logs_arbitrum_one.start_at, 'latest');
    assert.equal(next.sources.raw_logs, undefined);
    assert.ok(next.transforms.decoded_events.sql.includes(deployment.addresses.engine.toLowerCase()));
    assert.equal(next.sinks.wake.url, deployment.automation.workerUrl + path);
    assert.equal(next.sinks.wake.secret_name, WAKE_SECRET_NAMES[name]);
    assert.equal(next.sinks.wake.headers.Authorization, undefined);
    assert.equal(original.sources.raw_logs.dataset_name, 'arbitrum_sepolia.raw_logs');
  }
});
test('rejects wrong chains, CRE execution, wrong workers, other pipelines and incomplete ABIs', () => {
  for (const changed of [{ chainId: 421614 }, { automation: { mode: 'cre' } },
    { automation: { ...deployment.automation, workerUrl: 'https://other.example' } }]) {
    assert.throws(() => prepareKeeperPipeline(base('biribi-cre-countdown'), { ...deployment, ...changed }, abi));
  }
  assert.throws(() => prepareKeeperPipeline(base('biribi-roulette-events'), deployment, abi));
  assert.throws(() => prepareKeeperPipeline(base('biribi-cre-countdown'), deployment, []));
});

test('each pipeline uses a different stored credential and no credential appears in its URL', () => {
  const names = Object.keys(WAKE_SECRET_NAMES);
  const sinks = names.map(name => prepareKeeperPipeline(base(name), deployment, abi).sinks.wake);
  assert.equal(new Set(sinks.map(sink => sink.secret_name)).size, 2);
  for (const sink of sinks) assert.equal(new URL(sink.url).search, '');
});
