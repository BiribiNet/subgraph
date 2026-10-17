import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preparePipelines } from './prepare-mainnet-pipelines.mjs';
const require = createRequire(import.meta.url);
const YAML = createRequire(require.resolve('@graphprotocol/graph-cli/package.json'))('yaml');
const deployment = JSON.parse(readFileSync(new URL('../deployments/arbitrum-one.json', import.meta.url)));

test('mainnet pipelines isolate dataset, addresses, names, secrets and worker paths', () => {
  const files = preparePipelines(deployment);
  assert.equal(Object.keys(files).length, 3);
  for (const text of Object.values(files)) {
    const pipeline = YAML.parse(text);
    assert.match(pipeline.name, /^biribi-arbitrum-one-/);
    assert.equal(pipeline.sources.raw_logs.dataset_name, 'arbitrum_one.raw_logs');
    assert.equal(pipeline.sources.raw_logs.start_at, 'latest');
    assert.ok(!text.includes('arbitrum_sepolia') && !text.includes('__SYNC_PIPELINE_'));
    assert.ok(text.includes(deployment.addresses.roulette));
    for (const sink of Object.values(pipeline.sinks)) {
      if (sink.secret_name) {
        assert.equal(sink.secret_name, deployment.automation.goldskyWakeupsEnabled ? 'BIRIBI_MAINNET_KEEPER_WAKE' : 'BIRIBI_MAINNET_SCHEDULE');
        assert.ok(sink.url.startsWith(deployment.automation.worker + '/webhook'));
      }
    }
  }
  assert.ok(Object.values(files).some(text => text.includes('${MIRROR_API_SECRET}')));
  const mirror = YAML.parse(files['biribi-arbitrum-one-events.template.yaml']);
  assert.ok(JSON.stringify(mirror.transforms).includes(deployment.addresses.brbReferal.toLowerCase()));
  const sql = mirror.transforms.decoded_events.sql;
  const abi = JSON.parse(sql.match(/_gs_log_decode\(\s*'([^']+)'/)[1]);
  const approvals = abi.filter(event => event.name === 'ExecutorApprovalUpdated');
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].inputs[0].indexed, false);
});
test('rejects other chains, automation modes, unsafe worker origins and missing addresses', () => {
  for (const change of [{ chainId: 421614 }, { automation: { mode: 'cre' } }, { automation: { mode: 'keeper', worker: 'https://user:secret@example.com' } }, { addresses: {} }]) {
    assert.throws(() => preparePipelines({ ...deployment, ...change }));
  }
});
