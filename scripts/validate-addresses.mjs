#!/usr/bin/env node
/**
 * Validates that hardcoded contract addresses in constant.ts
 * are consistent with subgraph.yaml and networks.json.
 *
 * Run: node scripts/validate-addresses.mjs
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// 1. Parse constant.ts
const constantTs = readFileSync(resolve(root, 'src/helpers/constant.ts'), 'utf8');
const stakedMatch = constantTs.match(/STAKED_BRB_CONTRACT_ADDRESS\s*=\s*"(0x[0-9a-fA-F]+)"/);
const jackpotMatch = constantTs.match(/JACKPOT_CONTRACT_ADDRESS\s*=\s*"(0x[0-9a-fA-F]+)"/);

if (!stakedMatch || !jackpotMatch) {
  console.error('ERROR: Could not parse addresses from constant.ts');
  process.exit(1);
}

const constantAddresses = {
  stakedBRB: stakedMatch[1].toLowerCase(),
  jackpot: jackpotMatch[1].toLowerCase(),
};

// 2. Parse subgraph.yaml to find the network
const subgraphYaml = readFileSync(resolve(root, 'subgraph.yaml'), 'utf8');
const networkMatch = subgraphYaml.match(/network:\s*(\S+)/);
const network = networkMatch ? networkMatch[1] : null;

// 3. Parse networks.json
const networksJson = JSON.parse(readFileSync(resolve(root, 'networks.json'), 'utf8'));

let errors = 0;

if (network && networksJson[network]) {
  const netConfig = networksJson[network];

  // Check StakedBRB address consistency
  if (netConfig.StakedBRB) {
    const netAddr = netConfig.StakedBRB.address.toLowerCase();
    // Note: constant.ts may use a different deployment than subgraph.yaml
    // (e.g. proxy vs implementation). This check is informational.
    console.log(`Network: ${network}`);
    console.log(`  constant.ts  STAKED_BRB = ${constantAddresses.stakedBRB}`);
    console.log(`  networks.json StakedBRB = ${netAddr}`);
    if (constantAddresses.stakedBRB !== netAddr) {
      console.warn('  WARNING: StakedBRB addresses differ between constant.ts and networks.json');
      console.warn('           This may be intentional (proxy vs implementation), but verify manually.');
      errors++;
    } else {
      console.log('  OK: StakedBRB addresses match');
    }
  }

  console.log();
  console.log(`  constant.ts  JACKPOT    = ${constantAddresses.jackpot}`);
  console.log('  (Jackpot is not tracked in networks.json — manual verification required)');
} else {
  console.warn(`WARNING: Network "${network}" not found in networks.json`);
  errors++;
}

console.log();
if (errors > 0) {
  console.log(`${errors} warning(s) found. Please verify addresses are correct for the target network.`);
  process.exit(1);
} else {
  console.log('All address checks passed.');
}
