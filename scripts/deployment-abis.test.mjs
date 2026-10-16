import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { deploymentAbi, executorApprovalIndexed } from './deployment-abis.mjs';
const require = createRequire(import.meta.url);
const { decodeLog } = createRequire(require.resolve('@graphprotocol/graph-cli/package.json'))('web3-eth-abi');
const deployment = JSON.parse(readFileSync(new URL('../deployments/arbitrum-one.json', import.meta.url)));
const original = JSON.parse(readFileSync(new URL('../abis/CreExecutionAuthority.json', import.meta.url)));
const event = abi => abi.find(item => item.type === 'event' && item.name === 'ExecutorApprovalUpdated');

test('deployed non-indexed approval decodes the recorded mainnet receipt', () => {
  const evidence = deployment.evidence.executorApprovalLayout;
  const before = JSON.stringify(original);
  assert.throws(() => decodeLog(event(original).inputs, evidence.data, evidence.topics.slice(1)));
  const corrected = deploymentAbi(original, deployment);
  const result = decodeLog(event(corrected).inputs, evidence.data, evidence.topics.slice(1));
  assert.equal(result.executor.toLowerCase(), '0x29984d0c50ddaa5be680b750025dc88d16c57ab8');
  assert.equal(result.approved, true);
  assert.equal(event(corrected).inputs[0].indexed, false);
  assert.equal(JSON.stringify(original), before);
  assert.deepEqual(deploymentAbi({ abi: original }, deployment).abi, corrected);
});

test('legacy indexed ABI is retained and invalid override scopes fail closed', () => {
  assert.deepEqual(deploymentAbi(original, { chainId: 421614 }), original);
  for (const change of [{ chainId: 421614 }, { automation: { mode: 'cre', executorApprovalIndexed: false } },
    { automation: { mode: 'keeper', executorApprovalIndexed: 'false' } }]) {
    assert.throws(() => executorApprovalIndexed({ ...deployment, ...change }));
  }
  assert.throws(() => deploymentAbi([{ type: 'event', name: 'ExecutorApprovalUpdated', inputs: [] }], deployment));
});
