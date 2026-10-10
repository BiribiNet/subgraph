// Generate an isolated source tree; never patches checked-in Sepolia files or calls Goldsky.
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// Use the parser pinned by graph-cli, the compiler of this manifest.
const YAML = createRequire(require.resolve('@graphprotocol/graph-cli/package.json'))('yaml');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sources = { BRBToken: 'brb', RouletteEngine: 'roulette', BRBReferral: 'brbReferal',
  BRBJackpotFunder: 'jackpotFunder', SideBet: 'sideBet', AutomationReceiver: 'automationReceiver',
  UpkeepScheduler: 'scheduler', CreExecutionAuthority: 'creExecutionAuthority' };
const validAddress = value => /^0x[\da-f]{40}$/i.test(value ?? '') && !/^0x0{40}$/i.test(value);

export function prepareManifest(manifestText, deployment) {
  const network = { 42161: 'arbitrum-one', 421614: 'arbitrum-sepolia' }[deployment.chainId];
  if (!network) throw new Error('Deployment requires explicit chainId 42161 or 421614.');
  if (deployment.chainId === 42161 && deployment.handoffComplete !== true) throw new Error('Mainnet deployment handoff is incomplete.');
  const manifest = YAML.parse(manifestText);
  for (const key of [...Object.values(sources), 'jackpotTreasury']) {
    if (!validAddress(deployment.addresses?.[key])) throw new Error(`Missing/invalid addresses.${key}`);
  }
  for (const name of Object.keys(sources)) {
    if (manifest.dataSources.filter(source => source.name === name).length !== 1) throw new Error(`Expected one ${name} source`);
  }
  // Old Sepolia funders and optional TipJar must never leak onto a fresh mainnet.
  manifest.dataSources = manifest.dataSources.filter(source => sources[source.name]);
  for (const source of manifest.dataSources) {
    const key = sources[source.name];
    const startBlock = deployment.startBlocks?.[key] ?? deployment.startBlock;
    if (!Number.isSafeInteger(startBlock) || startBlock < 1) throw new Error(`Invalid start block for ${key}`);
    source.network = network;
    source.source.address = deployment.addresses[key].toLowerCase();
    source.source.startBlock = startBlock;
  }
  for (const template of manifest.templates) template.network = network;
  return YAML.stringify(manifest, { lineWidth: 0, defaultStringType: 'QUOTE_DOUBLE' });
}

export function prepareEnvironment(deploymentPath, output) {
  const deployment = JSON.parse(readFileSync(resolve(deploymentPath), 'utf8'));
  if (deployment.chainId !== 42161) throw new Error('This release exporter is for a fresh mainnet deployment. Keep existing testnet history sources unchanged.');
  const manifest = prepareManifest(readFileSync(join(root, 'subgraph.yaml'), 'utf8'), deployment);
  const out = resolve(output);
  if (existsSync(out)) throw new Error('Output exists; choose a new release directory.');
  mkdirSync(out, { recursive: true });
  for (const path of ['src', 'abis', 'schema.graphql', 'package.json', 'yarn.lock', '.yarnrc.yml']) {
    cpSync(join(root, path), join(out, path), { recursive: true });
  }
  writeFileSync(join(out, 'subgraph.yaml'), manifest);
  const constantsPath = join(out, 'src/helpers/constant.ts');
  let constants = readFileSync(constantsPath, 'utf8');
  for (const [name, key] of [['BRB_TOKEN_ADDRESS', 'brb'], ['JACKPOT_TREASURY_ADDRESS', 'jackpotTreasury']]) {
    const pattern = new RegExp(`(export const ${name} = Address\\.fromString\\(\\s*")0x[\\da-fA-F]{40}("\\s*\\))`);
    if (!pattern.test(constants)) throw new Error(`Cannot find ${name}`);
    constants = constants.replace(pattern, `$1${deployment.addresses[key].toLowerCase()}$2`);
  }
  writeFileSync(constantsPath, constants);
  writeFileSync(join(out, 'deployment.json'), JSON.stringify(deployment, null, 2) + '\n');
  symlinkSync(join(root, 'node_modules'), join(out, 'node_modules'), 'dir');
  console.log(`Prepared ${out}. Run graph codegen/build there; publish as biribi-arbitrum-one/<version>.`);
  return out;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [deployment, output] = process.argv.slice(2);
  if (!deployment || !output) throw new Error('Usage: prepare-environment.mjs <mainnet-deployment.json> <new-output-dir>');
  prepareEnvironment(deployment, output);
}
