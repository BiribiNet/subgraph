import { readFileSync } from 'node:fs';
const bundle = JSON.parse(readFileSync(new URL('../deployments/arbitrum-one-abi.json', import.meta.url)));
const files = {"Game":"RouletteEngine","BankVault4626":"BankVault4626","BRBJackpotFunder":"BRBJackpotFunder","CreExecutionAuthority":"CreExecutionAuthority","SideBet":"SideBet","TipJar":"TipJar","BRB":"BRBToken","JackpotTreasury":"JackpotTreasury","UpkeepScheduler":"UpkeepScheduler"};
export function mainnetProfile(deployment) {
  if (deployment.abiProfile === undefined) return false;
  if (deployment.chainId !== 42161 || deployment.abiProfile !== bundle.profile) throw new Error('Unsupported deployed ABI profile.');
  return true;
}
export function mainnetAbi(name, original, deployment, { compatibilityTypes = false } = {}) {
  if (!mainnetProfile(deployment)) return structuredClone(original);
  if (name === 'MergedEvents') {
    const events = Object.values(bundle.contracts).flatMap(contract => contract.abi.filter(item => item.type === 'event'));
    return [...new Map(events.map(event => [JSON.stringify(event), event])).values()];
  }
  const contract = files[name];
  if (!contract) return structuredClone(original);
  const abi = structuredClone(bundle.contracts[contract].abi);
  // Unused Sepolia handlers share this source file; keep their classes available to codegen only.
  // These compatibility entries are NEVER registered as mainnet event handlers or mirror events.
  if (name === 'BankVault4626' && compatibilityTypes) {
    for (const event of original.filter(item => item.type === 'event' && ['WithdrawalRequested', 'WithdrawalPaid'].includes(item.name))) abi.push(event);
  }
  return abi;
}
export function deployedHandler(event, deployment) {
  if (!mainnetProfile(deployment)) return event;
  const name = event.slice(0, event.indexOf('('));
  const entry = Object.values(bundle.contracts).flatMap(contract => contract.abi).find(item => item.type === 'event' && item.name === name);
  if (!entry) return ['WithdrawalRequested', 'WithdrawalPaid'].includes(name) ? null : event;
  return name + '(' + entry.inputs.map(input => (input.indexed ? 'indexed ' : '') + input.type).join(',') + ')';
}
