import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { prepareManifest } from './prepare-environment.mjs';
const require = createRequire(import.meta.url);
const YAML = createRequire(require.resolve('@graphprotocol/graph-cli/package.json'))('yaml');
const text = readFileSync(new URL('../subgraph.yaml', import.meta.url), 'utf8');
const deployment = JSON.parse(readFileSync(new URL('../deployments/arbitrum-sepolia.json', import.meta.url)));
const mainnet = { ...deployment, chainId: 42161, handoffComplete: true, startBlock: 12345, startBlocks: { brb: 123 } };
test('fresh mainnet rewrites all sources/templates and removes testnet history sources', () => {
  const generated = YAML.parse(prepareManifest(text, mainnet));
  for (const source of [...generated.dataSources, ...generated.templates]) assert.equal(source.network, 'arbitrum-one');
  assert.equal(generated.dataSources.length, 8);
  assert.equal(generated.dataSources.find(source => source.name === 'BRBToken').source.startBlock, 123);
  assert.equal(generated.dataSources.find(source => source.name === 'RouletteEngine').source.startBlock, 12345);
  assert.ok(!generated.dataSources.some(source => source.name.includes('Legacy') || source.name.includes('Previous') || source.name === 'TipJar'));
  assert.equal(readFileSync(new URL('../subgraph.yaml', import.meta.url), 'utf8'), text);
});
test('fails closed on unknown chain, missing address, missing data source and bad block', () => {
  for (const changed of [{ chainId: 1 }, { handoffComplete: false }, { startBlock: 0 }, { addresses: { ...mainnet.addresses, roulette: '0x' } }]) {
    assert.throws(() => prepareManifest(text, { ...mainnet, ...changed }));
  }
  assert.throws(() => prepareManifest(text.replace('name: SideBet\n', 'name: Missing\n'), mainnet));
});
