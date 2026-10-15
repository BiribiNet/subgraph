import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { prepareManifest } from './prepare-environment.mjs';
const require = createRequire(import.meta.url);
const YAML = createRequire(require.resolve('@graphprotocol/graph-cli/package.json'))('yaml');
const text = readFileSync(new URL('../subgraph.yaml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const deployment = JSON.parse(readFileSync(new URL('../deployments/arbitrum-sepolia.json', import.meta.url)));
const mainnet = { ...deployment, chainId: 42161, handoffComplete: true, startBlock: 12345, startBlocks: { brb: 123 } };
mainnet.addresses = { ...mainnet.addresses };
delete mainnet.addresses.tipJar;
test('fresh mainnet rewrites all sources/templates and removes testnet history sources', () => {
  const generated = YAML.parse(prepareManifest(text, mainnet));
  for (const source of [...generated.dataSources, ...generated.templates]) assert.equal(source.network, 'arbitrum-one');
  assert.equal(generated.dataSources.length, 8);
  assert.equal(generated.dataSources.find(source => source.name === 'BRBToken').source.startBlock, 123);
  assert.equal(generated.dataSources.find(source => source.name === 'RouletteEngine').source.startBlock, 12345);
  assert.ok(!generated.dataSources.some(source => source.name.includes('Legacy') || source.name.includes('Previous') || source.name === 'TipJar'));
  assert.equal(readFileSync(new URL('../subgraph.yaml', import.meta.url), 'utf8').replace(/\r\n/g, '\n'), text);
});
test('fails closed on unknown chain, missing address, missing data source and bad block', () => {
  for (const changed of [{ chainId: 1 }, { handoffComplete: false }, { startBlock: 0 }, { addresses: { ...mainnet.addresses, roulette: '0x' } }]) {
    assert.throws(() => prepareManifest(text, { ...mainnet, ...changed }));
  }
  assert.throws(() => prepareManifest(text.replace('name: SideBet\n', 'name: Missing\n'), mainnet));
});

test('keeper mode removes CRE receiver and includes only the explicitly deployed TipJar', () => {
  const keeper = structuredClone(mainnet);
  keeper.automation = { mode: 'keeper' };
  delete keeper.addresses.automationReceiver;
  keeper.addresses.tipJar = '0x3333333333333333333333333333333333333333';
  keeper.startBlocks.tipJar = 456;
  const generated = YAML.parse(prepareManifest(text, keeper));
  assert.equal(generated.dataSources.length, 8);
  assert.ok(!generated.dataSources.some(source => source.name === 'AutomationReceiver'));
  assert.equal(generated.dataSources.find(source => source.name === 'TipJar').source.startBlock, 456);
  assert.ok(generated.templates.every(source => source.network === 'arbitrum-one'));
  assert.throws(() => prepareManifest(text, { ...keeper, automation: { mode: 'unknown' } }));
  keeper.addresses.automationReceiver = mainnet.addresses.automationReceiver;
  assert.throws(() => prepareManifest(text, keeper), /CRE receiver/);
});

test('explicit local candidate preparation preserves incomplete release evidence', () => {
  const incomplete = { ...mainnet, handoffComplete: false };
  assert.throws(() => prepareManifest(text, incomplete), /handoff/);
  assert.ok(prepareManifest(text, incomplete, { candidate: true }));
  assert.equal(incomplete.handoffComplete, false);
});
