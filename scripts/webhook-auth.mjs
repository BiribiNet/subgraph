// Authentication-only changes preserve sources/checkpoints, SQL, batching and destinations.
export const WEBHOOK_AUTH = Object.freeze({
  'biribi-cre-countdown': Object.freeze({
    url: 'https://biribi-round-watcher-arbitrum-one.soft-thunder-4aae.workers.dev/webhook',
    secret: 'BIRIBI_MAINNET_COUNTDOWN',
  }),
  'biribi-keeper-payout': Object.freeze({
    url: 'https://biribi-round-watcher-arbitrum-one.soft-thunder-4aae.workers.dev/webhook/payout',
    secret: 'BIRIBI_MAINNET_PAYOUT',
  }),
  'biribi-roulette-events': Object.freeze({
    url: 'https://biribi.net/api/mirror', secret: 'BIRIBI_MAINNET_MIRROR',
  }),
});

export function withWebhookAuth(definition) {
  const target = WEBHOOK_AUTH[definition.name];
  const sinks = Object.values(definition.sinks ?? {});
  if (!target || sinks.length !== 1 || sinks[0].type !== 'webhook') {
    throw new Error('Expected one of the three mainnet webhook pipelines with one webhook sink.');
  }
  const sources = Object.values(definition.sources ?? {});
  if (!sources.length || sources.some(source => source.dataset_name !== 'arbitrum_one.raw_logs')) {
    throw new Error('Refusing authentication migration for a non-mainnet source.');
  }
  const current = new URL(sinks[0].url);
  const expected = new URL(target.url);
  if (current.origin !== expected.origin || current.pathname !== expected.pathname) {
    throw new Error('Refusing to change the pipeline destination during authentication migration.');
  }
  const next = structuredClone(definition);
  const sink = Object.values(next.sinks)[0];
  sink.url = target.url;
  sink.secret_name = target.secret;
  if (sink.headers) sink.headers = Object.fromEntries(Object.entries(sink.headers)
    .filter(([name]) => !['authorization', 'x-mirror-secret', 'x-webhook-secret'].includes(name.toLowerCase())));
  return next;
}
