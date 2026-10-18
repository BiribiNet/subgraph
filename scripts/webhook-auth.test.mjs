import test from 'node:test';
import assert from 'node:assert/strict';
import { WEBHOOK_AUTH, withWebhookAuth } from './webhook-auth.mjs';

const base = name => ({ name, resource_size: 's',
  sources: { raw_logs_arbitrum_one: { type: 'dataset', dataset_name: 'arbitrum_one.raw_logs', start_at: 'latest' } },
  transforms: { events: { type: 'sql', sql: 'original SQL' } },
  sinks: { sink: { type: 'webhook', from: 'events', url: WEBHOOK_AUTH[name].url + '?secret=old&G7UkR6zzW=old',
    one_row_per_request: false, secret_name: 'SHARED', headers: { AUTHORIZATION: 'old', 'X-Mirror-Secret': 'old', 'Content-Type': 'application/json' } } },
});

test('three independent stored secrets, clean URLs and no explicit credential headers', () => {
  assert.equal(new Set(Object.values(WEBHOOK_AUTH).map(target => target.secret)).size, 3);
  for (const name of Object.keys(WEBHOOK_AUTH)) {
    const original = base(name);
    const migrated = withWebhookAuth(original);
    assert.deepEqual(migrated.sources, original.sources);
    assert.deepEqual(migrated.transforms, original.transforms);
    assert.equal(migrated.sinks.sink.one_row_per_request, false);
    assert.equal(migrated.sinks.sink.secret_name, WEBHOOK_AUTH[name].secret);
    assert.equal(migrated.sinks.sink.url, WEBHOOK_AUTH[name].url);
    assert.deepEqual(migrated.sinks.sink.headers, { 'Content-Type': 'application/json' });
    assert.equal(JSON.stringify(migrated).includes('old'), false);
    assert.equal(original.sinks.sink.secret_name, 'SHARED');
    assert.deepEqual(withWebhookAuth(migrated), migrated);
  }
});

test('refuses unknown, testnet, unexpected destinations and sink topologies', () => {
  const original = base('biribi-cre-countdown');
  assert.throws(() => withWebhookAuth({ ...original, name: 'unknown' }));
  assert.throws(() => withWebhookAuth({ ...original, sources: { raw: { dataset_name: 'arbitrum_sepolia.raw_logs' } } }));
  assert.throws(() => withWebhookAuth({ ...original, sinks: {} }));
  for (const url of ['https://evil.test/webhook', 'https://biribi-round-watcher-arbitrum-one.soft-thunder-4aae.workers.dev/wrong']) {
    assert.throws(() => withWebhookAuth({ ...original, sinks: { sink: { ...original.sinks.sink, url } } }));
  }
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mainnetEventsPipeline, MIRROR_SECRET_NAME } from './mainnet-events-pipeline.mjs';
import { WAKE_SECRET_NAMES } from './mainnet-keeper-pipelines.mjs';

test('event mirror regeneration strips old query credentials and cannot reuse keeper secrets', () => {
  const deployment = JSON.parse(readFileSync(new URL('../deployments/arbitrum-one.json', import.meta.url)));
  const original = base('biribi-roulette-events');
  original.sinks.webhook_events = original.sinks.sink;
  delete original.sinks.sink;
  original.transforms.decoded_events = original.transforms.events;
  const next = mainnetEventsPipeline(original, deployment, fileURLToPath(new URL('../abis', import.meta.url)));
  assert.equal(next.sinks.webhook_events.url, 'https://biribi.net/api/mirror');
  assert.equal(next.sinks.webhook_events.secret_name, MIRROR_SECRET_NAME);
  assert.equal(new Set([MIRROR_SECRET_NAME, ...Object.values(WAKE_SECRET_NAMES)]).size, 3);
  assert.equal(JSON.stringify(next).includes('secret=old'), false);
  assert.equal(next.sinks.webhook_events.headers.AUTHORIZATION, undefined);
  const events = JSON.parse(next.transforms.decoded_events.sql.match(/_gs_log_decode\(\s*'([^']+)'/)[1]);
  const approvals = events.filter(event => event.name === 'ExecutorApprovalUpdated');
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].inputs[0].indexed, false);
  assert.ok(!events.some(event => ['WithdrawalRequested', 'WithdrawalPaid'].includes(event.name)));
});
