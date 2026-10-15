// Local templates only. No Goldsky calls, credential reads or remote apply.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const YAML = createRequire(require.resolve('@graphprotocol/graph-cli/package.json'))('yaml');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const valid = value => /^0x[\da-f]{40}$/i.test(value ?? '') && !/^0x0{40}$/i.test(value);

export function preparePipelines(deployment) {
  if (deployment.chainId !== 42161 || deployment.automation?.mode !== 'keeper') throw new Error('Requires an explicit Arbitrum One keeper deployment.');
  const worker = new URL(deployment.automation.worker);
  if (worker.protocol !== 'https:' || worker.username || worker.password || worker.search || worker.hash || worker.pathname !== '/') throw new Error('Worker must be a clean HTTPS origin.');
  const keys = ['brb', 'roulette', 'sideBet', 'jackpotFunder', 'scheduler', 'creExecutionAuthority', 'tipJar'];
  const addresses = [...keys.map(key => deployment.addresses?.[key]), ...Object.values(deployment.markets ?? {}).map(market => market.bank)];
  if (!addresses.length || addresses.some(address => !valid(address))) throw new Error('Invalid/missing pipeline contract address.');
  const entries = ['MergedEvents', 'Game', 'SideBet', 'BRBJackpotFunder', 'TipJar'].flatMap(name => {
    const artifact = JSON.parse(readFileSync(join(root, 'abis', name + '.json'), 'utf8'));
    return (Array.isArray(artifact) ? artifact : artifact.abi).filter(item => item.type === 'event');
  });
  const abi = [...new Map(entries.map(entry => [JSON.stringify(entry), entry])).values()];
  const definitions = [
    ['turbo.yaml', 'biribi-arbitrum-one-events'],
    ['turbo-cre.yaml', 'biribi-arbitrum-one-countdown'],
    ['turbo-keeper-payout.yaml', 'biribi-arbitrum-one-payout'],
  ];
  return Object.fromEntries(definitions.map(([file, name]) => {
    let text = readFileSync(join(root, file), 'utf8')
      .replaceAll('__SYNC_PIPELINE_ADDRESSES__', [...new Set(addresses.map(address => address.toLowerCase()))].map(address => `'${address}'`).join(', '))
      .replaceAll('__SYNC_PIPELINE_ROULETTE_ADDRESS__', deployment.addresses.roulette.toLowerCase())
      .replaceAll('__SYNC_PIPELINE_ABI__', JSON.stringify(abi).replaceAll("'", "''"))
      .replaceAll('${CRE_WEBHOOK_URL}', worker.origin + '/webhook')
      .replaceAll('${KEEPER_PAYOUT_WEBHOOK_URL}', worker.origin + '/webhook/payout');
    const pipeline = YAML.parse(text);
    pipeline.name = name;
    // Goldsky's Arbitrum One dataset namespace: arbitrum_one, distinct from Sepolia.
    pipeline.sources.raw_logs.dataset_name = 'arbitrum_one.raw_logs';
    // Realtime only: historical accounting comes from the isolated subgraph.
    pipeline.sources.raw_logs.start_at = 'latest';
    for (const sink of Object.values(pipeline.sinks)) {
      if (sink.secret_name) sink.secret_name = 'BIRIBI_MAINNET_SCHEDULE';
    }
    return [name + '.template.yaml', YAML.stringify(pipeline, { lineWidth: 0 })];
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [manifest, output] = process.argv.slice(2);
  if (!manifest || !output) throw new Error('Usage: prepare-mainnet-pipelines.mjs <deployment> <new-output-directory>');
  const files = preparePipelines(JSON.parse(readFileSync(resolve(manifest), 'utf8')));
  const out = resolve(output);
  if (existsSync(out)) throw new Error('Output exists; choose a new directory.');
  mkdirSync(out, { recursive: true });
  for (const [file, text] of Object.entries(files)) writeFileSync(join(out, file), text);
  console.log('Prepared isolated mainnet templates. Configure separate secrets and validate in BRB before any apply.');
}
