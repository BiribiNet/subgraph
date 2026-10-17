import { mainnetAbi, mainnetProfile, deployedHandler } from './mainnet-abis.mjs';
// Generate an isolated source tree; never patches checked-in Sepolia files or calls Goldsky.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { deploymentAbi, executorApprovalIndexed } from './deployment-abis.mjs';
const require = createRequire(import.meta.url);
// Use the parser pinned by graph-cli, the compiler of this manifest.
const YAML = createRequire(require.resolve('@graphprotocol/graph-cli/package.json'))('yaml');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sources = { BRBToken: 'brb', RouletteEngine: 'roulette', BRBReferral: 'brbReferal',
  BRBJackpotFunder: 'jackpotFunder', SideBet: 'sideBet', AutomationReceiver: 'automationReceiver',
  UpkeepScheduler: 'scheduler', CreExecutionAuthority: 'creExecutionAuthority' };
const fsAbiNames = out => readdirSync(join(out, 'abis')).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5));
const validAddress = value => /^0x[\da-f]{40}$/i.test(value ?? '') && !/^0x0{40}$/i.test(value);

export function prepareManifest(manifestText, deployment, { candidate = false } = {}) {
  const network = { 42161: 'arbitrum-one', 421614: 'arbitrum-sepolia' }[deployment.chainId];
  if (!network) throw new Error('Deployment requires explicit chainId 42161 or 421614.');
  if (deployment.chainId === 42161 && deployment.handoffComplete !== true && !candidate) throw new Error('Mainnet deployment handoff is incomplete. Use --candidate only for local build/review.');
  const configuredMode = deployment.automation?.mode ?? 'cre';
  const mode = configuredMode === 'cloudflare-keeper' ? 'keeper' : configuredMode;
  if (!['cre', 'keeper'].includes(mode)) throw new Error('Unknown automation mode.');
  if (mode === 'keeper' && deployment.addresses?.automationReceiver != null && deployment.addresses.automationReceiver !== '') throw new Error('Keeper release must not configure a CRE receiver.');
  const activeSources = Object.fromEntries(Object.entries(sources).filter(([name]) => mode === 'cre' || name !== 'AutomationReceiver'));
  const manifest = YAML.parse(manifestText);
  const approvalIndexed = executorApprovalIndexed(deployment);
  for (const key of [...Object.values(activeSources), 'jackpotTreasury']) {
    if (!validAddress(deployment.addresses?.[key])) throw new Error(`Missing/invalid addresses.${key}`);
  }
  for (const name of Object.keys(activeSources)) {
    if (manifest.dataSources.filter(source => source.name === name).length !== 1) throw new Error(`Expected one ${name} source`);
  }
  // Old Sepolia funders and optional TipJar must never leak onto a fresh mainnet.
  manifest.dataSources = manifest.dataSources.filter(source => activeSources[source.name]);
  for (const source of manifest.dataSources) {
    const key = activeSources[source.name];
    const startBlock = deployment.startBlocks?.[key] ?? deployment.startBlock;
    if (!Number.isSafeInteger(startBlock) || startBlock < 1) throw new Error(`Invalid start block for ${key}`);
    source.network = network;
    source.source.address = deployment.addresses[key].toLowerCase();
    source.source.startBlock = startBlock;
    if (source.name === 'CreExecutionAuthority' && !approvalIndexed) {
      const handler = source.mapping.eventHandlers.find(item => item.event === 'ExecutorApprovalUpdated(indexed address,bool)');
      if (!handler) throw new Error('Executor approval handler missing.');
      handler.event = 'ExecutorApprovalUpdated(address,bool)';
    }
  }
  for (const template of manifest.templates) template.network = network;
  if (deployment.addresses?.tipJar) {
    if (!validAddress(deployment.addresses.tipJar)) throw new Error('Invalid TipJar address.');
    const template = manifest.templates.find(source => source.name === 'TipJar');
    if (!template) throw new Error('TipJar template missing.');
    const startBlock = deployment.startBlocks?.tipJar ?? deployment.startBlock;
    if (!Number.isSafeInteger(startBlock) || startBlock < 1) throw new Error('Invalid TipJar start block.');
    manifest.dataSources.push({ ...structuredClone(template), source: { ...template.source,
      address: deployment.addresses.tipJar.toLowerCase(), startBlock } });
  }
  if (mainnetProfile(deployment)) {
    for (const source of [...manifest.dataSources, ...manifest.templates]) {
      source.mapping.eventHandlers = source.mapping.eventHandlers.flatMap(handler => {
        const event = deployedHandler(handler.event, deployment);
        return event ? [{ ...handler, event }] : [];
      });
      if (source.name === 'BankVault') {
        source.mapping.file = './src/mappings/mainnet-bank-vault.ts';
        source.mapping.eventHandlers.push({ event: 'WithdrawalSkipped(uint256,address,address,uint16)', handler: 'handleWithdrawalSkipped' });
      }
    }
  }
  return YAML.stringify(manifest, { lineWidth: 0, defaultStringType: 'QUOTE_DOUBLE' });
}

export function prepareEnvironment(deploymentPath, output, options = {}) {
  const deployment = JSON.parse(readFileSync(resolve(deploymentPath), 'utf8'));
  if (deployment.chainId !== 42161) throw new Error('This release exporter is for a fresh mainnet deployment. Keep existing testnet history sources unchanged.');
  const manifest = prepareManifest(readFileSync(join(root, 'subgraph.yaml'), 'utf8'), deployment, options);
  const out = resolve(output);
  if (existsSync(out)) throw new Error('Output exists; choose a new release directory.');
  mkdirSync(out, { recursive: true });
  for (const path of ['src', 'abis', 'schema.graphql', 'package.json', 'yarn.lock', '.yarnrc.yml']) {
    cpSync(join(root, path), join(out, path), { recursive: true });
  }
  writeFileSync(join(out, 'subgraph.yaml'), manifest);
  for (const name of fsAbiNames(out)) {
    const path = join(out, 'abis', name + '.json');
    writeFileSync(path, JSON.stringify(mainnetAbi(name, deploymentAbi(JSON.parse(readFileSync(path, 'utf8')), deployment), deployment, { compatibilityTypes: true }), null, 2) + '\n');
  }
  const constantsPath = join(out, 'src/helpers/constant.ts');
  let constants = readFileSync(constantsPath, 'utf8');
  for (const [name, key] of [['BRB_TOKEN_ADDRESS', 'brb'], ['JACKPOT_TREASURY_ADDRESS', 'jackpotTreasury']]) {
    const pattern = new RegExp(`(export const ${name} = Address\\.fromString\\(\\s*")0x[\\da-fA-F]{40}("\\s*\\))`);
    if (!pattern.test(constants)) throw new Error(`Cannot find ${name}`);
    constants = constants.replace(pattern, `$1${deployment.addresses[key].toLowerCase()}$2`);
  }
  writeFileSync(constantsPath, constants);
  writeFileSync(join(out, 'deployment.json'), JSON.stringify(deployment, null, 2) + '\n');
  symlinkSync(join(root, 'node_modules'), join(out, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  console.log(`Prepared ${out}. Run graph codegen/build there; publish as biribi-arbitrum-one/<version>.`);
  return out;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [deployment, output, flag] = process.argv.slice(2);
  if (flag && flag !== '--candidate') throw new Error('Unknown preparation flag');
  if (!deployment || !output) throw new Error('Usage: prepare-environment.mjs <mainnet-deployment.json> <new-output-dir>');
  prepareEnvironment(deployment, output, { candidate: flag === '--candidate' });
}
